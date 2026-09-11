export interface PerformanceBaseline {
  readonly totalItems: number;
  readonly p95Ms: Readonly<Record<string, number>>;
}

// Calibrated p95 values include modest timer-noise padding; tests allow at most two times these.
export const performanceBaselines: readonly PerformanceBaseline[] = [
  {
    totalItems: 1_000,
    p95Ms: {
      normalize: 3,
      'custom-index': 0.15,
      'native-index': 0.15,
      'custom-join': 0.15,
      'native-join': 0.4,
      'descendant-filter': 0.5,
      'free-text': 1.5,
      facets: 1,
      sort: 0.5,
      page: 0.02,
      'row-expansion': 0.02,
    },
  },
  {
    totalItems: 10_000,
    p95Ms: {
      normalize: 12,
      'custom-index': 0.4,
      'native-index': 0.7,
      'custom-join': 2,
      'native-join': 2,
      'descendant-filter': 12,
      'free-text': 20,
      facets: 1.2,
      sort: 2,
      page: 0.02,
      'row-expansion': 0.02,
    },
  },
  {
    totalItems: 50_000,
    p95Ms: {
      normalize: 40,
      'custom-index': 1.2,
      'native-index': 3,
      'custom-join': 45,
      'native-join': 25,
      'descendant-filter': 300,
      'free-text': 380,
      facets: 2.5,
      sort: 10,
      page: 0.02,
      'row-expansion': 0.02,
    },
  },
];
