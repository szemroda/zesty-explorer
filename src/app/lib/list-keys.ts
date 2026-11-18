// Keys that move focus through a vertical list that is a single Tab stop.

/** The index each key moves to, from `index` in a list of `count`; other keys are absent. */
export const listKeys: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (index, count) => Math.min(index + 1, count - 1),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, count) => count - 1,
};
