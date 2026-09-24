import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
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
import { toast } from 'sonner';
import { parseCollectionReference, parseInstanceReference } from '../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  ContentItem,
  ContentItemReference,
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
import { createZestyApi, fetchZestyTransport, snapshotQueryKey, type ZestyApi } from '../zesty-api';
import { FilterBuilder } from './components/FilterBuilder';
import { CollectionPicker } from './components/CollectionPicker';
import { ErrorTechnicalDetails } from './components/ErrorTechnicalDetails';
import { ItemDetails } from './components/ItemDetails';
import { RootTable } from './components/RootTable';
import { PublicationStatusProvider } from './components/PublicationStatusCell';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TreeEditor } from './components/TreeEditor';
import { createChildNode } from './view-state';
import { copyText } from './copy-text';
import { describeExplorerError } from './error-message';
import { useLoadedView } from './hooks/useLoadedView';
import { useCollectionCatalog } from './hooks/useCollectionCatalog';
import { useFieldProblem } from './hooks/useFieldProblem';
import {
  clearItemVersionPreviewCacheOutsideScope,
  refreshActiveItemVersionPreviews,
} from './hooks/useItemVersionPreview';
import {
  clearPublicationStatusCacheOutsideScope,
  refreshActivePublicationStatuses,
} from './hooks/publication-status-query';
import { flattenCollectionNodes } from './load-view';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Field, FieldDescription, FieldLabel } from './components/ui/field';
import { Input } from './components/ui/input';
import { Toaster } from './components/ui/sonner';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { SharedTooltip, TooltipProvider } from './components/ui/tooltip';

interface AppProps {
  readonly api?: ZestyApi;
  readonly tokenStore?: SessionTokenStore;
}

interface ExplorerProps {
  readonly api: ZestyApi;
  readonly tokenStore: SessionTokenStore;
}

const defaultApi = createZestyApi(fetchZestyTransport);
// Toasts with an action stay long enough to reach the button.
const actionToastDuration = 8_000;

interface RootChoice {
  readonly label: string;
  readonly reference: CollectionReference;
}

interface PendingRootReplacement extends RootChoice {
  readonly removedNodeNames: readonly string[];
}

interface PendingUndo {
  readonly toastId: string | number;
  // The tree the action left behind; any other tree makes the undo stale.
  readonly treeRoot: CollectionNode | undefined;
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
  const queryClient = useQueryClient();
  const [initial] = useState(initialSharedView);
  const [initialToken] = useState(() =>
    initial.view ? (tokenStore.read(initial.view.root.reference.deployment) ?? '') : '',
  );
  const [token, setToken] = useState(initialToken);
  const [activeToken, setActiveToken] = useState(initialToken);
  const credentialRevision = useMemo(
    () => (activeToken ? crypto.randomUUID() : 'no-credentials'),
    [activeToken],
  );
  const [tokenDeployment, setTokenDeployment] = useState(initial.view?.root.reference.deployment);
  const [showToken, setShowToken] = useState(false);
  const [collectionInput, setCollectionInput] = useState(() =>
    initial.view ? collectionUrl(initial.view.root.reference) : '',
  );
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
  const [changingRoot, setChangingRoot] = useState(false);
  const [selectingRoot, setSelectingRoot] = useState(false);
  const [catalogInstance, setCatalogInstance] = useState<InstanceReference | undefined>(() =>
    initial.view ? instanceReference(initial.view.root.reference) : undefined,
  );
  const [selectedRootZuid, setSelectedRootZuid] = useState<ModelZuid | undefined>(
    initial.view?.root.reference.modelZuid,
  );
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [previewAuthenticationFailureRevision, setPreviewAuthenticationFailureRevision] =
    useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [tokenRequired, setTokenRequired] = useState(Boolean(initial.view && !initialToken));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [pendingRootReplacement, setPendingRootReplacement] = useState<PendingRootReplacement>();
  const [clearTokenOpen, setClearTokenOpen] = useState(false);
  const sessionTokenInput = useRef<HTMLInputElement>(null);
  const instanceUrlInput = useRef<HTMLInputElement>(null);
  const rootCollectionInput = useRef<HTMLInputElement>(null);
  const rootReferenceInput = useRef<HTMLInputElement>(null);
  const startFormProblem = useFieldProblem({
    'session-token': sessionTokenInput,
    'instance-url': instanceUrlInput,
    'root-collection': rootCollectionInput,
    'root-reference': rootReferenceInput,
  });
  const pendingUndo = useRef<PendingUndo | undefined>(undefined);
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

