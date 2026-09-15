import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Effect, Either } from 'effect';
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
import { parseCollectionReference, parseInstanceReference } from '../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  ContentItem,
  ContentState,
  InstanceReference,
  ModelZuid,
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
import { CollectionPicker } from './components/CollectionPicker';
import { ErrorTechnicalDetails } from './components/ErrorTechnicalDetails';
import { ItemDetails } from './components/ItemDetails';
import { RootTable } from './components/RootTable';
import { TreeEditor } from './components/TreeEditor';
import { createChildNode } from './view-state';
import { describeExplorerError } from './error-message';
import { useLoadedView } from './hooks/useLoadedView';
import { useCollectionCatalog } from './hooks/useCollectionCatalog';
import { Toaster } from './components/ui/toast';
import { ToastProvider, useAppToastManager } from './components/ui/toast-context';

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
  if (reference.area === 'other') {
    return `${reference.apiBaseUrl}/content/models/${reference.modelZuid}`;
  }
  return `${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}`;
}

function instanceReference(reference: CollectionReference): InstanceReference {
  return {
    instanceZuid: reference.instanceZuid,
    deployment: reference.deployment,
    apiBaseUrl: reference.apiBaseUrl,
    managerBaseUrl: reference.managerBaseUrl,
    suggestedModelZuid: reference.modelZuid,
    ...(reference.itemZuid ? { suggestedItemZuid: reference.itemZuid } : {}),
    suggestedArea: reference.area,
  };
}

