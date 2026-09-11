import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseCollectionReference } from '../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  ContentItem,
  ContentState,
  ExplorerError,
  RelationshipDefinition,
} from '../domain';
import { addCollectionNode, removeCollectionNode, renameCollectionNode } from '../explorer-core';
import {
  createBrowserSessionTokenStore,
  type SessionTokenStore,
} from '../view-codec/session-token-store';
import { createZestyApi, fetchZestyTransport, type ZestyApi } from '../zesty-api';
import { snapshotQueryKey } from '../zesty-api';
import { ItemDetails } from './components/ItemDetails';
import { RootTable } from './components/RootTable';
import { TreeEditor } from './components/TreeEditor';
import { createChildNode } from './view-state';
import { loadView, viewLoadKey, ViewLoadError } from './load-view';

interface AppProps {
  readonly api?: ZestyApi;
  readonly tokenStore?: SessionTokenStore;
}

interface ExplorerProps {
  readonly api: ZestyApi;
  readonly tokenStore: SessionTokenStore;
}

const defaultApi = createZestyApi(fetchZestyTransport);

class ExplorerQueryError extends Error {
  constructor(readonly failure: ExplorerError) {
    super(failure.message);
    this.name = 'ExplorerQueryError';
  }
}

function isExplorerError(value: unknown): value is ExplorerError {
  return Boolean(value && typeof value === 'object' && 'kind' in value && 'message' in value);
}

