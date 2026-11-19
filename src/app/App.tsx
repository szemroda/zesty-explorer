import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Effect, Either } from 'effect';
import {
  Code2,
  Copy,
  Database,
  FileCheck2,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { instanceReferenceFor, parseInstanceReference } from '../collection-reference';
import type {
  CollectionCatalogEntry,
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
  ContentItem,
  ContentItemReference,
  ContentState,
  Deployment,
  InstanceReference,
  LanguageCode,
  ModelZuid,
  NodePresentation,
  PersistedView,
  SharedState,
  WorkspaceTab,
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
  withPresentationsOf,
} from '../explorer-core';
import { ViewCodec, type ViewDecodeResult } from '../view-codec';
import {
  createBrowserSessionTokenStore,
  type SessionTokenStore,
} from '../view-codec/session-token-store';
import { createZestyApi, fetchZestyTransport, snapshotQueryKey, type ZestyApi } from '../zesty-api';
import { SessionTokenForm } from './components/SessionTokenForm';
import { useSessionTokens } from './hooks/useSessionTokens';
import { useInstanceList } from './hooks/useInstanceList';
import { InstanceList } from './components/InstanceList';
import { InstanceDialog, InstanceSwitcherButton } from './components/InstanceSwitcher';
import { RootPicker } from './components/RootPicker';
import { ErrorTechnicalDetails } from './components/ErrorTechnicalDetails';
import { ItemDetails } from './components/ItemDetails';
import { RootTable, RootTableSkeleton } from './components/RootTable';
import { PublicationStatusProvider } from './components/PublicationStatusCell';
import {
  clearModelPublicationsOutsideScope,
  refreshActiveModelPublications,
} from './hooks/model-publications-query';
import { useViewPublications, type ViewPublications } from './hooks/useViewPublications';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TreeEditor } from './components/TreeEditor';
import { CodeWorkspace } from './components/CodeWorkspace';
import { OpenCollectionDialog } from './components/OpenCollectionDialog';
import { ImportCheck } from './components/ImportCheck';
import { createChildNode, createRootNode, sameCollection } from './view-state';
import { useCodeTab } from './hooks/useCodeTab';
import { refreshCodeFiles } from './hooks/useCodeFiles';
import { refreshImportCheck } from './hooks/useImportCheck';
import { useRefresh } from './hooks/useRefresh';
import { codeStateLabels, shareableFileFilter } from './code-presentation';
import { copyText } from './copy-text';
import { describeExplorerError } from './error-message';
import { useLoadedView } from './hooks/useLoadedView';
import { LanguagePicker } from './components/LanguagePicker';
import { useCollectionCatalog } from './hooks/useCollectionCatalog';
import { useRelatedBuild } from './hooks/useRelatedBuild';
import { relationshipSchemaQueryRoot, type SchemaLoader } from './hooks/useSchemaIndex';
import {
  clearItemVersionPreviewCacheOutsideScope,
  refreshActiveItemVersionPreviews,
} from './hooks/useItemVersionPreview';
import {
  clearSavedVersionsOutsideScope,
  refreshActiveSavedVersions,
} from './hooks/publication-status-query';
import { flattenCollectionNodes } from './load-view';
import { RefreshButton } from './components/RefreshButton';
import { Button } from './components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Dialog, DialogContent } from './components/ui/dialog';
import { Toaster } from './components/ui/sonner';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { SharedRichTextPreview } from './components/RichText';
import { SharedTooltip, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { cn } from './lib/utils';

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
const noNodeSchemas: ReadonlyMap<CollectionNodeId, CollectionSchema> = new Map();

type ExplorerStep = 'credentials' | 'picker' | 'view';

interface RootChoice {
  readonly label: string;
  readonly reference: CollectionReference;
}

interface PendingRootReplacement extends RootChoice {
  readonly removedNodeNames: readonly string[];
}

interface PendingUndo {
  readonly toastId: string | number;
  // The tree the action left behind; any other structure makes the undo stale.
  readonly structure: string;
}

// A tree without its presentation. Tables save sorting and columns into the tree on their own, so
// a presentation change is not a change the user made to the tree.
function treeStructure(root: CollectionNode | undefined): string {
  const structure = ({ id, name, reference, relationship, children }: CollectionNode): unknown => ({
    id,
    name,
    reference,
    relationship,
    children: children.map(structure),
  });
  return JSON.stringify(root ? structure(root) : null);
}

type InvalidSharedView = Extract<ViewDecodeResult, { readonly ok: false }>;

// Restores the shared state of both tabs from a `#view=` link.
function initialSharedView(): {
  readonly state?: SharedState;
  readonly error?: InvalidSharedView;
} {
  if (!window.location.hash.startsWith('#view=')) return {};
  const decoded = ViewCodec.decode(window.location.hash);
  return decoded.ok ? { state: decoded.state } : { error: decoded };
}

/** Loads one collection's schema through `semaphore`, which caps how many load at once. */
function schemaLoader(
  api: ZestyApi,
  sessionToken: string,
  semaphore: Effect.Semaphore,
): SchemaLoader {
  return async (reference, signal) => {
    const result = await Effect.runPromise(
      api
        .loadCollectionSchema(reference, sessionToken)
        .pipe(semaphore.withPermits(1), Effect.either),
      { signal },
    );
    return Either.isRight(result)
      ? { ok: true, schema: result.right }
      : { ok: false, message: result.left.message };
  };
}

/** Identifies an instance's deployment, e.g. to key per-instance state. */
function instanceKey(instance: {
  readonly instanceZuid: string;
  readonly deployment: string;
}): string {
  return `${instance.instanceZuid}:${instance.deployment}`;
}

/** This page's address with another URL fragment, e.g. a view link. */
function appUrl(fragment: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${fragment}`;
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

function suggestedRoot(instance: InstanceReference): CollectionCatalogEntry | undefined {
  if (!instance.suggestedModelZuid) return undefined;
  const reference: CollectionReference = {
    instanceZuid: instance.instanceZuid,
    modelZuid: instance.suggestedModelZuid,
    deployment: instance.deployment,
    area: instance.suggestedArea ?? 'other',
    apiBaseUrl: instance.apiBaseUrl,
    managerBaseUrl: instance.managerBaseUrl,
  };
  return {
    label: reference.modelZuid,
    name: reference.modelZuid,
    type: 'uncatalogued',
    group: reference.area,
    reference,
  };
}

function Explorer({ api, tokenStore }: ExplorerProps) {
  const queryClient = useQueryClient();
  const [initial] = useState(initialSharedView);
  const initialView = initial.state?.view;
  const [initialInstance] = useState(() => {
    if (initialView) return instanceReference(initialView.root.reference);
    const shared = initial.state?.instance;
    return shared ? instanceReferenceFor(shared.instanceZuid, shared.deployment) : undefined;
  });
  const [step, setStep] = useState<ExplorerStep>(
    initialView ? 'view' : initial.state ? 'picker' : 'credentials',
  );
  const [chosenDeployment, setChosenDeployment] = useState<Deployment>(
    initialInstance?.deployment ?? 'production',
  );
  const [rejectedDeployment, setRejectedDeployment] = useState<Deployment>();
  const sessionTokens = useSessionTokens(tokenStore);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initial.state?.tab ?? 'explorer');
  // The Code and Import check tabs load only once opened, then keep their state while hidden.
  const [codeOpened, setCodeOpened] = useState(initial.state?.tab === 'code');
  const [importOpened, setImportOpened] = useState(initial.state?.tab === 'import');
  // The Import check's collection for a copied link, tagged with its instance so it can't leak
  // into another instance's link.
  const [importCollection, setImportCollection] = useState(() => {
    const shared = initial.state;
    return shared?.importModelZuid
      ? { instance: instanceKey(shared.instance), modelZuid: shared.importModelZuid }
      : undefined;
  });
  // Set when the Code or Import check tab finds the instance's session token rejected.
  const [workspaceAuthenticationFailureRevision, setWorkspaceAuthenticationFailureRevision] =
    useState<string>();
  const [pendingCollection, setPendingCollection] = useState<CollectionCatalogEntry>();
  const codeRefresh = useRefresh(() => refreshCodeFiles(queryClient));
  const importRefresh = useRefresh(() =>
    refreshImportCheck(queryClient).catch(() => {
      toast.error('Refresh failed', { description: 'Zesty data could not be read again.' });
    }),
  );
  const [reference, setReference] = useState<CollectionReference | undefined>(
    initialView?.root.reference,
  );
  const [treeRoot, setTreeRoot] = useState<CollectionNode | undefined>(initialView?.root);
  const [contentState, setContentState] = useState<ContentState>(
    initialView?.contentState ?? 'latest',
  );
  // A language other than the instance default, tagged with its instance so that it can't leak
  // into a view of another instance.
  const [languageChoice, setLanguageChoice] = useState(() =>
    initialView?.language
      ? { instance: instanceKey(initialView.root.reference), code: initialView.language }
      : undefined,
  );
  const [viewFilters, setViewFilters] = useState<readonly ViewFilter[]>(
    initialView?.viewFilters ?? [],
  );
  const [viewDecodeError, setViewDecodeError] = useState(initial.error);
  const [catalogInstance, setCatalogInstance] = useState(initialInstance);
  const [selectedRootZuid, setSelectedRootZuid] = useState<ModelZuid | undefined>(
    initialView?.root.reference.modelZuid,
  );
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [previewAuthenticationFailureRevision, setPreviewAuthenticationFailureRevision] =
    useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [pendingRootReplacement, setPendingRootReplacement] = useState<PendingRootReplacement>();
  // Off by default. While on, opening a root fills its tree with related collections.
  const [addRelatedOnOpen, setAddRelatedOnOpen] = useState(false);
  const [clearTokenOpen, setClearTokenOpen] = useState(false);
  // The header's instance switcher and the root picker over an open view.
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false);
  const [rootPickerOpen, setRootPickerOpen] = useState(false);
  const rootPickerTitle = useId();
  const pendingUndo = useRef<PendingUndo | undefined>(undefined);
  const pageHeader = useRef<HTMLElement>(null);
  // Opening a root from the picker hands focus to the collection heading once the table shows,
  // so keyboard and screen reader users land in the view they asked for. Focus the user has
  // already moved elsewhere while the table loaded stays where it is.
  const pendingViewFocus = useRef(false);
  const focusOpenedView = useCallback((heading: HTMLHeadingElement | null) => {
    if (!heading || !pendingViewFocus.current) return;
    pendingViewFocus.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      heading.focus();
    }
  }, []);
  const [relationshipSchemaSemaphore] = useState(() => Effect.runSync(Effect.makeSemaphore(2)));
  // When Refresh last made every relationship schema stale.
  const [schemasRefreshedAt, setSchemasRefreshedAt] = useState(0);
  const [schemaIndexSemaphore] = useState(() => Effect.runSync(Effect.makeSemaphore(2)));

  // The selected instance owns both tabs. Selecting a different one resets the Code tab; the
  // Explorer view is replaced when a root from the new instance is opened.
  const instance = useMemo(
    () => catalogInstance ?? (reference ? instanceReference(reference) : undefined),
    [catalogInstance, reference],
  );
  const deployment = instance?.deployment ?? chosenDeployment;
  const activeToken = sessionTokens.read(deployment);
  const screen: ExplorerStep = activeToken ? step : 'credentials';
  const credentialRevision = useMemo(
    () => (activeToken ? crypto.randomUUID() : 'no-credentials'),
    [activeToken],
  );
  const code = useCodeTab(instance, initial.state);
  const chosenLanguage: LanguageCode | undefined =
    treeRoot && languageChoice?.instance === instanceKey(treeRoot.reference)
      ? languageChoice.code
      : undefined;

  const onImportModelZuidChange = useCallback(
    (modelZuid: ModelZuid | undefined) =>
      setImportCollection(
        instance && modelZuid ? { instance: instanceKey(instance), modelZuid } : undefined,
      ),
    [instance],
  );

  // One link restores both tabs: the active tab, the Explorer view, and the Code selection and
  // file filter.
  const encodedView = useMemo(() => {
    if (!instance || viewDecodeError) return undefined;
    // While another instance's root is being chosen, the open view belongs to the old one.
    const view =
      treeRoot?.reference.instanceZuid === instance.instanceZuid &&
      treeRoot.reference.deployment === instance.deployment
        ? ({
            version: 2,
            root: treeRoot,
            contentState,
            ...(chosenLanguage ? { language: chosenLanguage } : {}),
            viewFilters,
          } as const)
        : undefined;
    const selection = code.selection;
    const fileFilter = shareableFileFilter(code.fileFilter);
    const importModelZuid =
      importCollection?.instance === instanceKey(instance) ? importCollection.modelZuid : undefined;
    return ViewCodec.encode({
      version: 3,
      instance: { instanceZuid: instance.instanceZuid, deployment: instance.deployment },
      tab: activeTab,
      ...(view ? { view } : {}),
      ...(selection.fileId || selection.state !== 'latest' ? { codeSelection: selection } : {}),
      ...(fileFilter ? { codeFileFilter: fileFilter } : {}),
      ...(importModelZuid ? { importModelZuid } : {}),
    });
  }, [
    activeTab,
    code.fileFilter,
    code.selection,
    chosenLanguage,
    contentState,
    importCollection,
    instance,
    treeRoot,
    viewDecodeError,
    viewFilters,
  ]);

  useEffect(() => {
    if (viewDecodeError) return;
    if (encodedView) {
      window.history.replaceState(null, '', encodedView.fragment);
      return;
    }
    if (window.location.hash.startsWith('#view=')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  }, [encodedView, viewDecodeError]);

  useEffect(() => {
    if (pendingUndo.current?.structure === treeStructure(treeRoot)) return;
    withdrawUndo();
  }, [treeRoot]);

  const requiresCompleteView = Boolean(
    treeRoot?.children.length &&
    (treeRoot.presentation.freeText ||
      viewFilters.some(
        (filter) => filter.nodePath.length > 0 || filter.operator === 'one-of-or-below',
      )),
  );
  const loadedViewQuery = useLoadedView({
    api,
    root: treeRoot,
    contentState,
    language: chosenLanguage,
    sessionToken: activeToken,
    enabled: Boolean(
      treeRoot && activeToken && deployment === treeRoot.reference.deployment && screen === 'view',
    ),
    requiresCompleteView,
  });
  const {
    contentScope,
    languages,
    loadedView,
    rootSnapshot,
    rootSchema,
    status: loadStatus,
    authenticationFailed,
    isIncomplete: viewIsIncomplete,
    refresh: refreshCollections,
    retryRoot,
  } = loadedViewQuery;
  const viewPublications = useViewPublications({
    source: { api, sessionToken: activeToken, credentialRevision },
    root: treeRoot,
    viewFilters,
    contentState,
    enabled: screen === 'view',
  });
  const catalogQuery = useCollectionCatalog({
    api,
    reference: catalogInstance,
    sessionToken: activeToken,
    enabled: Boolean(catalogInstance && activeToken),
  });
  const instanceList = useInstanceList({
    api,
    deployment,
    sessionToken: activeToken,
    enabled: screen !== 'credentials',
  });

  useEffect(() => {
    clearItemVersionPreviewCacheOutsideScope(queryClient, {
      credentialRevision,
      deployment: reference?.deployment,
      instanceZuid: reference?.instanceZuid,
    });
  }, [credentialRevision, queryClient, reference?.deployment, reference?.instanceZuid]);

  useEffect(() => {
    const scope = {
      credentialRevision,
      deployment: reference?.deployment,
      instanceZuid: reference?.instanceZuid,
    };
    clearSavedVersionsOutsideScope(queryClient, scope);
    clearModelPublicationsOutsideScope(queryClient, scope);
  }, [credentialRevision, queryClient, reference?.deployment, reference?.instanceZuid]);

  const refreshAll = useCallback(
    async function refreshAllRequests() {
      if (isRefreshing) return;
      setIsRefreshing(true);
      let succeeded: boolean;
      // Schemas shown right now reload; the rest reload when they are next shown.
      setSchemasRefreshedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey: [relationshipSchemaQueryRoot] });
      try {
        const results = await Promise.all([
          catalogQuery.refresh(),
          refreshCollections(),
          refreshActiveItemVersionPreviews(queryClient),
          refreshActiveSavedVersions(queryClient),
          refreshActiveModelPublications(queryClient),
        ]);
        succeeded = results.every(Boolean);
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
  const instanceListAuthenticationFailed =
    !reference && instanceList.error?.kind === 'authentication';
  useEffect(() => {
    const tokenRejected =
      instanceListAuthenticationFailed ||
      catalogAuthenticationFailed ||
      authenticationFailed ||
      (viewPublications.kind === 'failed' && viewPublications.tokenRejected) ||
      previewAuthenticationFailureRevision === credentialRevision ||
      workspaceAuthenticationFailureRevision === credentialRevision;
    if (!tokenRejected || !activeToken) return;
    const update = window.setTimeout(() => {
      sessionTokens.clear(deployment);
      setRejectedDeployment(deployment);
      setSelectedItemId(undefined);
    }, 0);
    return () => window.clearTimeout(update);
  }, [
    activeToken,
    authenticationFailed,
    viewPublications,
    catalogAuthenticationFailed,
    instanceListAuthenticationFailed,
    workspaceAuthenticationFailureRevision,
    credentialRevision,
    deployment,
    previewAuthenticationFailureRevision,
    sessionTokens,
  ]);

  const selectedItemContext = useMemo(() => {
    if (!selectedItemId || !loadedView || !treeRoot || !contentScope) return undefined;
    for (const node of flattenCollectionNodes(treeRoot)) {
      const state = loadedView.snapshots.snapshots.get(
        snapshotQueryKey(node.reference, contentScope),
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
  }, [contentScope, loadedView, selectedItemId, treeRoot]);

  const descendantResultsPending = loadStatus.kind === 'loading-related-data';
  const loadRelationshipSchema = useMemo(
    () => schemaLoader(api, activeToken, relationshipSchemaSemaphore),
    [activeToken, api, relationshipSchemaSemaphore],
  );
  // Catalog-wide schema loads take their own permits, so the add-relationship dialog waits behind
  // at most two of them. They stay interactive: the background lane is full of publication-status
  // requests, and someone is waiting for these.
  const loadIndexedSchema = useMemo(
    () => schemaLoader(api, activeToken, schemaIndexSemaphore),
    [activeToken, api, schemaIndexSemaphore],
  );
  const treeCatalogLoaded = Boolean(
    treeRoot && catalogInstance && instanceKey(catalogInstance) === instanceKey(treeRoot.reference),
  );
  const relatedBuild = useRelatedBuild({
    treeRoot,
    setTreeRoot,
    catalog: treeCatalogLoaded ? catalogQuery.catalog?.collections : undefined,
    catalogRefreshing: treeCatalogLoaded && catalogQuery.isFetching,
    schemasRefreshedAt,
    catalogFailed: treeCatalogLoaded && !catalogQuery.catalog && catalogQuery.error !== undefined,
    rootFailed: rootFailure !== undefined,
    nodeSchemas: loadedView?.schemas ?? noNodeSchemas,
    loadSchema: loadIndexedSchema,
    offerUndo,
  });
  const { schemaIndex } = relatedBuild;

  function saveSessionToken(token: string) {
    sessionTokens.save(deployment, token);
    setRejectedDeployment(undefined);
    setStep((current) => (current === 'credentials' ? 'picker' : current));
  }

  // A root opened before its instance's catalog loaded keeps its model ZUID as its name, and views
  // that predate catalog labels do too. Show the catalog label for those instead.
  const rootName = !treeRoot
    ? ''
    : treeRoot.name !== treeRoot.reference.modelZuid
      ? treeRoot.name
      : (catalogQuery.catalog?.collections.find(
          (collection) =>
            instanceKey(collection.reference) === instanceKey(treeRoot.reference) &&
            collection.reference.modelZuid === treeRoot.reference.modelZuid,
        )?.label ??
        loadedView?.schemas.get(treeRoot.id)?.label ??
        treeRoot.name);
  const rootPickerCollections = useMemo(() => {
    const collections = [...(catalogQuery.catalog?.collections ?? [])];
    if (!catalogInstance) return collections;
    const fallback = suggestedRoot(catalogInstance);
    if (!fallback) return collections;
    if (
      collections.some(
        (collection) => collection.reference.modelZuid === fallback.reference.modelZuid,
      )
    )
      return collections;
    collections.push(fallback);
    return collections;
  }, [catalogInstance, catalogQuery.catalog?.collections]);

  const viewModelZuids = useMemo(
    () =>
      new Set(
        treeRoot ? flattenCollectionNodes(treeRoot).map((node) => node.reference.modelZuid) : [],
      ),
    [treeRoot],
  );
  const instanceName = instance
    ? instanceList.list?.instances.find(
        (entry) => instanceKey(entry.reference) === instanceKey(instance),
      )?.name
    : undefined;

  // Opens another instance in the open tab. An open view closes, and the notice can bring it back.
  function switchInstance(next: InstanceReference) {
    withdrawUndo();
    setInstanceDialogOpen(false);
    setRootPickerOpen(false);
    const tab = activeTab;
    closeView('Switched instance', 'Undo to reopen the previous view.');
    setActiveTab(tab);
    setCatalogInstance(next);
    setSelectedRootZuid(next.suggestedModelZuid);
  }

  function changeDeployment(next: Deployment) {
    setInstanceDialogOpen(false);
    closeView('Switched deployment', 'Undo to reopen the previous view.');
    setChosenDeployment(next);
  }

  /**
   * Opens a pasted instance reference. Another instance replaces the open one; a collection or
   * item of the open instance becomes the root picker's choice. Returns what is wrong, if anything.
   */
  function openPastedUrl(url: string, from: 'instance-list' | 'root-picker'): string | undefined {
    const parsed = parseInstanceReference(url);
    if (!parsed.ok) return parsed.error.message;
    const next = parsed.value;
    if (!instance || instanceKey(next) !== instanceKey(instance)) {
      switchInstance(next);
      return undefined;
    }
    if (!next.suggestedModelZuid) {
      if (from === 'root-picker')
        return 'This URL names the open instance. Paste a collection or item URL.';
      setInstanceDialogOpen(false);
      return undefined;
    }
    withdrawUndo();
    setCatalogInstance(next);
    setSelectedRootZuid(next.suggestedModelZuid);
    setInstanceDialogOpen(false);
    if (treeRoot) setRootPickerOpen(true);
    return undefined;
  }

  function showRootPicker() {
    if (!reference) return;
    setCatalogInstance(instanceReference(reference));
    setSelectedRootZuid(reference.modelZuid);
    setRootPickerOpen(true);
  }

  // A pasted item URL also opens that item's details.
  function openRootCollection(modelZuid: ModelZuid) {
    if (!catalogInstance) return;
    const selected = rootPickerCollections.find(
      (collection) =>
        instanceKey(collection.reference) === instanceKey(catalogInstance) &&
        collection.reference.modelZuid === modelZuid,
    );
    if (!selected) return;
    const selectedReference: CollectionReference = {
      ...selected.reference,
      ...(catalogInstance.suggestedModelZuid === modelZuid && catalogInstance.suggestedItemZuid
        ? { itemZuid: catalogInstance.suggestedItemZuid }
        : {}),
    };
    setSelectedRootZuid(modelZuid);
    // The picker stays open behind the confirmation, so Cancel returns to it.
    if (treeRoot && !sameCollection(treeRoot.reference, selectedReference)) {
      setPendingRootReplacement({
        label: selected.label,
        reference: selectedReference,
        removedNodeNames: subtreeNodeNames(treeRoot, treeRoot.id),
      });
      return;
    }
    setRootPickerOpen(false);
    openRoot({ label: selected.label, reference: selectedReference }, addRelatedOnOpen);
  }

  function replaceRoot(replacement: RootChoice, addRelated = false) {
    setViewFilters([]);
    setContentState('latest');
    openRoot(replacement, addRelated);
  }

  // Keeps the current tree when the selected root is the one already open. `addRelated` fills a
  // root-only tree with related collections once every catalog schema has loaded.
  function openRoot({ label, reference: selectedReference }: RootChoice, addRelated = false) {
    const next =
      treeRoot && sameCollection(treeRoot.reference, selectedReference)
        ? treeRoot
        : createRootNode(selectedReference, label);
    setReference(selectedReference);
    setTreeRoot(next);
    relatedBuild.start(addRelated ? next : undefined);
    setSelectedItemId(selectedReference.itemZuid);
    // An item deep link opens its details, which take focus instead.
    pendingViewFocus.current = !selectedReference.itemZuid;
    setStep('view');
  }

  function clearToken() {
    sessionTokens.clear(deployment);
  }

  function resetView() {
    closeView('View reset', 'Your session token was kept.');
  }

  // Closes the view straight away; the toast offers to restore it.
  function closeView(title: string, description: string) {
    if (!treeRoot) {
      clearView();
      return;
    }
    const previous: PersistedView = {
      version: 2,
      root: treeRoot,
      contentState,
      ...(chosenLanguage ? { language: chosenLanguage } : {}),
      viewFilters,
    };
    clearView();
    offerUndo(title, description, undefined, () => restoreView(previous));
  }

  // Restores a view like opening its shared link: the token comes from the store.
  function restoreView(view: PersistedView) {
    const rootReference = view.root.reference;
    setStep('view');
    setTreeRoot(view.root);
    setReference(rootReference);
    setContentState(view.contentState);
    setLanguageChoice(
      view.language ? { instance: instanceKey(rootReference), code: view.language } : undefined,
    );
    setViewFilters(view.viewFilters);
    setCatalogInstance(instanceReference(rootReference));
    setSelectedRootZuid(rootReference.modelZuid);
  }

  // Clears both tabs and returns to the instance picker, keeping the token.
  function clearView() {
    code.reset();
    setActiveTab('explorer');
    setTreeRoot(undefined);
    setReference(undefined);
    setChosenDeployment(deployment);
    setContentState('latest');
    setLanguageChoice(undefined);
    setViewFilters([]);
    setSelectedItemId(undefined);
    setViewDecodeError(undefined);
    setStep('picker');
    setCatalogInstance(undefined);
    setSelectedRootZuid(undefined);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }

  // The link restores both tabs; it names code files but never includes their source.
  function copyLink() {
    if (!encodedView) return;
    void copyText(
      appUrl(encodedView.fragment),
      'Link copied',
      visibleTab === 'import'
        ? 'The session token and the CSV file are not included.'
        : 'The session token and code source are not included.',
    );
  }

  function changeTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    if (tab === 'code') setCodeOpened(true);
    if (tab === 'import') setImportOpened(true);
  }

  function requestOpenCollection(modelZuid: ModelZuid) {
    const entry = catalogQuery.catalog?.collections.find(
      (collection) => collection.reference.modelZuid === modelZuid,
    );
    if (entry) setPendingCollection(entry);
  }

  function openCollectionInExplorer(entry: CollectionCatalogEntry) {
    withdrawUndo();
    setSelectedRootZuid(entry.reference.modelZuid);
    replaceRoot({ label: entry.label, reference: entry.reference });
    setActiveTab('explorer');
  }

  // The new tab reads its own session token, so it may ask for one.
  function openCollectionInNewTab(entry: CollectionCatalogEntry) {
    const { instanceZuid, deployment } = entry.reference;
    const { fragment } = ViewCodec.encode({
      version: 3,
      instance: { instanceZuid, deployment },
      tab: 'explorer',
      view: {
        version: 2,
        root: createRootNode(entry.reference, entry.label),
        contentState: 'latest',
        viewFilters: [],
      },
    });
    window.open(appUrl(fragment), '_blank', 'noopener,noreferrer');
  }

  function copyRawView() {
    if (!viewDecodeError) return;
    void copyText(viewDecodeError.raw, 'Raw view data copied');
  }

  // The same view options serve every tab.
  const viewOptions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="View options" />}
      >
        <MoreHorizontal size={17} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => resetView()}>
          <RotateCcw size={14} /> Reset view
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => setClearTokenOpen(true)}>
          <Trash2 size={14} /> Clear saved token
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const sharedActions = (
    <>
      {/* Below xl the label hides so the header stays on one row. */}
      <TooltipTrigger
        text="Copy a link to this view, without your session token"
        render={<Button variant="outline" size="sm" aria-label="Copy link" onClick={copyLink} />}
      >
        <Copy size={14} aria-hidden="true" /> <span className="max-xl:hidden">Copy link</span>
      </TooltipTrigger>
      {viewOptions}
    </>
  );

  const instanceListProps = {
    query: instanceList,
    deployment,
    current: instance,
    onChoose: (next: InstanceReference) => {
      if (instance && instanceKey(next) === instanceKey(instance)) {
        setInstanceDialogOpen(false);
        return;
      }
      switchInstance(next);
    },
    onPasteUrl: (url: string) => openPastedUrl(url, 'instance-list'),
    onDeploymentChange: changeDeployment,
  };
  const rootPickerProps = {
    titleId: rootPickerTitle,
    instanceName: instanceName ?? catalogInstance?.instanceZuid ?? '',
    collections: rootPickerCollections,
    loading: catalogQuery.isLoading,
    error: catalogQuery.error,
    warning: catalogQuery.catalog?.warning,
    onRetry: () => void catalogQuery.refresh(),
    selected: selectedRootZuid,
    onSelect: setSelectedRootZuid,
    openRoot: treeRoot?.reference.modelZuid,
    inView: viewModelZuids,
    rootHasChildren: Boolean(treeRoot?.children.length),
    addRelated: addRelatedOnOpen,
    onAddRelatedChange: setAddRelatedOnOpen,
    onOpen: openRootCollection,
    onPasteUrl: (url: string) => openPastedUrl(url, 'root-picker'),
    onSwitchInstance: () => setInstanceDialogOpen(true),
    loadSchema: loadRelationshipSchema,
  };

  // Tabs belong to a selected instance and appear after credentials are available.
  const showTabs = Boolean(instance) && !viewDecodeError && screen !== 'credentials';
  const visibleTab: WorkspaceTab = showTabs ? activeTab : 'explorer';

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
      // Keeps the sorting and columns chosen since the removal.
      () => setTreeRoot((current) => (current ? withPresentationsOf(previous, current) : previous)),
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
    pendingUndo.current = { toastId, structure: treeStructure(nextTreeRoot) };
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
      <header
        ref={pageHeader}
        className="border-border bg-card/95 sticky top-0 z-30 flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b px-4 py-3 shadow-xs backdrop-blur lg:px-6"
      >
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <h1 className="text-sm font-semibold">Zesty Explorer</h1>
            <span className="text-muted-foreground text-xs max-xl:hidden">
              Read-only content browser
            </span>
          </div>
          {showTabs && instance ? (
            <InstanceSwitcherButton
              name={instanceName}
              instanceZuid={instance.instanceZuid}
              deployment={instance.deployment}
              onClick={() => setInstanceDialogOpen(true)}
            />
          ) : null}
          {showTabs ? (
            <Tabs
              className="ml-2"
              value={activeTab}
              onValueChange={(value: unknown) => {
                if (value === 'explorer' || value === 'code' || value === 'import') {
                  changeTab(value);
                }
              }}
            >
              <TabsList aria-label="Workspace">
                <TabsTrigger value="explorer" className="gap-1.5">
                  <Database size={13} aria-hidden="true" /> Explorer
                </TabsTrigger>
                <TabsTrigger value="code" className="gap-1.5">
                  <Code2 size={13} aria-hidden="true" /> Code
                </TabsTrigger>
                <TabsTrigger value="import" className="gap-1.5">
                  <FileCheck2 size={13} aria-hidden="true" /> Import check
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {visibleTab === 'code' && instance ? (
            <>
              <ToggleGroup
                aria-label="Code state"
                value={[code.selection.state]}
                onValueChange={([next]) => {
                  if (next) code.select({ ...code.selection, state: next });
                }}
              >
                <ToggleGroupItem value="latest">{codeStateLabels.latest}</ToggleGroupItem>
                <ToggleGroupItem value="published">{codeStateLabels.published}</ToggleGroupItem>
              </ToggleGroup>
              <RefreshButton {...codeRefresh} />
              {sharedActions}
            </>
          ) : visibleTab === 'import' ? (
            <>
              <RefreshButton {...importRefresh} />
              {sharedActions}
            </>
          ) : reference ? (
            <>
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
              {treeRoot && contentScope && languages && languages.length > 1 ? (
                <LanguagePicker
                  languages={languages}
                  value={contentScope.language}
                  onChange={(language) =>
                    setLanguageChoice(
                      language.isDefault
                        ? undefined
                        : { instance: instanceKey(treeRoot.reference), code: language.code },
                    )
                  }
                />
              ) : null}
              <RefreshButton
                refreshing={isRefreshing}
                failed={refreshFailed}
                onRefresh={() => void refreshAll()}
              />
              {sharedActions}
            </>
          ) : null}
        </div>
      </header>

      {/* Until a collection is open, the setup cards have the page to themselves. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1',
          treeRoot && 'lg:grid-cols-[16rem_minmax(0,1fr)]',
        )}
        hidden={visibleTab !== 'explorer'}
      >
        {treeRoot ? (
          <aside
            className="border-border bg-card max-h-64 min-h-0 overflow-auto border-b p-3 lg:sticky lg:top-[72px] lg:h-[calc(100vh-72px)] lg:max-h-[calc(100vh-72px)] lg:self-start lg:border-r lg:border-b-0"
            aria-label="Collection tree"
          >
            <Button
              variant="outline"
              className="mb-3 w-full justify-start"
              onClick={showRootPicker}
            >
              <Search size={14} aria-hidden="true" /> Open a collection
            </Button>
            {/* Shown while the root loads too, so a tree built meanwhile appears at once. */}
            <TreeEditor
              root={rootName === treeRoot.name ? treeRoot : { ...treeRoot, name: rootName }}
              schemas={loadedView?.schemas ?? noNodeSchemas}
              catalog={catalogQuery.catalog?.collections ?? []}
              catalogError={catalogQuery.error}
              catalogWarning={catalogQuery.catalog?.warning}
              onRetryCatalog={() => void catalogQuery.refresh()}
              loadSchema={loadRelationshipSchema}
              schemaIndex={schemaIndex}
              onFindReferences={relatedBuild.requestReferences}
              onAdd={addRelatedCollection}
              onRename={(nodeId, name) =>
                setTreeRoot((root) => root && renameCollectionNode(root, nodeId, name))
              }
              onChangeRoot={showRootPicker}
              onRemove={removeNode}
              onRelationshipChange={(nodeId, relationship) =>
                setTreeRoot((root) =>
                  root ? updateCollectionRelationship(root, nodeId, relationship) : root,
                )
              }
            />
            {relatedBuild.pending ? (
              <div
                className="text-muted-foreground mt-3 flex items-center gap-2 px-2 text-xs"
                role="status"
              >
                <LoaderCircle size={13} className="shrink-0 animate-spin" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  Finding related collections…
                  {schemaIndex.total > 0 ? ` ${schemaIndex.settled} of ${schemaIndex.total}` : ''}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={relatedBuild.cancel}
                >
                  Cancel
                </Button>
              </div>
            ) : null}
          </aside>
        ) : null}

        <section className="min-w-0 p-4 lg:p-6">
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
          ) : screen === 'credentials' ? (
            <SessionTokenForm
              deployment={deployment}
              savedToken={activeToken}
              rejected={rejectedDeployment === deployment}
              instance={instance?.instanceZuid}
              onDeploymentChange={
                instance
                  ? undefined
                  : (next) => {
                      setChosenDeployment(next);
                      setStep('credentials');
                    }
              }
              onBack={
                step === 'picker' && catalogInstance
                  ? () => {
                      setCatalogInstance(undefined);
                      setSelectedRootZuid(undefined);
                    }
                  : undefined
              }
              onSubmit={saveSessionToken}
            />
          ) : screen === 'picker' && catalogInstance ? (
            <Card className="mx-auto my-[3vh] h-[min(680px,calc(100vh-220px))] w-full max-w-[960px] gap-0 overflow-hidden py-0">
              {/* Short enough that a notice in the corner leaves the Open button visible. */}
              <RootPicker key={instanceKey(catalogInstance)} {...rootPickerProps} />
            </Card>
          ) : screen === 'picker' ? (
            <Card className="mx-auto my-[6vh] w-full max-w-xl gap-0 overflow-hidden py-0">
              <div className="px-4 pt-5 pb-3">
                <h2 className="text-xl font-semibold">Choose an instance</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  The instances your session token can read. You can switch at any time from the top
                  bar.
                </p>
              </div>
              <InstanceList className="max-h-[min(560px,65vh)]" autoFocus {...instanceListProps} />
            </Card>
          ) : null}

          {screen === 'view' && loadStatus.kind === 'loading-root' ? (
            <RootTableSkeleton title={rootName} progress={loadStatus.progress} />
          ) : null}
          {screen === 'view' && rootFailure ? (
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
          {screen === 'view' &&
          loadedView &&
          treeRoot &&
          contentScope &&
          rootSnapshot &&
          rootSchema ? (
            <>
              {descendantResultsPending ? (
                <p
                  className="border-amber-500/40 bg-amber-500/10 mb-4 rounded-md border px-3 py-2 text-sm"
                  role="status"
                >
                  Related data is loading. Descendant-dependent results will appear when it is
                  ready.
                </p>
              ) : null}
              <PublicationNotice publications={viewPublications} />
              {viewIsIncomplete ? (
                <p
                  className="border-amber-500/40 bg-amber-500/10 mb-4 rounded-md border px-3 py-2 text-sm"
                  role="status"
                >
                  This view contains incomplete collection data. Related results and filters may be
                  incomplete.
                </p>
              ) : null}
              {/* Stays mounted while related data loads, so search, sort, and pages are kept. */}
              <PublicationStatusProvider
                api={api}
                sessionToken={activeToken}
                credentialRevision={credentialRevision}
                contentState={contentState}
              >
                <RootTable
                  key={`${treeRoot.reference.instanceZuid}:${treeRoot.reference.modelZuid}:${treeRoot.id}`}
                  title={rootName}
                  schema={rootSchema}
                  snapshot={rootSnapshot}
                  reference={treeRoot.reference}
                  treeRoot={treeRoot}
                  loadedView={loadedView}
                  contentScope={contentScope}
                  resultsPending={descendantResultsPending || viewPublications.kind === 'loading'}
                  publishedVersion={
                    viewPublications.kind === 'ready'
                      ? viewPublications.publishedVersion
                      : undefined
                  }
                  viewFilters={viewFilters}
                  onViewFiltersChange={setViewFilters}
                  onOpenDetails={openDetails}
                  onRetry={() => void refreshCollections()}
                  onPresentationChange={changePresentation}
                  pageHeader={pageHeader}
                  headingRef={focusOpenedView}
                />
              </PublicationStatusProvider>
            </>
          ) : null}
        </section>
      </div>

      {showTabs && instance && codeOpened ? (
        <div hidden={visibleTab !== 'code'}>
          <CodeWorkspace
            key={code.instanceKey}
            api={api}
            instance={instance}
            credentials={{
              revision: credentialRevision,
              sessionToken: activeToken,
            }}
            catalog={catalogQuery.catalog}
            selection={code.selection}
            onSelectionChange={code.select}
            fileFilter={code.fileFilter}
            onFileFilterChange={code.setFileFilter}
            onOpenCollection={requestOpenCollection}
            onAuthenticationFailure={() =>
              setWorkspaceAuthenticationFailureRevision(credentialRevision)
            }
          />
        </div>
      ) : null}

      {showTabs && instance && importOpened ? (
        <div hidden={visibleTab !== 'import'}>
          <ImportCheck
            key={instanceKey(instance)}
            api={api}
            credentials={{
              revision: credentialRevision,
              sessionToken: activeToken,
            }}
            catalog={catalogQuery.catalog}
            initialModelZuid={
              (importCollection?.instance === instanceKey(instance)
                ? importCollection.modelZuid
                : undefined) ??
              reference?.modelZuid ??
              instance.suggestedModelZuid
            }
            onModelZuidChange={onImportModelZuidChange}
            onAuthenticationFailure={() =>
              setWorkspaceAuthenticationFailureRevision(credentialRevision)
            }
          />
        </div>
      ) : null}

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
      <InstanceDialog
        open={instanceDialogOpen}
        onOpenChange={setInstanceDialogOpen}
        viewOpen={Boolean(treeRoot)}
        {...instanceListProps}
      />
      <Dialog open={rootPickerOpen} onOpenChange={setRootPickerOpen}>
        <DialogContent
          aria-labelledby={rootPickerTitle}
          className="flex h-[min(680px,88vh)] w-[min(960px,calc(100vw-32px))] flex-col gap-0 overflow-hidden p-0"
        >
          <RootPicker {...rootPickerProps} onCancel={() => setRootPickerOpen(false)} />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingRootReplacement !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingRootReplacement(undefined);
        }}
        title="Replace root collection?"
        description="These collection nodes will be removed:"
        confirmLabel="Replace root"
        onConfirm={() => {
          if (!pendingRootReplacement) return;
          setRootPickerOpen(false);
          replaceRoot(pendingRootReplacement, addRelatedOnOpen);
        }}
      >
        <ul className="border-border grid gap-1 rounded-md border px-3 py-2 text-sm [overflow-wrap:anywhere]">
          {pendingRootReplacement?.removedNodeNames.map((name, index) => (
            <li key={`${index}:${name}`}>{name}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          Saved filters, columns, widths, sorts, and relationships will also be removed.
        </p>
      </ConfirmDialog>
      <OpenCollectionDialog
        label={pendingCollection?.label}
        replacesView={Boolean(treeRoot)}
        onClose={() => setPendingCollection(undefined)}
        onOpenHere={() => {
          if (pendingCollection) openCollectionInExplorer(pendingCollection);
        }}
        onOpenInNewTab={() => {
          if (pendingCollection) openCollectionInNewTab(pendingCollection);
        }}
      />
      <ConfirmDialog
        open={clearTokenOpen}
        onOpenChange={setClearTokenOpen}
        title="Clear saved session token?"
        description="The current view stays open. You will need to enter a token again to load data."
        confirmLabel="Clear token"
        onConfirm={clearToken}
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
        <SharedRichTextPreview />
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

/** Says why filters on publication status can't show their results yet, or at all. */
function PublicationNotice({ publications }: { readonly publications: ViewPublications }) {
  const text = publicationNoticeText(publications);
  if (!text) return null;
  return (
    <p
      className="border-amber-500/40 bg-amber-500/10 mb-4 rounded-md border px-3 py-2 text-sm"
      role="status"
    >
      {text}
    </p>
  );
}

function publicationNoticeText(publications: ViewPublications): string | undefined {
  if (publications.kind === 'loading') {
    return 'Publication status is loading. Results filtered by it will appear when it is ready.';
  }
  if (publications.kind === 'failed') {
    return `Publication status could not load: ${publications.message} Filters on it match no items until Refresh loads it.`;
  }
  if (publications.kind === 'published-content') {
    return 'Publication status is known only for latest content. Filters on it match no items here. Switch to Latest to use them.';
  }
  return undefined;
}
