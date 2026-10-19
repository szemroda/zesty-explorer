import { createContext } from 'react';

/**
 * Registers a horizontal scroller with the dock and returns the function that unregisters it.
 * `onResize` runs whenever the scroller or its content changes size.
 */
export type RegisterScroller = (
  scroller: HTMLElement,
  label: string,
  onResize: () => void,
) => () => void;

export const ScrollDockContext = createContext<RegisterScroller>(() => {
  throw new Error('Table grids render inside a ScrollDockProvider.');
});

export interface DockedScroller {
  readonly id: number;
  readonly scroller: HTMLElement;
  readonly label: string;
}

interface Entry extends DockedScroller {
  readonly onResize: () => void;
  readonly table: HTMLTableElement;
  readonly head: HTMLTableSectionElement;
  readonly body: HTMLTableSectionElement;
  /** The nearest registered scroller around this one, or null; set on its first measure. */
  parent: Element | null | undefined;
  /** Whether the content is wider than the scroller, as of its last size change. */
  overflows: boolean;
  /** The header placement last written, to skip writes that change nothing. */
  placement: string;
}

/** A docked scrollbar for one scroller, placed under the scroller's visible width. */
export interface DockBar {
  readonly entry: DockedScroller;
  readonly left: number;
  readonly width: number;
  readonly scrollWidth: number;
}

/** Height of one docked bar, including its border; inner tables' bars stack above outer ones. */
export const dockBarHeight = 14;
// A table needs this much of itself on screen before its bar docks.
const minimumVisibleHeight = 48;

function overflows(scroller: HTMLElement): boolean {
  return scroller.scrollWidth - scroller.clientWidth > 1;
}

// The nearest registered ancestor scroller. It is read after the commit that registered the
// scroller, when ancestors that mounted in the same commit are registered too.
function parentOf(entry: Entry, scrollers: ReadonlyMap<Element, Entry>): Entry | undefined {
  if (entry.parent === undefined) {
    let ancestor = entry.scroller.parentElement;
    while (ancestor && !scrollers.has(ancestor)) ancestor = ancestor.parentElement;
    entry.parent = ancestor;
  }
  return entry.parent ? scrollers.get(entry.parent) : undefined;
}

function depthOf(entry: Entry, scrollers: ReadonlyMap<Element, Entry>): number {
  const parent = parentOf(entry, scrollers);
  return parent ? depthOf(parent, scrollers) + 1 : 0;
}

/**
 * Which scrollers need a docked bar: those that overflow sideways and whose own scrollbar is
 * below the viewport or hidden behind the docked bars of the tables around them.
 */
function measureBars(scrollers: ReadonlyMap<Element, Entry>): readonly DockBar[] {
  const viewportBottom = document.documentElement.clientHeight;
  const candidates: { entry: Entry; rect: DOMRect; depth: number }[] = [];
  for (const entry of scrollers.values()) {
    if (!entry.overflows) continue;
    const rect = entry.scroller.getBoundingClientRect();
    if (rect.top >= viewportBottom - minimumVisibleHeight) continue;
    candidates.push({ entry, rect, depth: depthOf(entry, scrollers) });
  }
  candidates.sort((left, right) => left.depth - right.depth);
  const bars: DockBar[] = [];
  for (const { entry, rect } of candidates) {
    if (rect.bottom <= viewportBottom - bars.length * dockBarHeight) continue;
    bars.push({
      entry,
      left: Math.round(rect.left + entry.scroller.clientLeft),
      width: entry.scroller.clientWidth,
      scrollWidth: entry.scroller.scrollWidth,
    });
  }
  return bars;
}

/**
 * Tells each table's header where to stick: below `top`, or below the stuck header of the table
 * around it, from the window scroll offset where it reaches that line until the table's last row
 * pushes it out. The `sticky-head` style moves the header from these values on the compositor, so
 * they change only with layout, never with scrolling.
 */
