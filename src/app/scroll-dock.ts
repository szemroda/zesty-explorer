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
  /** Registered scrollers around this one, set on its first measure. */
  depth: number | undefined;
  /** Whether the content is wider than the scroller, as of its last size change. */
  overflows: boolean;
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

// Nesting depth from the nearest registered ancestor scroller. It is read after the commit that
// registered the scroller, when ancestors that mounted in the same commit are registered too.
function depthOf(entry: Entry, scrollers: ReadonlyMap<Element, Entry>): number {
  if (entry.depth !== undefined) return entry.depth;
  let ancestor = entry.scroller.parentElement;
  while (ancestor && !scrollers.has(ancestor)) ancestor = ancestor.parentElement;
  const parent = ancestor ? scrollers.get(ancestor) : undefined;
  entry.depth = parent ? depthOf(parent, scrollers) + 1 : 0;
  return entry.depth;
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
 * Tracks registered scrollers against the window and reports the bars to dock whenever they
 * change. Layout is re-measured at most once per frame, after scrolls, resizes, and size changes
 * of the page or any registered scroller. Nothing is observed until `start`, and `start`'s
 * cleanup releases every listener and observer.
 */
export function createScrollDock(onBarsChange: (bars: readonly DockBar[]) => void) {
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
      if (sameBars(bars, next)) return;
      bars = next;
      onBarsChange(next);
    });
  };
  const resized = (entry: Entry) => {
    entry.overflows = overflows(entry.scroller);
    entry.onResize();
  };
  // Exists only between `start` and its cleanup; scrollers registered earlier are observed then.
  let observer: ResizeObserver | undefined;

  const register: RegisterScroller = (scroller, label, onResize) => {
    const entry: Entry = {
      id: nextScrollerId++,
      scroller,
      label,
      onResize,
      depth: undefined,
      overflows: overflows(scroller),
    };
    const targets = [scroller, scroller.firstElementChild].filter((target) => target !== null);
    scrollers.set(scroller, entry);
    for (const target of targets) {
      observed.set(target, entry);
      observer?.observe(target);
    }
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
      observer?.disconnect();
      observer = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    };
  };

  return { register, start };
}