function Explorer({ api, tokenStore }: ExplorerProps) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [collectionInput, setCollectionInput] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [reference, setReference] = useState<CollectionReference>();
  const [treeRoot, setTreeRoot] = useState<CollectionNode>();
  const [contentState, setContentState] = useState<ContentState>('latest');
  const [globalFreeText, setGlobalFreeText] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [tokenRequired, setTokenRequired] = useState(false);

  const query = useQuery({
    queryKey: treeRoot
      ? ['view', contentState, ...viewLoadKey(treeRoot, contentState)]
      : ['view', 'closed'],
    enabled: Boolean(treeRoot && token && !tokenRequired),
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      if (!treeRoot || !token) throw new Error('Collection request is not ready.');
      try {
        return await loadView(api, treeRoot, contentState, token);
      } catch (error) {
        if (error instanceof ViewLoadError) throw new ExplorerQueryError(error.failure);
        if (isExplorerError(error)) throw new ExplorerQueryError(error);
        throw error;
      }
    },
  });

  const queryError = query.error instanceof ExplorerQueryError ? query.error : null;
  const nestedAuthenticationError = [...(query.data?.snapshots.snapshots.values() ?? [])].find(
    (state) => state.status === 'failed' && state.error.kind === 'authentication',
  );
  const authenticationFailed =
    queryError?.failure.kind === 'authentication' || nestedAuthenticationError !== undefined;
  useEffect(() => {
    if (!authenticationFailed || !reference) return;
    tokenStore.clear(reference.deployment);
    const update = window.setTimeout(() => {
      setToken('');
      setTokenRequired(true);
    }, 0);
    return () => window.clearTimeout(update);
  }, [authenticationFailed, reference, tokenStore]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId || !query.data) return undefined;
    for (const state of query.data.snapshots.snapshots.values()) {
      if (state.status !== 'complete' && state.status !== 'partial') continue;
      const item = state.snapshot.itemsById.get(selectedItemId as ContentItem['id']);
      if (item) return item;
    }
    return undefined;
  }, [query.data, selectedItemId]);

  function openCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCollectionReference(collectionInput);
    if (!parsed.ok) {
      setInputError(parsed.error.message);
      return;
    }
    if (!token.trim()) {
      setInputError('Enter the Zesty session token for this deployment.');
      return;
    }

    tokenStore.set(parsed.value.deployment, token);
    setReference(parsed.value);
    setTreeRoot((current) => {
      if (
        current?.reference.instanceZuid === parsed.value.instanceZuid &&
        current.reference.modelZuid === parsed.value.modelZuid &&
        current.reference.deployment === parsed.value.deployment
      ) {
        return current;
      }
      return {
        id: 'node-root',
        name: parsed.value.modelZuid,
        reference: parsed.value,
        presentation: {
          visibleColumns: [],
          columnWidths: {},
          sort: { fieldPath: ['modified'], direction: 'desc' },
          filters: [],
          freeText: '',
        },
        children: [],
      };
    });
    setSelectedItemId(parsed.value.itemZuid);
    setInputError(undefined);
    setTokenRequired(false);
  }

  function clearToken() {
    if (
      !reference ||
      !window.confirm('Clear the session token? The current view will stay open.')
    ) {
      return;
    }
    tokenStore.clear(reference.deployment);
    setToken('');
    setTokenRequired(true);
  }

  const showStart = !reference || tokenRequired;

  function addRelatedCollection(
    parentId: CollectionNodeId,
    childReference: CollectionReference,
    name: string,
    relationship: RelationshipDefinition,
  ): string | undefined {
    if (!treeRoot) return 'Open a root collection first.';
    const result = addCollectionNode(
      treeRoot,
      parentId,
      createChildNode(childReference, name, relationship),
    );
    if (!result.ok) return result.reason;
    setTreeRoot(result.root);
    return undefined;
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <span className="eyebrow">Local read-only browser</span>
          <h1>Zesty Explorer</h1>
        </div>
        <div className="top-actions">
          {reference ? (
            <>
              <input
                className="global-search"
                type="search"
                aria-label="Search the complete view"
                placeholder="Search view"
                value={globalFreeText}
                onChange={(event) => setGlobalFreeText(event.target.value)}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contentState === 'published'}
                  onChange={(event) =>
                    setContentState(event.target.checked ? 'published' : 'latest')
                  }
                />
                Published only
              </label>
              <button className="button button--quiet" onClick={() => void query.refetch()}>
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
              <button className="icon-button" aria-label="Clear session token" onClick={clearToken}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          ) : (
            <span className="status-dot">No collection open</span>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="tree-panel" aria-label="Collection tree">
          <p className="eyebrow">View</p>
          {treeRoot && query.data?.schemas.get(treeRoot.id) ? (
            <TreeEditor
              root={{
                ...treeRoot,
                name:
                  treeRoot.name === treeRoot.reference.modelZuid
                    ? query.data.schemas.get(treeRoot.id)!.label
                    : treeRoot.name,
              }}
              rootSchema={query.data.schemas.get(treeRoot.id)!}
              schemas={query.data.schemas}
              onAdd={addRelatedCollection}
              onRename={(nodeId, name) =>
                setTreeRoot((root) => root && renameCollectionNode(root, nodeId, name))
              }
              onRemove={(nodeId) =>
                setTreeRoot((root) => (root ? removeCollectionNode(root, nodeId) : root))
              }
            />
          ) : reference ? (
            <div className="tree-node">
              <span className="tree-node__dot" />
              <span>{reference.modelZuid}</span>
            </div>
          ) : (
            <p className="muted">Your root collection will appear here.</p>
          )}
        </aside>

        <section className="main-panel" aria-live="polite">
          {showStart ? (
            <form className="start-card" aria-labelledby="start-title" onSubmit={openCollection}>
              <p className="eyebrow">{tokenRequired ? 'Session expired' : 'Start a view'}</p>
              <h2 id="start-title">
                {tokenRequired ? 'Replace your session token' : 'Open a Zesty collection'}
              </h2>

              <label className="field-label" htmlFor="session-token">
                Zesty session token
              </label>
              <div className="input-with-action">
                <input
                  id="session-token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  autoComplete="off"
                  onChange={(event) => setToken(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showToken ? 'Hide session token' : 'Reveal session token'}
                  onClick={() => setShowToken((visible) => !visible)}
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <details className="help-text">
                <summary>How to find the token</summary>
                Copy APP_SID for production, STAGE_APP_SID for stage, or DEV_APP_SID for development
                from your Zesty Manager cookies. It carries your permissions. Do not share it.
              </details>

              <label className="field-label" htmlFor="collection-url">
                Root collection URL
              </label>
              <input
                id="collection-url"
                type="url"
                value={collectionInput}
                placeholder="https://8-….manager.zesty.io/content/6-…"
                onChange={(event) => setCollectionInput(event.target.value)}
              />
              <p className="help-text">
                Paste a Content or Blocks URL from Zesty Manager, or a full Instances API collection
                URL.
              </p>
              {inputError ? <p className="error-message">{inputError}</p> : null}
              <button className="button button--primary" type="submit">
                Open collection
              </button>
            </form>
          ) : null}

          {!showStart && query.isPending ? (
            <div className="state-card">Loading collection…</div>
          ) : null}
          {!showStart && queryError ? (
            <div className="state-card state-card--error" role="alert">
              <h2>Collection could not load</h2>
              <p>{queryError?.message ?? 'The collection request failed unexpectedly.'}</p>
              <button className="button" onClick={() => void query.refetch()}>
                Retry
              </button>
            </div>
          ) : null}
          {!showStart && query.data && treeRoot ? (
            <RootTable
              schema={query.data.schemas.get(treeRoot.id)!}
              snapshot={(() => {
                const state = query.data.snapshots.snapshots.get(
                  snapshotQueryKey(treeRoot.reference, contentState),
                );
                if (!state || (state.status !== 'complete' && state.status !== 'partial')) {
                  throw new Error('Root snapshot is unavailable.');
                }
                return state.snapshot;
              })()}
              reference={treeRoot.reference}
              treeRoot={treeRoot}
              loadedView={query.data}
              contentState={contentState}
              globalFreeText={globalFreeText}
              onOpenDetails={(item, trigger) => {
                detailsTrigger.current = trigger;
                setSelectedItemId(item.id);
              }}
              onRetry={() => void query.refetch()}
            />
          ) : null}
        </section>
      </div>

      <ItemDetails
        item={selectedItem}
        onClose={() => {
          setSelectedItemId(undefined);
          window.setTimeout(() => detailsTrigger.current?.focus(), 0);
        }}
      />
    </main>
  );
}

export function App({ api = defaultApi, tokenStore }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());
  const resolvedTokenStore = useMemo(
    () => tokenStore ?? createBrowserSessionTokenStore(),
    [tokenStore],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Explorer api={api} tokenStore={resolvedTokenStore} />
    </QueryClientProvider>
  );
}
