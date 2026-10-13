import { useState } from 'react';

/** Runs `refresh` on demand and reports whether it is still running, for a `RefreshButton`. */
export function useRefresh(refresh: () => Promise<void>): {
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  return {
    refreshing,
    onRefresh: () => {
      setRefreshing(true);
      void refresh().finally(() => setRefreshing(false));
    },
  };
}
