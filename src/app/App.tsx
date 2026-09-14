import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Copy,
  Database,
  Eye,
  EyeOff,
  ListFilter,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCollectionReference } from '../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  ContentItem,
  ContentState,
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
  updateCollectionRelationship,
  updateNodePresentation,
} from '../explorer-core';
import { ViewCodec, type ViewDecodeResult } from '../view-codec';
import {
  createBrowserSessionTokenStore,
  type SessionTokenStore,
} from '../view-codec/session-token-store';
import { createZestyApi, fetchZestyTransport, type ZestyApi } from '../zesty-api';
import { FilterBuilder } from './components/FilterBuilder';
import { ErrorTechnicalDetails } from './components/ErrorTechnicalDetails';
import { ItemDetails } from './components/ItemDetails';
import { RootTable } from './components/RootTable';
import { TreeEditor } from './components/TreeEditor';
import { createChildNode } from './view-state';
import { describeExplorerError } from './error-message';
import { useLoadedView } from './hooks/useLoadedView';

interface AppProps {
  readonly api?: ZestyApi;
  readonly tokenStore?: SessionTokenStore;
}

interface ExplorerProps {
  readonly api: ZestyApi;
  readonly tokenStore: SessionTokenStore;
}

const defaultApi = createZestyApi(fetchZestyTransport);

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
  const [initialToken] = useState(() =>
    initial.view ? (tokenStore.read(initial.view.root.reference.deployment) ?? '') : '',
  );
  const [token, setToken] = useState(initialToken);
  const [activeToken, setActiveToken] = useState(initialToken);
  const [tokenDeployment, setTokenDeployment] = useState(initial.view?.root.reference.deployment);
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
  const [viewFiltersOpen, setViewFiltersOpen] = useState(Boolean(initial.view?.viewFilters.length));
  const [viewDecodeError, setViewDecodeError] = useState(initial.error);
  const [shareMessage, setShareMessage] = useState<string>();
  const [changingRoot, setChangingRoot] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const topMenu = useRef<HTMLDetailsElement>(null);
  const [tokenRequired, setTokenRequired] = useState(Boolean(initial.view && !initialToken));

  const encodedView = useMemo(() => {
    if (!treeRoot || viewDecodeError) return undefined;
    return ViewCodec.encode({
      version: 2,
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

  const requiresCompleteView = Boolean(
    treeRoot?.children.length &&
    (globalFreeText ||
      treeRoot.presentation.freeText ||
      viewFilters.some((filter) => filter.nodePath.length > 0) ||
      treeRoot.presentation.filters.some((filter) => filter.nodePath.length > 0)),
  );
  const loadedViewQuery = useLoadedView({
    api,
    root: treeRoot,
    contentState,
    sessionToken: activeToken,
    enabled: Boolean(
      treeRoot &&
      activeToken &&
      tokenDeployment === treeRoot.reference.deployment &&
      !tokenRequired &&
      !changingRoot,
    ),
    requiresCompleteView,
  });
  const {
    loadedView,
    rootSnapshot,
    rootSchema,
    status: loadStatus,
    authenticationFailed,
    isIncomplete: viewIsIncomplete,
    refresh: refreshCollections,
    retryRoot,
  } = loadedViewQuery;
  const rootFailure = loadStatus.kind === 'failed' ? loadStatus.failure : undefined;
  const queryErrorMessage = rootFailure
    ? describeExplorerError(rootFailure, window.location.origin)
    : undefined;
  useEffect(() => {
    if (!authenticationFailed || !reference) return;
    tokenStore.clear(reference.deployment);
    const update = window.setTimeout(() => {
      setToken('');
      setActiveToken('');
      setTokenRequired(true);
    }, 0);
    return () => window.clearTimeout(update);
  }, [authenticationFailed, reference, tokenStore]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId || !loadedView) return undefined;
    for (const state of loadedView.snapshots.snapshots.values()) {
      if (state.status !== 'complete' && state.status !== 'partial') continue;
      const item = state.snapshot.itemsById.get(selectedItemId as ContentItem['id']);
      if (item) return item;
    }
    return undefined;
  }, [loadedView, selectedItemId]);

  const descendantResultsPending = loadStatus.kind === 'loading-related-data';
  function openCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCollectionReference(collectionInput);
    if (!parsed.ok) {
      setInputError(parsed.error.message);
      return;
    }
    if (!token.trim() || tokenDeployment !== parsed.value.deployment) {
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
        `Replace the current root and remove these nodes: ${subtreeNodeNames(treeRoot, treeRoot.id).join(', ')}. Saved filters, columns, widths, sorts, and relationships will also be removed.`,
      )
    ) {
      return;
    }
    if (replacingRoot) {
      setViewFilters([]);
      setGlobalFreeText('');
      setContentState('latest');
    }

    tokenStore.set(parsed.value.deployment, token);
    setActiveToken(token);
    setTokenDeployment(parsed.value.deployment);
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
          visibleColumns: ['*'],
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
    setChangingRoot(false);
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
    setActiveToken('');
    setTokenDeployment(reference.deployment);
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
    setChangingRoot(false);
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

  function cancelRootReplacement() {
    if (!reference) return;
    setCollectionInput(collectionUrl(reference));
    setToken(activeToken);
    setTokenDeployment(reference.deployment);
    setInputError(undefined);
    setChangingRoot(false);
  }

  const showStart = !reference || tokenRequired || changingRoot;

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
  const openDetails = useCallback((item: ContentItem, trigger: HTMLElement) => {
    detailsTrigger.current = trigger;
    setSelectedItemId(item.id);
  }, []);

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Database size={17} />
          </span>
          <div>
            <h1>Zesty Explorer</h1>
            <span>Read-only content browser</span>
          </div>
        </div>
        <div className="top-actions">
          {reference ? (
            <>
              <label className="search-control global-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search the complete view"
                  placeholder="Search all collections"
                  value={globalFreeText}
                  onChange={(event) => setGlobalFreeText(event.target.value)}
                />
              </label>
              <div className="segmented-control" role="group" aria-label="Content version">
                <button
                  className="segmented-control__option"
                  aria-pressed={contentState === 'latest'}
                  onClick={() => setContentState('latest')}
                >
                  Latest
                </button>
                <button
                  className="segmented-control__option"
                  aria-pressed={contentState === 'published'}
                  onClick={() => setContentState('published')}
                >
                  Published
                </button>
              </div>
              <button className="button button--quiet" onClick={() => void refreshCollections()}>
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
              <button className="button button--quiet" onClick={() => void copyViewLink()}>
                <Copy size={14} aria-hidden="true" /> Copy view link
              </button>
              <details ref={topMenu} className="toolbar-menu top-menu">
                <summary className="icon-button" aria-label="View options">
                  <MoreHorizontal size={17} />
                </summary>
                <div className="toolbar-menu__popup top-menu__popup">
                  <button
                    className="menu-action"
                    onClick={() => {
                      topMenu.current?.removeAttribute('open');
                      setCollectionInput(collectionUrl(reference));
                      setChangingRoot(true);
                    }}
                  >
                    <Database size={14} /> Replace root collection
                  </button>
                  <button
                    className="menu-action"
                    onClick={() => {
                      topMenu.current?.removeAttribute('open');
                      resetView();
                    }}
                  >
                    <RotateCcw size={14} /> Reset view
                  </button>
                  <button
                    className="menu-action menu-action--danger"
                    onClick={() => {
                      topMenu.current?.removeAttribute('open');
                      clearToken();
                    }}
                  >
                    <Trash2 size={14} /> Clear saved token
                  </button>
                </div>
              </details>
            </>
          ) : (
            <span className="status-dot">No collection open</span>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="tree-panel" aria-label="Collection tree">
          {treeRoot && loadedView?.schemas.get(treeRoot.id) ? (
            <TreeEditor
              root={{
                ...treeRoot,
                name:
                  treeRoot.name === treeRoot.reference.modelZuid
                    ? loadedView.schemas.get(treeRoot.id)!.label
                    : treeRoot.name,
              }}
              rootSchema={loadedView.schemas.get(treeRoot.id)!}
              schemas={loadedView.schemas}
              onAdd={addRelatedCollection}
              onRename={(nodeId, name) =>
                setTreeRoot((root) => root && renameCollectionNode(root, nodeId, name))
              }
              onRemove={(nodeId) =>
                setTreeRoot((root) => (root ? removeCollectionNode(root, nodeId) : root))
              }
              onRelationshipChange={(nodeId, relationship) =>
                setTreeRoot((root) =>
                  root ? updateCollectionRelationship(root, nodeId, relationship) : root,
                )
              }
            />
          ) : reference ? (
            <>
              <div className="tree-heading">
                <Database size={15} /> <span>Collections</span>
              </div>
              <div className="tree-node tree-node--root">
                <span className="tree-node__dot" />
                <span>{reference.modelZuid}</span>
              </div>
            </>
          ) : (
            <div className="tree-empty">
              <Database size={18} />
              <p>Your collections will appear here.</p>
            </div>
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
              <p className="eyebrow">
                {tokenRequired
                  ? 'Session expired'
                  : changingRoot
                    ? 'Change this view'
                    : 'Start a view'}
              </p>
              <h2 id="start-title">
                {tokenRequired
                  ? 'Replace your session token'
                  : changingRoot
                    ? 'Replace the root collection'
                    : 'Open a Zesty collection'}
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
                  onChange={(event) => {
                    setToken(event.target.value);
                    const parsed = parseCollectionReference(collectionInput);
                    if (parsed.ok) setTokenDeployment(parsed.value.deployment);
                  }}
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
                onChange={(event) => {
                  const value = event.target.value;
                  setCollectionInput(value);
                  const parsed = parseCollectionReference(value);
                  if (!parsed.ok || parsed.value.deployment === tokenDeployment) return;
                  if (!tokenDeployment) {
                    setTokenDeployment(parsed.value.deployment);
                    return;
                  }
                  setToken(tokenStore.read(parsed.value.deployment) ?? '');
                  setTokenDeployment(parsed.value.deployment);
                }}
              />
              <p className="help-text">
                Paste a Content or Blocks URL from Zesty Manager, or a full Instances API collection
                URL.
              </p>
              {inputError ? <p className="error-message">{inputError}</p> : null}
              <div className="start-card__actions">
                {changingRoot ? (
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={cancelRootReplacement}
                  >
                    Cancel
                  </button>
                ) : null}
                <button className="button button--primary" type="submit">
                  Open collection
                </button>
              </div>
            </form>
          ) : null}

          {!showStart && loadStatus.kind === 'loading-root' ? (
            <div className="state-card">Loading collection…</div>
          ) : null}
          {!showStart && rootFailure ? (
            <div className="state-card state-card--error" role="alert">
              <h2>Collection could not load</h2>
              <p>{queryErrorMessage?.message ?? 'The collection request failed unexpectedly.'}</p>
              {queryErrorMessage ? <p>{queryErrorMessage.recovery}</p> : null}
              <ErrorTechnicalDetails error={rootFailure} />
              <button className="button" onClick={() => void retryRoot()}>
                Retry
              </button>
            </div>
          ) : null}
          {!showStart && loadedView && treeRoot && rootSnapshot && rootSchema ? (
            <>
              <details
                className="view-filters"
                aria-label="View filters"
                open={viewFiltersOpen}
                onToggle={(event) => setViewFiltersOpen(event.currentTarget.open)}
              >
                <summary>
                  <span className="view-filters__title">
                    <ListFilter size={15} />
                    <strong>View filters</strong>
                    <span>Filter results across the collection tree</span>
                  </span>
                  {viewFilters.length > 0 ? (
                    <span className="control-count">{viewFilters.length}</span>
                  ) : null}
                </summary>
                <div className="view-filters__panel">
                  <FilterBuilder
                    label="View filter"
                    root={treeRoot}
                    schemas={loadedView.schemas}
                    filters={viewFilters}
                    onChange={setViewFilters}
                  />
                </div>
              </details>
              {descendantResultsPending ? (
                <p className="partial-warning" role="status">
                  Related data is loading. Descendant-dependent results will appear when it is
                  ready.
                </p>
              ) : null}
              {viewIsIncomplete ? (
                <p className="partial-warning" role="status">
                  This view contains incomplete collection data. Related results and filters may be
                  incomplete.
                </p>
              ) : null}
              {!descendantResultsPending ? (
                <RootTable
                  key={`${treeRoot.reference.instanceZuid}:${treeRoot.reference.modelZuid}:${treeRoot.id}`}
                  schema={rootSchema}
                  snapshot={rootSnapshot}
                  reference={treeRoot.reference}
                  treeRoot={treeRoot}
                  loadedView={loadedView}
                  contentState={contentState}
                  globalFreeText={globalFreeText}
                  viewFilters={viewFilters}
                  onOpenDetails={openDetails}
                  onRetry={() => void refreshCollections()}
                  onPresentationChange={changePresentation}
                />
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <ItemDetails
        item={selectedItem}
        finalFocus={detailsTrigger}
        onClose={() => {
          setSelectedItemId(undefined);
          window.setTimeout(() => detailsTrigger.current?.focus(), 100);
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
