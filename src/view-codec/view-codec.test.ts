import { describe, expect, it } from 'vitest';
import type { CollectionNode, PersistedView } from '../domain';
import { createSessionTokenStore, ViewCodec } from './index';

const root = {
  id: 'node-root',
  name: 'Stories',
  reference: {
    instanceZuid: '8-abc123',
    modelZuid: '6-model123',
    deployment: 'production',
    area: 'content',
    apiBaseUrl: 'https://8-abc123.api.zesty.io/v1',
    managerBaseUrl: 'https://8-abc123.manager.zesty.io',
  },
  presentation: {
    visibleColumns: ['title', 'category'],
    columnWidths: { title: 320 },
    sort: { fieldPath: ['modified'], direction: 'desc' },
    filters: [],
    freeText: '',
  },
  children: [],
} as CollectionNode;

const view: PersistedView = {
  version: 1,
  root,
  contentState: 'latest',
  viewFilters: [],
  globalFreeText: '',
};

describe('ViewCodec', () => {
  it('round-trips canonically and reports fragment length', () => {
    const encoded = ViewCodec.encode(view);
    expect(encoded.fragment).toMatch(/^#view=/);
    expect(encoded.length).toBe(encoded.fragment.length);
    expect(ViewCodec.decode(encoded.fragment)).toEqual({ ok: true, view });
    expect(ViewCodec.encode(view)).toEqual(encoded);
  });

  it('preserves corrupt raw data for recovery', () => {
    expect(ViewCodec.decode('#view=not-valid')).toEqual({
      ok: false,
      raw: 'not-valid',
      reason: 'The shared view is invalid or truncated.',
    });
  });

  it('refuses secrets and ephemeral state at runtime', () => {
    expect(() => ViewCodec.encode({ ...view, sessionToken: 'secret' } as PersistedView)).toThrow(
      /non-secret view state/i,
    );
    expect(() => ViewCodec.encode({ ...view, expandedRows: ['7-a'] } as PersistedView)).toThrow(
      /non-secret view state/i,
    );
  });
});

describe('session token store', () => {
  it('sets, reads, and clears only sessionStorage', () => {
    const sessionStorage = new Map<string, string>();
    const localStorage = new Map<string, string>();
    const storage = {
      getItem: (key: string) => sessionStorage.get(key) ?? null,
      setItem: (key: string, value: string) => sessionStorage.set(key, value),
      removeItem: (key: string) => sessionStorage.delete(key),
    };
    const store = createSessionTokenStore(storage);
    store.set('production', 'private-value');
    expect(store.read('production')).toBe('private-value');
    expect(localStorage.size).toBe(0);
    store.clear('production');
    expect(store.read('production')).toBeNull();
  });
});