  useEffect(() => {
    if (pendingUndo.current?.treeRoot === treeRoot) return;
    withdrawUndo();
  }, [treeRoot]);

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

  useEffect(() => {
    clearItemVersionPreviewCacheOutsideScope(queryClient, {
      credentialRevision,
      deployment: reference?.deployment,
      instanceZuid: reference?.instanceZuid,
    });
  }, [credentialRevision, queryClient, reference?.deployment, reference?.instanceZuid]);

  useEffect(() => {
    clearPublicationStatusCacheOutsideScope(queryClient, {
      credentialRevision,
      deployment: reference?.deployment,
      instanceZuid: reference?.instanceZuid,
    });
  }, [credentialRevision, queryClient, reference?.deployment, reference?.instanceZuid]);

  const refreshAll = useCallback(
    async function refreshAllRequests() {
      if (isRefreshing) return;
      setIsRefreshing(true);
      let succeeded: boolean;
      try {
        const [catalogSucceeded, collectionsSucceeded, previewSucceeded, statusSucceeded] =
          await Promise.all([
            catalogQuery.refresh(),
            refreshCollections(),
            refreshActiveItemVersionPreviews(queryClient),
            refreshActivePublicationStatuses(queryClient),
          ]);
        succeeded = catalogSucceeded && collectionsSucceeded && previewSucceeded && statusSucceeded;
      } catch {
        succeeded = false;
      } finally {
        setIsRefreshing(false);
      }
      setRefreshFailed(!succeeded);
      if (succeeded) {
        toast.dismiss('refresh-failed');
        return;
      }
      toast.error('Refresh failed', {
        id: 'refresh-failed',
        description: 'Some data could not be refreshed. The current view remains available.',
        duration: actionToastDuration,
        action: {
          label: 'Retry refresh',
          onClick: () => void refreshAllRequests(),
        },
      });
    },
    [catalogQuery, isRefreshing, queryClient, refreshCollections],
  );
  const rootFailure = loadStatus.kind === 'failed' ? loadStatus.failure : undefined;
  const queryErrorMessage = rootFailure
    ? describeExplorerError(rootFailure, window.location.origin)
    : undefined;
  const catalogAuthenticationFailed = catalogQuery.error?.kind === 'authentication';
  useEffect(() => {
    const failedDeployment = catalogAuthenticationFailed
      ? catalogInstance?.deployment
      : authenticationFailed || previewAuthenticationFailureRevision === credentialRevision
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
      setSelectedItemId(undefined);
    }, 0);
    return () => window.clearTimeout(update);
  }, [
    authenticationFailed,
    catalogAuthenticationFailed,
    catalogInstance?.deployment,
    credentialRevision,
    previewAuthenticationFailureRevision,
    reference?.deployment,
    tokenStore,
  ]);

  const selectedItemContext = useMemo(() => {
    if (!selectedItemId || !loadedView || !treeRoot) return undefined;
    for (const node of flattenCollectionNodes(treeRoot)) {
      const state = loadedView.snapshots.snapshots.get(
        snapshotQueryKey(node.reference, contentState),
      );
      if (!state) continue;
      if (state.status !== 'complete' && state.status !== 'partial') continue;
      const item = state.snapshot.itemsById.get(selectedItemId as ContentItem['id']);
      if (item) {
        const itemReference: ContentItemReference = {
          ...node.reference,
          itemZuid: item.id,
        };
        return { item, reference: itemReference };
      }
    }
    return undefined;
  }, [contentState, loadedView, selectedItemId, treeRoot]);

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
    const tokenMissing = 'Enter the Zesty session token for this deployment.';
    // Checked in screen order, so focus goes to the first field with a problem.
    if (!token.trim()) {
      startFormProblem.report('session-token', tokenMissing);
      return;
    }
    const parsed = parseInstanceReference(collectionInput);
    if (!parsed.ok) {
      startFormProblem.report('instance-url', parsed.error.message);
      return;
    }
    if (tokenDeployment !== parsed.value.deployment) {
      startFormProblem.report('session-token', tokenMissing);
      return;
    }

    withdrawUndo();
    tokenStore.set(parsed.value.deployment, token);
    setActiveToken(token);
    setTokenDeployment(parsed.value.deployment);
    setCatalogInstance(parsed.value);
    setSelectedRootZuid(parsed.value.suggestedModelZuid);
    startFormProblem.clear();
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

  // A pasted reference must name a collection in the loaded instance. The start form's bare
  // instance URL is carried into this field, so it counts as nothing pasted yet.
  function pastedReferenceProblem(): string | undefined {
    const input = collectionInput.trim();
    if (!input || !catalogInstance) return undefined;
    const parsed = parseCollectionReference(input);
    if (!parsed.ok) return parseInstanceReference(input).ok ? undefined : parsed.error.message;
    if (
      parsed.value.instanceZuid === catalogInstance.instanceZuid &&
      parsed.value.deployment === catalogInstance.deployment
    ) {
      return undefined;
    }
    return 'Paste a collection from the same Zesty instance and deployment.';
  }

  function confirmRoot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const referenceProblem = pastedReferenceProblem();
    if (referenceProblem) {
      startFormProblem.report('root-reference', referenceProblem);
      return;
    }
    const selected = rootPickerCollections.find(
      (collection) => collection.reference.modelZuid === selectedRootZuid,
    );
    if (!selected) {
      startFormProblem.report(
        'root-collection',
        'Choose a root collection or paste a collection reference.',
      );
      return;
    }
    const selectedReference: CollectionReference = {
      ...selected.reference,
      ...(catalogInstance?.suggestedModelZuid === selected.reference.modelZuid &&
      catalogInstance.suggestedItemZuid
        ? { itemZuid: catalogInstance.suggestedItemZuid }
        : {}),
    };
    if (
      treeRoot &&
      (treeRoot.reference.instanceZuid !== selectedReference.instanceZuid ||
        treeRoot.reference.modelZuid !== selectedReference.modelZuid ||
        treeRoot.reference.deployment !== selectedReference.deployment)
    ) {
      setPendingRootReplacement({
        label: selected.label,
        reference: selectedReference,
        removedNodeNames: subtreeNodeNames(treeRoot, treeRoot.id),
      });
      return;
    }
    openRoot({ label: selected.label, reference: selectedReference });
  }

  function replaceRoot(replacement: RootChoice) {
    setViewFilters([]);
    setGlobalFreeText('');
    setContentState('latest');
    openRoot(replacement);
  }

  // Keeps the current tree when the selected root is the one already open.
  function openRoot({ label, reference: selectedReference }: RootChoice) {
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
        name: label,
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
    startFormProblem.clear();
    setTokenRequired(false);
    setChangingRoot(false);
    setSelectingRoot(false);
  }

  function clearToken() {
    if (!reference) return;
    tokenStore.clear(reference.deployment);
    setToken('');
    setActiveToken('');
    setTokenDeployment(reference.deployment);
    setTokenRequired(true);
    setCatalogInstance(undefined);
    setSelectingRoot(false);
  }

  // Resets the view straight away; the toast offers to restore the previous view.
  function resetView() {
    if (!treeRoot) {
      clearView();
      return;
    }
    const previous: PersistedView = {
      version: 2,
      root: treeRoot,
      contentState,
      viewFilters,
      globalFreeText,
    };
    clearView();
    offerUndo('View reset', 'Your session token was kept.', undefined, () => restoreView(previous));
  }

  // Restores a view like opening its shared link: the token comes from the store.
  function restoreView(view: PersistedView) {
    const rootReference = view.root.reference;
    const storedToken = tokenStore.read(rootReference.deployment) ?? '';
    setToken(storedToken);
    setActiveToken(storedToken);
    setTokenDeployment(rootReference.deployment);
    setTokenRequired(!storedToken);
    startFormProblem.clear();
    setChangingRoot(false);
    setSelectingRoot(false);
    setTreeRoot(view.root);
    setReference(rootReference);
    setCollectionInput(collectionUrl(rootReference));
    setContentState(view.contentState);
    setGlobalFreeText(view.globalFreeText);
    setViewFilters(view.viewFilters);
    setCatalogInstance(instanceReference(rootReference));
    setSelectedRootZuid(rootReference.modelZuid);
  }

  function clearView() {
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

  function copyViewLink() {
    void copyText(window.location.href, 'View link copied', 'The session token is not included.');
  }

  function copyRawView() {
    if (!viewDecodeError) return;
    void copyText(viewDecodeError.raw, 'Raw view data copied');
  }

  function cancelRootReplacement() {
    if (!reference) return;
    setCollectionInput(collectionUrl(reference));
    setToken(activeToken);
    setTokenDeployment(reference.deployment);
    startFormProblem.clear();
    setChangingRoot(false);
    setSelectingRoot(false);
    setCatalogInstance(instanceReference(reference));
    setSelectedRootZuid(reference.modelZuid);
  }

  function openRootPicker() {
    if (!reference) return;
    setCollectionInput(collectionUrl(reference));
    startFormProblem.clear();
    setCatalogInstance(instanceReference(reference));
    setSelectedRootZuid(reference.modelZuid);
    setChangingRoot(false);
    setSelectingRoot(true);
  }

  const showStart = !reference || tokenRequired || changingRoot || selectingRoot;

  // Removes the node straight away; the toast offers to restore the previous tree.
  function removeNode(nodeId: CollectionNodeId) {
    if (!treeRoot) return;
    const previous = treeRoot;
    const next = removeCollectionNode(previous, nodeId);
    setTreeRoot(next);
    offerUndo(
      `Removed ${subtreeNodeNames(previous, nodeId).join(', ')}`,
      'Its saved table state was removed too.',
      next,
      () => setTreeRoot(previous),
    );
  }

  // Shows an undo toast that stays usable only until the tree changes again.
  // An undo offer only makes sense until the user moves on to another change.
  function withdrawUndo() {
    if (!pendingUndo.current) return;
    toast.dismiss(pendingUndo.current.toastId);
    pendingUndo.current = undefined;
  }

  function offerUndo(
    title: string,
    description: string,
    nextTreeRoot: CollectionNode | undefined,
    undo: () => void,
  ) {
    withdrawUndo();
    const toastId = toast(title, {
      description,
      duration: actionToastDuration,
      action: {
        label: 'Undo',
        onClick: () => {
          pendingUndo.current = undefined;
          undo();
        },
      },
    });
    pendingUndo.current = { toastId, treeRoot: nextTreeRoot };
  }

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
    <main className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border bg-card/95 sticky top-0 z-30 flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b px-4 py-3 shadow-xs backdrop-blur lg:px-6">
        <div className="flex items-center gap-3">
          <span
            className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg"
            aria-hidden="true"
          >
            <Database size={17} />
          </span>
          <div>
            <h1 className="text-sm font-semibold">Zesty Explorer</h1>
            <span className="text-muted-foreground text-xs">Read-only content browser</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reference ? (
            <>
              <label className="relative order-last flex w-full items-center md:order-none md:w-64">
                <Search
                  className="text-muted-foreground absolute left-3"
                  size={15}
                  aria-hidden="true"
                />
                <Input
                  className="pl-9"
                  type="search"
                  aria-label="Search the complete view"
                  placeholder="Search all collections"
                  value={globalFreeText}
                  onChange={(event) => setGlobalFreeText(event.target.value)}
                />
              </label>
              <ToggleGroup
                aria-label="Content state"
                value={[contentState]}
                onValueChange={([next]) => {
                  if (next) setContentState(next);
                }}
              >
                <ToggleGroupItem value="latest">Latest</ToggleGroupItem>
                <ToggleGroupItem value="published">Published</ToggleGroupItem>
              </ToggleGroup>
              <Button
                variant="outline"
                size="sm"
                className="relative"
                onClick={() => void refreshAll()}
                disabled={isRefreshing}
                aria-describedby={refreshFailed ? 'refresh-status' : undefined}
                {...(refreshFailed ? { 'data-refresh-failed': '' } : {})}
              >
                <RefreshCw
                  className={isRefreshing ? 'animate-spin' : undefined}
                  size={14}
                  aria-hidden="true"
                />
                Refresh
                {refreshFailed ? (
                  <span
                    className="bg-destructive absolute -top-1 -right-1 size-2 rounded-full"
                    aria-hidden="true"
                  />
                ) : null}
              </Button>
              {refreshFailed ? (
                <span id="refresh-status" className="sr-only" role="status">
                  The last refresh failed. Activate Refresh to retry.
                </span>
              ) : null}
              <Button variant="outline" size="sm" onClick={copyViewLink}>
                <Copy size={14} aria-hidden="true" /> Copy view link
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="icon" aria-label="View options" />}
                >
                  <MoreHorizontal size={17} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setCollectionInput(collectionUrl(reference));
                      setChangingRoot(true);
                    }}
                  >
                    <Database size={14} /> Change view setup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={resetView}>
                    <RotateCcw size={14} /> Reset view
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setClearTokenOpen(true)}>
                    <Trash2 size={14} /> Clear saved token
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Badge variant="outline">No collection open</Badge>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          className="border-border bg-card max-h-64 min-h-0 overflow-auto border-b p-3 lg:sticky lg:top-[72px] lg:h-[calc(100vh-72px)] lg:max-h-[calc(100vh-72px)] lg:self-start lg:border-r lg:border-b-0"
          aria-label="Collection tree"
        >
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
              onChangeRoot={openRootPicker}
              onRemove={removeNode}
              onRelationshipChange={(nodeId, relationship) =>
                setTreeRoot((root) =>
                  root ? updateCollectionRelationship(root, nodeId, relationship) : root,
                )
              }
            />
          ) : reference ? (
            <>
              <div className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-xs font-semibold tracking-wider uppercase">
                <Database size={15} /> <span>Collections</span>
              </div>
              <div className="bg-accent/60 flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-medium">
                <span className="bg-primary size-1.5 rounded-full" />
                <span>{reference.modelZuid}</span>
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-sm">
              <Database size={18} />
              <p>Your collections will appear here.</p>
            </div>
          )}
        </aside>

        <section className="min-w-0 p-4 lg:p-6" aria-live="polite">
          {encodedView && encodedView.length > 8_000 ? (
            <p
              className="border-border bg-muted mb-4 rounded-md border px-3 py-2 text-sm"
              role="status"
            >
              This view link is {encodedView.length.toLocaleString()} characters and may be too long
              for some tools.
            </p>
          ) : null}
          {viewDecodeError ? (
            <Card
              className="border-destructive/40 bg-destructive/10 mx-auto my-[8vh] max-w-2xl"
              role="alert"
            >
              <CardHeader>
                <h2 className="text-lg font-semibold">Shared view could not be restored</h2>
                <p className="text-muted-foreground text-sm">{viewDecodeError.reason}</p>
              </CardHeader>
              <CardFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={copyRawView}>
                  Copy raw view data
                </Button>
                <Button onClick={clearView}>Reset view</Button>
              </CardFooter>
            </Card>
          ) : showStart ? (
            selectingRoot ? (
              <Card className="mx-auto my-[8vh] w-full max-w-xl py-0">
                <form
                  className="grid gap-4 p-6"
                  aria-labelledby="root-picker-title"
                  noValidate
                  onSubmit={confirmRoot}
                >
                  <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Choose a root
                  </p>
                  <h2 className="text-xl font-semibold" id="root-picker-title">
                    Choose the root collection
                  </h2>
                  {catalogQuery.isLoading ? (
                    <p className="text-muted-foreground text-sm" role="status">
                      Loading collection catalog…
                    </p>
                  ) : null}
                  {catalogQuery.error ? (
                    <div
                      className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
                      role="alert"
                    >
                      <p>{catalogQuery.error.message}</p>
                      <ErrorTechnicalDetails error={catalogQuery.error} />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void catalogQuery.refresh()}
                      >
                        Retry catalog
                      </Button>
                    </div>
                  ) : null}
                  {catalogQuery.catalog && catalogQuery.catalog.collections.length === 0 ? (
                    <p
                      className="bg-muted text-muted-foreground rounded-md p-3 text-sm"
                      role="status"
                    >
                      This session returned an empty collection catalog.
                    </p>
                  ) : null}
                  <CollectionPicker
                    label="Root collection"
                    collections={rootPickerCollections}
                    value={selectedRootZuid}
                    onChange={(collection) => {
                      setSelectedRootZuid(collection?.reference.modelZuid);
                      startFormProblem.clear('root-collection');
                    }}
                    disabled={catalogQuery.isLoading && rootPickerCollections.length === 0}
                    error={startFormProblem.messageFor('root-collection')}
                    inputRef={rootCollectionInput}
                  />
                  {catalogQuery.catalog?.warning ? (
                    <div
                      className="border-amber-500/40 bg-amber-500/10 rounded-md border p-3 text-sm"
                      role="status"
                    >
                      <p>{catalogQuery.catalog.warning.message}</p>
                      <ErrorTechnicalDetails error={catalogQuery.catalog.warning} />
                    </div>
                  ) : null}
                  <Field
                    className="border-t pt-4"
                    error={startFormProblem.messageFor('root-reference')}
                  >
                    <span className="text-muted-foreground text-xs font-medium">
                      Or paste a collection reference
                    </span>
                    <Input
                      ref={rootReferenceInput}
                      type="url"
                      aria-label="Root collection reference"
                      value={collectionInput}
                      onChange={(event) => {
                        const value = event.target.value;
                        setCollectionInput(value);
                        startFormProblem.clear();
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
                  </Field>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => {
                        setSelectingRoot(false);
                        if (!reference) setCatalogInstance(undefined);
                      }}
                    >
                      Back
                    </Button>
                    <Button type="submit">Open root collection</Button>
                  </div>
                </form>
              </Card>
            ) : (
              <Card className="mx-auto my-[8vh] w-full max-w-xl py-0">
                <form
                  className="grid gap-4 p-6"
                  aria-labelledby="start-title"
                  noValidate
                  onSubmit={loadCatalog}
                >
                  <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    {tokenRequired
                      ? 'Session expired'
                      : changingRoot
                        ? 'Change this view'
                        : 'Start a view'}
                  </p>
                  <h2 className="text-xl font-semibold" id="start-title">
                    {tokenRequired
                      ? 'Replace your session token'
                      : changingRoot
                        ? 'Change view setup'
                        : 'Open a Zesty collection'}
                  </h2>

                  <Field error={startFormProblem.messageFor('session-token')}>
                    <FieldLabel>Zesty session token</FieldLabel>
                    <div className="relative">
                      <Input
                        ref={sessionTokenInput}
                        className="pr-10"
                        type={showToken ? 'text' : 'password'}
                        value={token}
                        autoComplete="off"
                        onChange={(event) => {
                          setToken(event.target.value);
                          startFormProblem.clear('session-token');
                          const parsed = parseCollectionReference(collectionInput);
                          if (parsed.ok) setTokenDeployment(parsed.value.deployment);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 size-7"
                        aria-label={showToken ? 'Hide session token' : 'Reveal session token'}
                        onClick={() => setShowToken((visible) => !visible)}
                      >
                        {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                      </Button>
                    </div>
                  </Field>
                  <Collapsible>
                    <CollapsibleTrigger className="text-muted-foreground hover:text-foreground text-left text-xs underline-offset-4 hover:underline">
                      How to find the token
                    </CollapsibleTrigger>
                    <CollapsibleContent className="text-muted-foreground pt-2 text-xs leading-relaxed">
                      Copy APP_SID for production, STAGE_APP_SID for stage, or DEV_APP_SID for
                      development from your Zesty Manager cookies. It carries your permissions. Do
                      not share it.
                    </CollapsibleContent>
                  </Collapsible>

                  <Field error={startFormProblem.messageFor('instance-url')}>
                    <FieldLabel>Zesty instance URL</FieldLabel>
                    <Input
                      ref={instanceUrlInput}
                      type="url"
                      value={collectionInput}
                      placeholder="https://8-….manager.zesty.io/content/6-…"
                      onChange={(event) => {
                        const value = event.target.value;
                        setCollectionInput(value);
                        startFormProblem.clear('instance-url');
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
                    <FieldDescription>
                      Paste any URL from an allowed Zesty Manager host, or a recognized Instances
                      API instance or model URL.
                    </FieldDescription>
                  </Field>
                  <div className="flex flex-wrap justify-end gap-2">
                    {changingRoot ? (
                      <Button variant="outline" type="button" onClick={cancelRootReplacement}>
                        Cancel
                      </Button>
                    ) : null}
                    <Button type="submit">Load collections</Button>
                  </div>
                </form>
              </Card>
            )
          ) : null}

          {!showStart && loadStatus.kind === 'loading-root' ? (
            <Card className="mx-auto my-[8vh] max-w-2xl">
              <CardContent className="text-sm">Loading collection…</CardContent>
            </Card>
          ) : null}
          {!showStart && rootFailure ? (
            <Card
              className="border-destructive/40 bg-destructive/10 mx-auto my-[8vh] max-w-2xl"
              role="alert"
            >
              <CardHeader>
                <h2 className="text-lg font-semibold">Collection could not load</h2>
                <p className="text-muted-foreground text-sm">
                  {queryErrorMessage?.message ?? 'The collection request failed unexpectedly.'}
                </p>
                {queryErrorMessage ? (
                  <p className="text-muted-foreground text-sm">{queryErrorMessage.recovery}</p>
                ) : null}
              </CardHeader>
              <CardContent>
                <ErrorTechnicalDetails error={rootFailure} />
              </CardContent>
              <CardFooter>
                <Button variant="outline" onClick={() => void retryRoot()}>
                  Retry
                </Button>
              </CardFooter>
            </Card>
          ) : null}
          {!showStart && loadedView && treeRoot && rootSnapshot && rootSchema ? (
            <>
              <Card className="mb-4 gap-0 py-0">
                <Collapsible
                  aria-label="View filters"
                  open={viewFiltersOpen}
                  onOpenChange={setViewFiltersOpen}
                >
                  <CollapsibleTrigger className="hover:bg-accent/40 flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors">
                    <span className="flex items-center gap-2">
                      <ListFilter size={15} />
                      <strong>View filters</strong>
                      <span className="text-muted-foreground hidden text-sm font-normal sm:inline">
                        Filter results across the collection tree
                      </span>
                    </span>
                    {viewFilters.length > 0 ? (
                      <Badge variant="outline">{viewFilters.length}</Badge>
                    ) : null}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-border border-t p-4">
                    <FilterBuilder
                      label="View filter"
                      root={treeRoot}
                      schemas={loadedView.schemas}
                      filters={viewFilters}
                      onChange={setViewFilters}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </Card>
              {descendantResultsPending ? (
                <p
                  className="border-amber-500/40 bg-amber-500/10 mb-4 rounded-md border px-3 py-2 text-sm"
                  role="status"
                >
                  Related data is loading. Descendant-dependent results will appear when it is
                  ready.
                </p>
              ) : null}
              {viewIsIncomplete ? (
                <p
                  className="border-amber-500/40 bg-amber-500/10 mb-4 rounded-md border px-3 py-2 text-sm"
                  role="status"
                >
                  This view contains incomplete collection data. Related results and filters may be
                  incomplete.
                </p>
              ) : null}
              {!descendantResultsPending ? (
                <PublicationStatusProvider
                  api={api}
                  sessionToken={activeToken}
                  credentialRevision={credentialRevision}
                >
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
                </PublicationStatusProvider>
              ) : null}
            </>
          ) : null}
        </section>
      </div>

      <ItemDetails
        api={api}
        item={selectedItemContext?.item}
        reference={selectedItemContext?.reference}
        sessionToken={activeToken}
        credentialRevision={credentialRevision}
        onAuthenticationFailure={() => setPreviewAuthenticationFailureRevision(credentialRevision)}
        finalFocus={detailsTrigger}
        onClose={() => {
          setSelectedItemId(undefined);
          window.setTimeout(() => detailsTrigger.current?.focus(), 100);
        }}
      />
      <ConfirmDialog
        open={pendingRootReplacement !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingRootReplacement(undefined);
        }}
        title="Replace root collection?"
        description="These collection nodes will be removed:"
        confirmLabel="Replace root"
        onConfirm={() => {
          if (pendingRootReplacement) replaceRoot(pendingRootReplacement);
        }}
      >
        <ul className="border-border grid gap-1 rounded-md border px-3 py-2 text-sm">
          {pendingRootReplacement?.removedNodeNames.map((name, index) => (
            <li key={`${index}:${name}`}>{name}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          Saved filters, columns, widths, sorts, and relationships will also be removed.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={clearTokenOpen}
        onOpenChange={setClearTokenOpen}
        title="Clear saved session token?"
        description="The current view stays open. You will need to enter a token again to load data."
        confirmLabel="Clear token"
        onConfirm={clearToken}
        finalFocus={sessionTokenInput}
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
      <TooltipProvider delay={300}>
        <Explorer api={api} tokenStore={resolvedTokenStore} />
        <SharedTooltip />
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
