import type { Deployment } from '../domain';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionTokenStore {
  read(deployment: Deployment): string | null;
  set(deployment: Deployment, token: string): void;
  clear(deployment: Deployment): void;
}

const keyPrefix = 'zesty-explorer:session-token:';

export function createSessionTokenStore(storage: StorageAdapter): SessionTokenStore {
  return {
    read: (deployment) => storage.getItem(`${keyPrefix}${deployment}`),
    set: (deployment, token) => {
      const trimmed = token.trim();
      if (!trimmed) throw new Error('Session token cannot be empty.');
      storage.setItem(`${keyPrefix}${deployment}`, trimmed);
    },
    clear: (deployment) => storage.removeItem(`${keyPrefix}${deployment}`),
  };
}

export function createBrowserSessionTokenStore(): SessionTokenStore {
  return createSessionTokenStore(window.sessionStorage);
}
