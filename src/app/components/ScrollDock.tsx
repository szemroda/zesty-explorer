import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createScrollDock, dockBarHeight, ScrollDockContext, type DockBar } from '../scroll-dock';

/**
 * Keeps every table's horizontal scrollbar within reach. While a registered table overflows
 * sideways and its own scrollbar is below the window edge, a synced copy of that scrollbar docks
 * at the bottom of the window, aligned to the table. Nested tables' bars stack above their
 * parents' bars, in the same order as the tables' bottom edges.
 */
export function ScrollDockProvider({ children }: { readonly children: ReactNode }) {
  const [bars, setBars] = useState<readonly DockBar[]>([]);
  const [dock] = useState(() => createScrollDock(setBars));

  useEffect(() => dock.start(), [dock]);

  return (
    <ScrollDockContext value={dock.register}>
      {children}
      {bars.length > 0
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col-reverse items-start">
              {bars.map((bar) => (
                <DockedScrollbar key={bar.entry.id} bar={bar} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </ScrollDockContext>
  );
}

// A scrollbar-only copy of one table's scroller; scrolling either one moves the other.
function DockedScrollbar({ bar }: { readonly bar: DockBar }) {
  const proxy = useRef<HTMLDivElement>(null);
  const { scroller, label } = bar.entry;

  useEffect(() => {
    const element = proxy.current;
    if (!element) return;
    const fromScroller = () => {
      if (Math.abs(element.scrollLeft - scroller.scrollLeft) >= 1) {
        element.scrollLeft = scroller.scrollLeft;
      }
    };
    const fromProxy = () => {
      if (Math.abs(element.scrollLeft - scroller.scrollLeft) >= 1) {
        scroller.scrollLeft = element.scrollLeft;
      }
    };
    scroller.addEventListener('scroll', fromScroller, { passive: true });
    element.addEventListener('scroll', fromProxy, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', fromScroller);
      element.removeEventListener('scroll', fromProxy);
    };
  }, [scroller]);

  // A new bar, or a resized table, starts the bar's thumb where the table is scrolled.
  useEffect(() => {
    if (proxy.current) proxy.current.scrollLeft = scroller.scrollLeft;
  }, [scroller, bar.width, bar.scrollWidth]);

  return (
    <div
      ref={proxy}
      aria-hidden="true"
      tabIndex={-1}
      title={`Scroll ${label} sideways`}
      data-scroll-dock-bar={label}
      className="pointer-events-auto overflow-x-scroll overflow-y-hidden border-t border-divider-emphasis bg-panel-raised/95 shadow-[0_-6px_16px_rgb(0_0_0/0.35)] backdrop-blur-sm [scrollbar-color:var(--content-subtle)_transparent] [scrollbar-width:thin]"
      style={{ marginLeft: bar.left, width: bar.width, height: dockBarHeight }}
    >
      <div style={{ width: bar.scrollWidth, height: 1 }} />
    </div>
  );
}