function placeHeads(scrollers: ReadonlyMap<Element, Entry>, top: number) {
  // The viewport line just below each table's stuck header, where its nested tables' headers stick.
  const below = new Map<Entry, number>();
  const placements: { entry: Entry; start: number; travel: number }[] = [];
  const outerFirst = [...scrollers.values()]
    .map((entry) => ({ entry, depth: depthOf(entry, scrollers) }))
    .sort((left, right) => left.depth - right.depth);
  for (const { entry } of outerFirst) {
    const parent = parentOf(entry, scrollers);
    const line = (parent && below.get(parent)) ?? top;
    const rect = entry.table.getBoundingClientRect();
    const headHeight = entry.head.getBoundingClientRect().height;
    below.set(entry, line + headHeight);
    placements.push({
      entry,
      start: rect.top + window.scrollY - line,
      travel: rect.height - headHeight,
    });
  }
  for (const { entry, start, travel } of placements) {
    const placement = `${start}px ${travel}px`;
    if (entry.placement === placement) continue;
    entry.placement = placement;
    entry.head.style.setProperty('--sticky-head-start', `${start}px`);
    entry.head.style.setProperty('--sticky-head-travel', `${travel}px`);
  }
}

function sameBars(left: readonly DockBar[], right: readonly DockBar[]): boolean {
  return (
    left.length === right.length &&
    left.every((bar, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        bar.entry === other.entry &&
        bar.left === other.left &&
        bar.width === other.width &&
        bar.scrollWidth === other.scrollWidth
      );
    })
  );
}

let nextScrollerId = 0;

/**
 * Tracks registered scrollers against the window: reports the bars to dock whenever they change,
 * and keeps each table's header stuck below `stickyTop`, the viewport line where the page's own
 * sticky header ends. Layout is re-measured at most once per frame, after scrolls, resizes, DOM
 * changes, and size changes of the page or any registered scroller. Nothing is observed until
 * `start`, and `start`'s cleanup releases every listener and observer.
 */
export function createScrollDock(
  onBarsChange: (bars: readonly DockBar[]) => void,
  stickyTop: () => number,
) {
  const scrollers = new Map<Element, Entry>();
  // Each scroller and its content, observed once for both the dock and the scroller's own use.
  const observed = new Map<Element, Entry>();
  let bars: readonly DockBar[] = [];
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const next = measureBars(scrollers);
      placeHeads(scrollers, stickyTop());
      if (sameBars(bars, next)) return;
      bars = next;
      onBarsChange(next);
    });
  };
  const resized = (entry: Entry) => {
    entry.overflows = overflows(entry.scroller);
    entry.onResize();
  };
  // Exist only between `start` and its cleanup; scrollers registered earlier are observed then.
  let observer: ResizeObserver | undefined;
  // Sorting moves an expanded row, and the tables inside it, without resizing anything.
  let rowMoves: MutationObserver | undefined;

  const register: RegisterScroller = (scroller, label, onResize) => {
    const table = scroller.firstElementChild;
    const body = table instanceof HTMLTableElement ? table.tBodies[0] : undefined;
    if (!(table instanceof HTMLTableElement) || !table.tHead || !body) {
      throw new Error('A registered scroller holds a table with a header and a body.');
    }
    const entry: Entry = {
      id: nextScrollerId++,
      scroller,
      label,
      onResize,
      table,
      head: table.tHead,
      body,
      parent: undefined,
      overflows: overflows(scroller),
      placement: '',
    };
    const targets = [scroller, table];
    scrollers.set(scroller, entry);
    for (const target of targets) {
      observed.set(target, entry);
      observer?.observe(target);
    }
    rowMoves?.observe(body, { childList: true });
    schedule();
    return () => {
      scrollers.delete(scroller);
      for (const target of targets) {
        observed.delete(target);
        observer?.unobserve(target);
      }
      schedule();
    };
  };

  /** Starts following the window and the scrollers' sizes; returns the function that stops. */
  const start = () => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    rowMoves = new MutationObserver(schedule);
    for (const { body } of scrollers.values()) rowMoves.observe(body, { childList: true });
    if (typeof ResizeObserver !== 'undefined') {
      const current = new ResizeObserver((records) => {
        new Set(records.flatMap(({ target }) => observed.get(target) ?? [])).forEach(resized);
        schedule();
      });
      current.observe(document.body);
      for (const target of observed.keys()) current.observe(target);
      observer = current;
    }
    schedule();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      rowMoves?.disconnect();
      rowMoves = undefined;
      observer?.disconnect();
      observer = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
  };

  return { register, start };
}
