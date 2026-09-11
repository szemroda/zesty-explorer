import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCollectionReference } from '../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  ContentItem,
  ContentState,
  ExplorerError,
  NodePresentation,
  PersistedView,
  RelationshipDefinition,
  ViewFilter,
} from '../domain';
import {
  addCollectionNode,
  removeCollectionNode,
  renameCollectionNode,
  subtreeNodeNames,
  updateNodePresentation,
} from '../explorer-core';
import { ViewCodec, type ViewDecodeResult } from '../view-codec';
import {
  createBrowserSessionTokenStore,
  type SessionTokenStore,
} from '../view-codec/session-token-store';
import { createZestyApi, fetchZestyTransport, type ZestyApi } from '../zesty-api';
import { snapshotQueryKey } from '../zesty-api';
import { FilterBuilder } from './components/FilterBuilder';
import { ItemDetails } from './components/ItemDetails';
import { RootTable } from './components/RootTable';
import { TreeEditor } from './components/TreeEditor';
import { createChildNode } from './view-state';
import { loadView, viewLoadKey, ViewLoadError } from './load-view';
import { describeExplorerError } from './error-message';

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

type InvalidSharedView = Extract<ViewDecodeResult, { readonly ok: false }>;

function initialSharedView(): {
  readonly view?: PersistedView;
  readonly error?: InvalidSharedView;
} {
  if (!window.location.hash.startsWith('#view=')) return {};
  const decoded = ViewCodec.decode(window.location.hash);
  return decoded.ok ? { view: decoded.view } : { error: decoded };
}

function collectionUrl(reference: CollectionReference): string {
  return `${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}`;
}

