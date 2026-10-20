import { useMemo, useReducer } from 'react';
import type { Deployment } from '../../domain';
import type { SessionTokenStore } from '../../view-codec/session-token-store';

export interface SessionTokens {
  read(deployment: Deployment): string;
  save(deployment: Deployment, token: string): void;
  clear(deployment: Deployment): void;
}

/** App is the store's only writer, so each write is a complete change signal. */
export function useSessionTokens(store: SessionTokenStore): SessionTokens {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  return useMemo(
    () => ({
      read: (deployment) => store.read(deployment) ?? '',
      save: (deployment, token) => {
        store.set(deployment, token);
        rerender();
      },
      clear: (deployment) => {
        store.clear(deployment);
        rerender();
      },
    }),
    [store],
  );
}
