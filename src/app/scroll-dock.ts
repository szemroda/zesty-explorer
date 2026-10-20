import { createContext } from 'react';

/**
 * Registers a table's horizontal scroller with the dock and returns the function that unregisters
 * it. The scroller's first child is the table, with a header and a body; the dock docks the
 * scroller's scrollbar and sticks the table's header. A nested table sits in an expanded row right
 * after its item's row, which the dock sticks over the parent table's header. `onResize` runs
 * whenever the scroller or its content changes size.
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
  /** For a nested table, its item's row and the expanded row after it that holds the table. */
  readonly nestedIn: NestedIn | undefined;
  /** The nearest registered scroller around this one, or null; set on its first measure. */
  parent: Element | null | undefined;
  /** Whether the content is wider than the scroller, as of its last size change. */
  overflows: boolean;
}

interface NestedIn {
  readonly itemRow: HTMLTableRowElement;
  readonly expansion: HTMLTableRowElement;
}

/** The window scroll offset where a row starts sticking, and how far it travels while stuck. */
interface Placement {
  readonly start: number;
  readonly travel: number;
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

// A nested table sits in its parent table's expanded row, right after the row of its item.
function nestedInOf(scroller: HTMLElement): NestedIn | undefined {
  const expansion = scroller.closest('tr');
  if (!expansion) return undefined;
  const itemRow = expansion.previousElementSibling;
  if (!(itemRow instanceof HTMLTableRowElement)) {
    throw new Error('A nested table sits in the row right after its item row.');
  }
  return { itemRow, expansion };
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
 * Where each stuck row sticks. A table's header sticks below `top`, or, for a nested table, below
 * its item's row. That item row sticks over the parent table's header while the expanded row after
 * it is on screen, so the stuck rows read as the path to the table being scrolled. Each row sticks
 * from the window scroll offset where it reaches its line until the end of its table, or of its
 * expansion, pushes it out. The `sticky-to-window` style moves the rows from these values on the
 * compositor, so they change only with layout, never with scrolling.
 */
function placeStuckRows(
  scrollers: ReadonlyMap<Element, Entry>,
  top: number,
): ReadonlyMap<HTMLElement, Placement> {
  // The viewport line where each table's header sticks, and its stuck item rows over it.
  const lines = new Map<Entry, number>();
  const placements = new Map<HTMLElement, Placement>();
  const outerFirst = [...scrollers.values()]
    .map((entry) => ({ entry, depth: depthOf(entry, scrollers) }))
    .sort((left, right) => left.depth - right.depth);
  for (const { entry } of outerFirst) {
    const parent = parentOf(entry, scrollers);
    const parentLine = parent && lines.get(parent);
    let line = top;
    if (entry.nestedIn && parentLine !== undefined) {
      const item = entry.nestedIn.itemRow.getBoundingClientRect();
      const expansion = entry.nestedIn.expansion.getBoundingClientRect();
      line = parentLine + item.height;
      placements.set(entry.nestedIn.itemRow, {
        start: item.top + window.scrollY - parentLine,
        travel: expansion.height,
      });
    }
    lines.set(entry, line);
    const table = entry.table.getBoundingClientRect();
    const headHeight = entry.head.getBoundingClientRect().height;
    placements.set(entry.head, {
      start: table.top + window.scrollY - line,
      travel: table.height - headHeight,
    });
  }
  return placements;
}

/**
 * Writes `next` as each row's `sticky-to-window` values and clears rows no longer placed, such as
 * a collapsed item row. `written` holds what was last written, to skip writes that change nothing.
 */
function writePlacements(
  next: ReadonlyMap<HTMLElement, Placement>,
  written: Map<HTMLElement, string>,
) {
  for (const row of written.keys()) {
    if (next.has(row)) continue;
    written.delete(row);
    row.style.removeProperty('--sticky-start');
    row.style.removeProperty('--sticky-travel');
  }
  for (const [row, { start, travel }] of next) {
    const placement = `${start}px ${travel}px`;
    if (written.get(row) === placement) continue;
    written.set(row, placement);
    row.style.setProperty('--sticky-start', `${start}px`);
    row.style.setProperty('--sticky-travel', `${travel}px`);
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
 * and keeps each table's header, or the expanded row over it, stuck below `stickyTop`, the
 * viewport line where the page's own sticky header ends. Layout is re-measured at most once per
 * frame, after scrolls, resizes, DOM changes, and size changes of the page or any registered
 * scroller. Nothing is observed until `start`, and `start`'s cleanup releases every listener and
 * observer.
 */
export function createScrollDock(
  onBarsChange: (bars: readonly DockBar[]) => void,
  stickyTop: () => number,
) {
  const scrollers = new Map<Element, Entry>();
  // Each scroller and its content, observed once for both the dock and the scroller's own use.
  const observed = new Map<Element, Entry>();
  let bars: readonly DockBar[] = [];
  const placements = new Map<HTMLElement, string>();
  let frame: number | undefined;
  // Stuck row placements depend on layout only, so scrolling alone leaves them as they are.
  let layoutChanged = true;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const next = measureBars(scrollers);
      if (layoutChanged) writePlacements(placeStuckRows(scrollers, stickyTop()), placements);
      layoutChanged = false;
      if (sameBars(bars, next)) return;
      bars = next;
      onBarsChange(next);
    });
  };
  const relayout = () => {
    layoutChanged = true;
    schedule();
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
      nestedIn: nestedInOf(scroller),
      parent: undefined,
      overflows: overflows(scroller),
    };
    const targets = [scroller, table];
    scrollers.set(scroller, entry);
    for (const target of targets) {
      observed.set(target, entry);
      observer?.observe(target);
    }
    rowMoves?.observe(body, { childList: true });
    relayout();
    return () => {
      scrollers.delete(scroller);
      for (const target of targets) {
        observed.delete(target);
        observer?.unobserve(target);
      }
      relayout();
    };
  };

  /** Starts following the window and the scrollers' sizes; returns the function that stops. */
  const start = () => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', relayout);
    rowMoves = new MutationObserver(relayout);
    for (const { body } of scrollers.values()) rowMoves.observe(body, { childList: true });
    if (typeof ResizeObserver !== 'undefined') {
      const current = new ResizeObserver((records) => {
        new Set(records.flatMap(({ target }) => observed.get(target) ?? [])).forEach(resized);
        relayout();
      });
      current.observe(document.body);
      for (const target of observed.keys()) current.observe(target);
      observer = current;
    }
    relayout();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', relayout);
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