function Explorer({ api, tokenStore }: ExplorerProps) {
  const [initial] = useState(initialSharedView);
  const [token, setToken] = useState(() =>
    initial.view ? (tokenStore.read(initial.view.root.reference.deployment) ?? '') : '',
  );
  const [showToken, setShowToken] = useState(false);
  const [collectionInput, setCollectionInput] = useState(() =>
    initial.view ? collectionUrl(initial.view.root.reference) : '',
  );
  const [inputError, setInputError] = useState<string>();
  const [reference, setReference] = useState<CollectionReference | undefined>(
    initial.view?.root.reference,
  );
  const [treeRoot, setTreeRoot] = useState<CollectionNode | undefined>(initial.view?.root);
  const [contentState, setContentState] = useState<ContentState>(
    initial.view?.contentState ?? 'latest',
  );
  const [globalFreeText, setGlobalFreeText] = useState(initial.view?.globalFreeText ?? '');
  const [viewFilters, setViewFilters] = useState<readonly ViewFilter[]>(
    initial.view?.viewFilters ?? [],
  );
  const [viewDecodeError, setViewDecodeError] = useState(initial.error);
  const [shareMessage, setShareMessage] = useState<string>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [tokenRequired, setTokenRequired] = useState(Boolean(initial.view && !token));

  const encodedView = useMemo(() => {
    if (!treeRoot || viewDecodeError) return undefined;
    return ViewCodec.encode({
      version: 1,
      root: treeRoot,
      contentState,
      viewFilters,
      globalFreeText,
    });
  }, [contentState, globalFreeText, treeRoot, viewDecodeError, viewFilters]);

  useEffect(() => {
    if (viewDecodeError) return;
    if (!treeRoot) {
      if (window.location.hash.startsWith('#view=')) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}`,
        );
      }
      return;
    }
    if (encodedView) window.history.replaceState(null, '', encodedView.fragment);
  }, [encodedView, treeRoot, viewDecodeError]);

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
  const queryErrorMessage = queryError ? describeExplorerError(queryError.failure) : undefined;
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

    const replacingRoot = Boolean(
      treeRoot &&
      (treeRoot.reference.instanceZuid !== parsed.value.instanceZuid ||
        treeRoot.reference.modelZuid !== parsed.value.modelZuid ||
        treeRoot.reference.deployment !== parsed.value.deployment),
    );
    if (
      replacingRoot &&
      treeRoot &&
      !window.confirm(
        `Replace the current root and discard ${subtreeNodeNames(treeRoot, treeRoot.id).length} collection nodes and their saved settings?`,
      )
    ) {
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

  function resetView() {
    if (!window.confirm('Reset the complete view? Your session token will be preserved.')) return;
    setTreeRoot(undefined);
    setReference(undefined);
    setCollectionInput('');
    setContentState('latest');
    setGlobalFreeText('');
    setViewFilters([]);
    setSelectedItemId(undefined);
    setViewDecodeError(undefined);
    setTokenRequired(false);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }

  async function copyViewLink() {
    await navigator.clipboard.writeText(window.location.href);
    setShareMessage('View link copied. The session token is not included.');
  }

  async function copyRawView() {
    if (!viewDecodeError) return;
    await navigator.clipboard.writeText(viewDecodeError.raw);
    setShareMessage('Raw view data copied.');
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

  const changePresentation = useCallback(
    (nodeId: CollectionNodeId, presentation: NodePresentation) =>
      setTreeRoot((root) => (root ? updateNodePresentation(root, nodeId, presentation) : root)),
    [],
  );

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
              <button className="button button--quiet" onClick={() => void copyViewLink()}>
                <Copy size={14} aria-hidden="true" /> Copy view link
              </button>
              <button className="button button--quiet" onClick={resetView}>
                <RotateCcw size={14} aria-hidden="true" /> Reset view
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
          {encodedView && encodedView.length > 8_000 ? (
            <p className="share-message" role="status">
              This view link is {encodedView.length.toLocaleString()} characters and may be too long
              for some tools.
            </p>
          ) : null}
          {shareMessage ? (
            <p className="share-message" role="status">
              {shareMessage}
            </p>
          ) : null}
          {viewDecodeError ? (
            <div className="state-card state-card--error" role="alert">
              <h2>Shared view could not be restored</h2>
              <p>{viewDecodeError.reason}</p>
              <div className="button-row">
                <button className="button" onClick={() => void copyRawView()}>
                  Copy raw view data
                </button>
                <button className="button button--primary" onClick={resetView}>
                  Reset view
                </button>
              </div>
            </div>
          ) : showStart ? (
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
              <p>{queryErrorMessage?.message ?? 'The collection request failed unexpectedly.'}</p>
              {queryErrorMessage ? <p>{queryErrorMessage.recovery}</p> : null}
              <button className="button" onClick={() => void query.refetch()}>
                Retry
              </button>
            </div>
          ) : null}
          {!showStart && query.data && treeRoot ? (
            <>
              <section className="view-filters" aria-label="View filters">
                <div>
                  <p className="eyebrow">Root result rules</p>
                  <strong>View filters</strong>
                </div>
                <FilterBuilder
                  label="View filter"
                  root={treeRoot}
                  schemas={query.data.schemas}
                  filters={viewFilters}
                  onChange={setViewFilters}
                />
              </section>
              {query.isFetching &&
              (viewFilters.some((filter) => filter.nodePath.length > 0) || globalFreeText) ? (
                <p className="partial-warning" role="status">
                  Related data is loading. Descendant-dependent results are not final yet.
                </p>
              ) : null}
              {[...query.data.snapshots.snapshots.values()].some(
                (state) => state.status === 'partial',
              ) ? (
                <p className="partial-warning" role="status">
                  This view contains incomplete collection data. Related results and filters may be
                  incomplete.
                </p>
              ) : null}
              <RootTable
                key={`${treeRoot.reference.instanceZuid}:${treeRoot.reference.modelZuid}:${treeRoot.id}`}
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
                viewFilters={viewFilters}
                onOpenDetails={(item, trigger) => {
                  detailsTrigger.current = trigger;
                  setSelectedItemId(item.id);
                }}
                onRetry={() => void query.refetch()}
                onPresentationChange={changePresentation}
              />
            </>
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
