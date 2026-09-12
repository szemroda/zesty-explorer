import { describe, expect, it } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import type { CollectionNode, PersistedView } from '../domain';
import { v1EmptyColumnsFragment } from './fixtures/v1-empty-columns-fragment';
import { v1Fragment } from './fixtures/v1-fragment';
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
  version: 2,
  root,
  contentState: 'latest',
  viewFilters: [],
  globalFreeText: '',
};

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('ViewCodec', () => {
  it('round-trips canonically and reports fragment length', () => {
    const encoded = ViewCodec.encode(view);
    expect(encoded.fragment).toMatch(/^#view=/);
    expect(encoded.length).toBe(encoded.fragment.length);
    expect(ViewCodec.decode(encoded.fragment)).toEqual({ ok: true, view });
    expect(ViewCodec.encode(view)).toEqual(encoded);
  });

  it('decodes the version-one golden link fixture', () => {
    expect(ViewCodec.decode(v1Fragment)).toEqual({ ok: true, view });
  });

  it('migrates version-one default columns without losing their meaning', () => {
    const decoded = ViewCodec.decode(v1EmptyColumnsFragment);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.view.version).toBe(2);
    expect(decoded.view.root.presentation.visibleColumns).toEqual(['*']);
  });

  it('preserves corrupt raw data for recovery', () => {
    expect(ViewCodec.decode('#view=not-valid')).toEqual({
      ok: false,
      raw: 'not-valid',
      reason: 'The shared view is invalid or truncated.',
    });
  });

  it('rejects oversized encoded and decompressed payloads', () => {
    expect(ViewCodec.decode(`#view=${'a'.repeat(100_001)}`).ok).toBe(false);
    const compressedBomb = gzipSync(strToU8('a'.repeat(1_000_001)), { mtime: 0 });
    compressedBomb.fill(0, compressedBomb.length - 4);
    compressedBomb[compressedBomb.length - 4] = 1;
    expect(ViewCodec.decode(`#view=${base64Url(compressedBomb)}`).ok).toBe(false);
  });

  it('rejects unsafe hosts and invalid nested state after decompression', () => {
    expect(() =>
      ViewCodec.encode({
        ...view,
        root: {
          ...root,
          reference: { ...root.reference, apiBaseUrl: 'https://example.com/v1' },
        },
      }),
    ).toThrow(/valid, settled/i);
    expect(() =>
      ViewCodec.encode({
        ...view,
        root: {
          ...root,
          presentation: { ...root.presentation, columnWidths: { title: -1 } },
        },
      }),
    ).toThrow(/valid, settled/i);
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