function Explorer({ api, tokenStore }: ExplorerProps) {
  const toastManager = useAppToastManager();
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
  const [selectingRoot, setSelectingRoot] = useState(false);
  const [catalogInstance, setCatalogInstance] = useState<InstanceReference | undefined>(() =>
    initial.view ? instanceReference(initial.view.root.reference) : undefined,
  );
  const [selectedRootZuid, setSelectedRootZuid] = useState<ModelZuid | undefined>(
    initial.view?.root.reference.modelZuid,
  );
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const topMenu = useRef<HTMLDetailsElement>(null);
  const [tokenRequired, setTokenRequired] = useState(Boolean(initial.view && !initialToken));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [relationshipSchemaSemaphore] = useState(() => Effect.runSync(Effect.makeSemaphore(2)));

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
      !changingRoot &&
      !selectingRoot,
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
  const catalogQuery = useCollectionCatalog({
    api,
    reference: catalogInstance,
    sessionToken: activeToken,
    enabled: Boolean(catalogInstance && activeToken),
  });

  const refreshAll = useCallback(
    async function refreshAllRequests() {
      if (isRefreshing) return;
      setIsRefreshing(true);
      let succeeded: boolean;
      try {
        const [catalogSucceeded, collectionsSucceeded] = await Promise.all([
          catalogQuery.refresh(),
          refreshCollections(),
        ]);
        succeeded = catalogSucceeded && collectionsSucceeded;
      } catch {
        succeeded = false;
      } finally {
        setIsRefreshing(false);
      }
      setRefreshFailed(!succeeded);
      if (succeeded) {
        toastManager.close('refresh-failed');
        return;
      }
      toastManager.add({
        id: 'refresh-failed',
        title: 'Refresh failed',
        description: 'Some data could not be refreshed. The current view remains available.',
        priority: 'low',
        timeout: 8_000,
        data: { retry: () => void refreshAllRequests() },
      });
    },
    [catalogQuery, isRefreshing, refreshCollections, toastManager],
  );
  const rootFailure = loadStatus.kind === 'failed' ? loadStatus.failure : undefined;
  const queryErrorMessage = rootFailure
    ? describeExplorerError(rootFailure, window.location.origin)
    : undefined;
  const catalogAuthenticationFailed = catalogQuery.error?.kind === 'authentication';
  useEffect(() => {
    const failedDeployment = catalogAuthenticationFailed
      ? catalogInstance?.deployment
      : authenticationFailed
        ? reference?.deployment
        : undefined;
    if (!failedDeployment) return;
    tokenStore.clear(failedDeployment);
    const update = window.setTimeout(() => {
      setToken('');
      setActiveToken('');
      setTokenRequired(true);
      setCatalogInstance(undefined);
      setSelectingRoot(false);
    }, 0);
    return () => window.clearTimeout(update);
  }, [
    authenticationFailed,
    catalogAuthenticationFailed,
    catalogInstance?.deployment,
    reference?.deployment,
    tokenStore,
  ]);

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
  const loadRelationshipSchema = useCallback(
    async (collectionReference: CollectionReference, signal: AbortSignal) => {
      const result = await Effect.runPromise(
        api
          .loadCollectionSchema(collectionReference, activeToken)
          .pipe(relationshipSchemaSemaphore.withPermits(1), Effect.either),
        { signal },
      );
      return Either.isRight(result)
        ? ({ ok: true, schema: result.right } as const)
        : ({ ok: false, message: result.left.message } as const);
    },
    [activeToken, api, relationshipSchemaSemaphore],
  );

  function loadCatalog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseInstanceReference(collectionInput);
    if (!parsed.ok) {
      setInputError(parsed.error.message);
      return;
    }
    if (!token.trim() || tokenDeployment !== parsed.value.deployment) {
      setInputError('Enter the Zesty session token for this deployment.');
      return;
    }

    tokenStore.set(parsed.value.deployment, token);
    setActiveToken(token);
    setTokenDeployment(parsed.value.deployment);
    setCatalogInstance(parsed.value);
    setSelectedRootZuid(parsed.value.suggestedModelZuid);
    setInputError(undefined);
    setTokenRequired(false);
    setSelectingRoot(true);
  }

  const rootPickerCollections = useMemo(() => {
    const collections = [...(catalogQuery.catalog?.collections ?? [])];
    const parsed = parseCollectionReference(collectionInput);
    if (!catalogInstance) return collections;
    const fallbackReference: CollectionReference | undefined =
      parsed.ok &&
      parsed.value.instanceZuid === catalogInstance.instanceZuid &&
      parsed.value.deployment === catalogInstance.deployment
        ? parsed.value
        : catalogInstance.suggestedModelZuid
          ? {
              instanceZuid: catalogInstance.instanceZuid,
              modelZuid: catalogInstance.suggestedModelZuid,
              deployment: catalogInstance.deployment,
              area: catalogInstance.suggestedArea ?? 'other',
              apiBaseUrl: catalogInstance.apiBaseUrl,
              managerBaseUrl: catalogInstance.managerBaseUrl,
            }
          : undefined;
    if (!fallbackReference) return collections;
    if (
      collections.some(
        (collection) => collection.reference.modelZuid === fallbackReference.modelZuid,
      )
    )
      return collections;
    collections.push({
      label: fallbackReference.modelZuid,
      name: fallbackReference.modelZuid,
      type: 'uncatalogued',
      group: fallbackReference.area,
      reference: fallbackReference,
    });
    return collections;
  }, [catalogInstance, catalogQuery.catalog?.collections, collectionInput]);

  function confirmRoot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = rootPickerCollections.find(
      (collection) => collection.reference.modelZuid === selectedRootZuid,
    );
    if (!selected) {
      setInputError('Choose a root collection or paste a collection reference.');
      return;
    }
    const selectedReference: CollectionReference = {
      ...selected.reference,
      ...(catalogInstance?.suggestedModelZuid === selected.reference.modelZuid &&
      catalogInstance.suggestedItemZuid
        ? { itemZuid: catalogInstance.suggestedItemZuid }
        : {}),
    };
    const replacingRoot = Boolean(
      treeRoot &&
      (treeRoot.reference.instanceZuid !== selectedReference.instanceZuid ||
        treeRoot.reference.modelZuid !== selectedReference.modelZuid ||
        treeRoot.reference.deployment !== selectedReference.deployment),
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

    setReference(selectedReference);
    setTreeRoot((current) => {
      if (
        current?.reference.instanceZuid === selectedReference.instanceZuid &&
        current.reference.modelZuid === selectedReference.modelZuid &&
        current.reference.deployment === selectedReference.deployment
      ) {
        return current;
      }
      return {
        id: 'node-root',
        name: selected.label,
        reference: selectedReference,
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
    setSelectedItemId(selectedReference.itemZuid);
    setInputError(undefined);
    setTokenRequired(false);
    setChangingRoot(false);
    setSelectingRoot(false);
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
    setCatalogInstance(undefined);
    setSelectingRoot(false);
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
    setSelectingRoot(false);
    setCatalogInstance(undefined);
    setSelectedRootZuid(undefined);
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
    setSelectingRoot(false);
    setCatalogInstance(instanceReference(reference));
    setSelectedRootZuid(reference.modelZuid);
  }

  const showStart = !reference || tokenRequired || changingRoot || selectingRoot;

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
              <button
                className="button button--quiet refresh-button"
                onClick={() => void refreshAll()}
                disabled={isRefreshing}
                aria-describedby={refreshFailed ? 'refresh-status' : undefined}
                {...(refreshFailed ? { 'data-refresh-failed': '' } : {})}
              >
                <RefreshCw
                  className={isRefreshing ? 'refresh-icon refresh-icon--spinning' : 'refresh-icon'}
                  size={14}
                  aria-hidden="true"
                />
                Refresh
                {refreshFailed ? <span className="refresh-failure-dot" aria-hidden="true" /> : null}
              </button>
              {refreshFailed ? (
                <span id="refresh-status" className="sr-only" role="status">
                  The last refresh failed. Activate Refresh to retry.
                </span>
              ) : null}
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
              catalog={catalogQuery.catalog?.collections ?? []}
              catalogError={catalogQuery.error}
              catalogWarning={catalogQuery.catalog?.warning}
              onRetryCatalog={() => void catalogQuery.refresh()}
              loadSchema={loadRelationshipSchema}
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
            selectingRoot ? (
              <form
                className="start-card"
                aria-labelledby="root-picker-title"
                onSubmit={confirmRoot}
              >
                <p className="eyebrow">Choose a root</p>
                <h2 id="root-picker-title">Choose the root collection</h2>
                {catalogQuery.isLoading ? (
                  <p className="muted" role="status">
                    Loading collection catalog…
                  </p>
                ) : null}
                {catalogQuery.error ? (
                  <div className="catalog-state catalog-state--error" role="alert">
                    <p>{catalogQuery.error.message}</p>
                    <ErrorTechnicalDetails error={catalogQuery.error} />
                    <button
                      type="button"
                      className="button"
                      onClick={() => void catalogQuery.refresh()}
                    >
                      Retry catalog
                    </button>
                  </div>
                ) : null}
                {catalogQuery.catalog && catalogQuery.catalog.collections.length === 0 ? (
                  <p className="catalog-state" role="status">
                    This session returned an empty collection catalog.
                  </p>
                ) : null}
                <CollectionPicker
                  label="Root collection"
                  collections={rootPickerCollections}
                  value={selectedRootZuid}
                  onChange={(collection) => setSelectedRootZuid(collection?.reference.modelZuid)}
                  disabled={catalogQuery.isLoading && rootPickerCollections.length === 0}
                />
                {catalogQuery.catalog?.warning ? (
                  <div className="catalog-warning" role="status">
                    <p>{catalogQuery.catalog.warning.message}</p>
                    <ErrorTechnicalDetails error={catalogQuery.catalog.warning} />
                  </div>
                ) : null}
                <div className="manual-reference">
                  <span className="manual-reference__label">Or paste a collection reference</span>
                  <input
                    type="url"
                    aria-label="Root collection reference"
                    value={collectionInput}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCollectionInput(value);
                      const parsed = parseCollectionReference(value);
                      if (
                        parsed.ok &&
                        parsed.value.instanceZuid === catalogInstance?.instanceZuid &&
                        parsed.value.deployment === catalogInstance.deployment
                      ) {
                        setSelectedRootZuid(parsed.value.modelZuid);
                      }
                    }}
                  />
                </div>
                {inputError ? <p className="error-message">{inputError}</p> : null}
                <div className="start-card__actions">
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => {
                      setSelectingRoot(false);
                      if (!reference) setCatalogInstance(undefined);
                    }}
                  >
                    Back
                  </button>
                  <button
                    className="button button--primary"
                    type="submit"
                    disabled={!selectedRootZuid}
                  >
                    Open root collection
                  </button>
                </div>
              </form>
            ) : (
              <form className="start-card" aria-labelledby="start-title" onSubmit={loadCatalog}>
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
                  Copy APP_SID for production, STAGE_APP_SID for stage, or DEV_APP_SID for
                  development from your Zesty Manager cookies. It carries your permissions. Do not
                  share it.
                </details>

                <label className="field-label" htmlFor="collection-url">
                  Zesty instance URL
                </label>
                <input
                  id="collection-url"
                  type="url"
                  value={collectionInput}
                  placeholder="https://8-….manager.zesty.io/content/6-…"
                  onChange={(event) => {
                    const value = event.target.value;
                    setCollectionInput(value);
                    const parsed = parseInstanceReference(value);
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
                  Paste any URL from an allowed Zesty Manager host, or a recognized Instances API
                  instance or model URL.
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
                    Load collections
                  </button>
                </div>
              </form>
            )
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
      <ToastProvider limit={2}>
        <Explorer api={api} tokenStore={resolvedTokenStore} />
        <Toaster />
      </ToastProvider>
    </QueryClientProvider>
  );
}
