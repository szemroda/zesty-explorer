import { afterEach, describe, expect, it } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';
import type { CollectionNode, PersistedView, SharedState } from '../domain';
import { v1EmptyColumnsFragment } from './fixtures/v1-empty-columns-fragment';
import { v1Fragment } from './fixtures/v1-fragment';
import { createBrowserSessionTokenStore, ViewCodec } from './index';

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

// The link for an Explorer view in the Explorer tab.
function shared(explorerView: PersistedView): SharedState {
  return {
    version: 3,
    instance: { instanceZuid: '8-abc123', deployment: 'production' },
    tab: 'explorer',
    view: explorerView,
  };
}

function gzipFragment(value: unknown): string {
  return `#view=${base64Url(gzipSync(strToU8(JSON.stringify(value)), { mtime: 0 }))}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('ViewCodec', () => {
  it('round-trips canonically and reports fragment length', () => {
    const encoded = ViewCodec.encode(shared(view));
    expect(encoded.fragment).toMatch(/^#view=/);
    expect(encoded.length).toBe(encoded.fragment.length);
    expect(ViewCodec.decode(encoded.fragment)).toEqual({ ok: true, state: shared(view) });
    expect(ViewCodec.encode(shared(view))).toEqual(encoded);
  });

  it('round-trips the Code tab selection with or without an Explorer view', () => {
    const codeOnly: SharedState = {
      version: 3,
      instance: { instanceZuid: '8-abc123', deployment: 'stage' },
      tab: 'code',
      codeSelection: { state: 'published', fileId: '11-endpoint01' },
      codeFileFilter: '/api/',
    };
    const both: SharedState = { ...shared(view), codeSelection: { state: 'latest' } };

    expect(ViewCodec.decode(ViewCodec.encode(codeOnly).fragment)).toEqual({
      ok: true,
      state: codeOnly,
    });
    expect(ViewCodec.decode(ViewCodec.encode(both).fragment)).toEqual({ ok: true, state: both });
  });

  it('restores a version-two view link in the Explorer tab', () => {
    expect(ViewCodec.decode(gzipFragment(view))).toEqual({ ok: true, state: shared(view) });
  });

  it('rejects a view from another instance and invalid Code tab state', () => {
    expect(() =>
      ViewCodec.encode({
        ...shared(view),
        instance: { instanceZuid: '8-other1', deployment: 'production' },
      }),
    ).toThrow(/valid, settled/i);
    expect(
      ViewCodec.decode(
        gzipFragment({ ...shared(view), codeSelection: { state: 'latest', fileId: '../etc' } }),
      ).ok,
    ).toBe(false);
    expect(ViewCodec.decode(gzipFragment({ ...shared(view), codeFileFilter: 1 })).ok).toBe(false);
  });

  it('round-trips an unrecognized collection type without inventing a Manager area', () => {
    const otherView: PersistedView = {
      ...view,
      root: {
        ...root,
        reference: { ...root.reference, area: 'other' },
      },
    };
    const encoded = ViewCodec.encode(shared(otherView));
    expect(ViewCodec.decode(encoded.fragment)).toEqual({ ok: true, state: shared(otherView) });
  });

  it('decodes the version-one golden link fixture', () => {
    expect(ViewCodec.decode(v1Fragment)).toEqual({ ok: true, state: shared(view) });
  });

  it('migrates version-one default columns without losing their meaning', () => {
    const decoded = ViewCodec.decode(v1EmptyColumnsFragment);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.state.view?.version).toBe(2);
    expect(decoded.state.view?.root.presentation.visibleColumns).toEqual(['*']);
  });

  it('migrates the previous native relationship representation', () => {
    const legacyView = {
      ...view,
      root: {
        ...root,
        children: [
          {
            ...root,
            id: 'node-child',
            relationship: {
              kind: 'native',
              parentField: ['article'],
              targetModelZuid: root.reference.modelZuid,
            },
          },
        ],
      },
    };
    const decoded = ViewCodec.decode(gzipFragment(legacyView));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.state.view?.root.children[0]?.relationship).toEqual({
      kind: 'native',
      fieldSide: 'parent',
      field: ['article'],
      relatedModelZuid: root.reference.modelZuid,
    });
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
      ViewCodec.encode(
        shared({
          ...view,
          root: {
            ...root,
            reference: { ...root.reference, apiBaseUrl: 'https://example.com/v1' },
          },
        }),
      ),
    ).toThrow(/valid, settled/i);
    expect(() =>
      ViewCodec.encode(
        shared({
          ...view,
          root: {
            ...root,
            presentation: { ...root.presentation, columnWidths: { title: -1 } },
          },
        }),
      ),
    ).toThrow(/valid, settled/i);
    expect(() =>
      ViewCodec.encode(
        shared({
          ...view,
          root: {
            ...root,
            children: [
              {
                ...root,
                id: 'node-child',
                relationship: {
                  kind: 'native',
                  fieldSide: 'child',
                  field: [],
                  relatedModelZuid: root.reference.modelZuid,
                },
              },
            ],
          },
        }),
      ),
    ).toThrow(/valid, settled/i);
  });

  it('refuses secrets and ephemeral state at runtime', () => {
    expect(() =>
      ViewCodec.encode(shared({ ...view, sessionToken: 'secret' } as PersistedView)),
    ).toThrow(/non-secret view state/i);
    expect(() =>
      ViewCodec.encode(shared({ ...view, expandedRows: ['7-a'] } as PersistedView)),
    ).toThrow(/non-secret view state/i);
  });
});

describe('session token store', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('keeps one trimmed token per deployment in sessionStorage only', () => {
    const store = createBrowserSessionTokenStore();
    store.set('production', '  production-token  ');
    store.set('stage', 'stage-token');

    const freshStore = createBrowserSessionTokenStore();
    expect(freshStore.read('production')).toBe('production-token');
    expect(freshStore.read('development')).toBeNull();
    expect(window.sessionStorage).toHaveLength(2);
    expect(window.localStorage).toHaveLength(0);

    store.clear('production');
    expect(store.read('production')).toBeNull();
    expect(store.read('stage')).toBe('stage-token');
  });

  it('refuses an empty token', () => {
    expect(() => createBrowserSessionTokenStore().set('production', '   ')).toThrow(/empty/);
  });
});
