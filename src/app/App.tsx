import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Effect, Either } from 'effect';
import { Code2, Copy, Database, FileCheck2, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { instanceReferenceFor, parseInstanceReference } from '../collection-reference';
import type {
  CollectionCatalogEntry,
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  ContentItem,
  ContentItemReference,
  ContentState,
  Deployment,
  InstanceReference,
  ModelZuid,
  NodePresentation,
  PersistedView,
  SharedState,
  WorkspaceTab,
  RelationshipDefinition,
  ViewFilter,
} from '../domain';
import { deploymentLabels } from '../domain';
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
import { SessionTokenForm } from './components/SessionTokenForm';
import { useSessionTokens } from './hooks/useSessionTokens';
import { useInstanceList } from './hooks/useInstanceList';
import { InstancePicker } from './components/InstancePicker';
import { CollectionPicker } from './components/CollectionPicker';
import { ErrorTechnicalDetails } from './components/ErrorTechnicalDetails';
import { ItemDetails } from './components/ItemDetails';
import { RootTable, RootTableSkeleton } from './components/RootTable';
import { PublicationStatusProvider } from './components/PublicationStatusCell';
import { ConfirmDialog } from './components/ConfirmDialog';
import { TreeEditor } from './components/TreeEditor';
import { CodeWorkspace } from './components/CodeWorkspace';
import { OpenCollectionDialog } from './components/OpenCollectionDialog';
import { ImportCheck } from './components/ImportCheck';
import { createChildNode, createRootNode } from './view-state';
import { useCodeTab } from './hooks/useCodeTab';
import { refreshCodeFiles } from './hooks/useCodeFiles';
import { refreshImportCheck } from './hooks/useImportCheck';
import { useRefresh } from './hooks/useRefresh';
import { codeStateLabels, shareableFileFilter } from './code-presentation';
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
import { Field, FieldDescription, FieldLabel } from './components/ui/field';
import { Input } from './components/ui/input';
import { Toaster } from './components/ui/sonner';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { SharedTooltip, TooltipProvider } from './components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';

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
  // The tree the action left behind; any other tree makes the undo stale.
  readonly treeRoot: CollectionNode | undefined;
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

/** This page's address with another URL fragment, e.g. a view link. */
/** Identifies an instance's deployment, e.g. to key per-instance state. */
function instanceKey(instance: {
  readonly instanceZuid: string;
  readonly deployment: string;
}): string {
  return `${instance.instanceZuid}:${instance.deployment}`;
}

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
  const [pastedUrl, setPastedUrl] = useState('');
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
  const [clearTokenOpen, setClearTokenOpen] = useState(false);
  const instancePickerInput = useRef<HTMLInputElement>(null);
  const rootCollectionInput = useRef<HTMLInputElement>(null);
  const pastedUrlInput = useRef<HTMLInputElement>(null);
  const startFormProblem = useFieldProblem({
    instance: instancePickerInput,
    'root-collection': rootCollectionInput,
    'pasted-url': pastedUrlInput,
  });
  const pendingUndo = useRef<PendingUndo | undefined>(undefined);
  const pageHeader = useRef<HTMLElement>(null);
  const focusPicker = useCallback((form: HTMLFormElement | null) => {
    if (!form) return;
    const root = rootCollectionInput.current;
    if (root && !root.disabled) root.focus();
    else instancePickerInput.current?.focus();
  }, []);
  const [relationshipSchemaSemaphore] = useState(() => Effect.runSync(Effect.makeSemaphore(2)));

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
        ? ({ version: 2, root: treeRoot, contentState, viewFilters } as const)
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
    if (pendingUndo.current?.treeRoot === treeRoot) return;
    withdrawUndo();
  }, [treeRoot]);

  const requiresCompleteView = Boolean(
    treeRoot?.children.length &&
    (treeRoot.presentation.freeText || viewFilters.some((filter) => filter.nodePath.length > 0)),
  );
  const loadedViewQuery = useLoadedView({
    api,
    root: treeRoot,
    contentState,
    sessionToken: activeToken,
    enabled: Boolean(
      treeRoot && activeToken && deployment === treeRoot.reference.deployment && screen === 'view',
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
  const instanceList = useInstanceList({
    api,
    deployment,
    sessionToken: activeToken,
    enabled: screen === 'picker' && !reference,
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
  const instanceListAuthenticationFailed = instanceList.error?.kind === 'authentication';
  useEffect(() => {
    const tokenRejected =
      instanceListAuthenticationFailed ||
      catalogAuthenticationFailed ||
      authenticationFailed ||
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
    catalogAuthenticationFailed,
    instanceListAuthenticationFailed,
    workspaceAuthenticationFailureRevision,
    credentialRevision,
    deployment,
    previewAuthenticationFailureRevision,
    sessionTokens,
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

  function saveSessionToken(token: string) {
    sessionTokens.save(deployment, token);
    setRejectedDeployment(undefined);
    setStep((current) => (current === 'credentials' ? 'picker' : current));
  }

  function chooseInstance(next: InstanceReference | undefined) {
    withdrawUndo();
    setCatalogInstance(next);
    setSelectedRootZuid(next?.suggestedModelZuid);
    startFormProblem.clear();
  }

  function pickInstance(next: InstanceReference | undefined) {
    if (next && catalogInstance && instanceKey(next) === instanceKey(catalogInstance)) return;
    setPastedUrl('');
    chooseInstance(next);
  }

  function pastedReferenceProblem(parsed: InstanceReference): string | undefined {
    if (reference && instanceKey(parsed) !== instanceKey(reference)) {
      return 'Paste a collection from the same Zesty instance and deployment.';
    }
    return undefined;
  }

  // Typing only edits the draft. Paste, blur, and submit commit a complete reference.
  function applyPastedUrl(value: string): InstanceReference | undefined {
    if (!value.trim()) return undefined;
    const parsed = parseInstanceReference(value);
    if (!parsed.ok) {
      startFormProblem.report('pasted-url', parsed.error.message);
      return undefined;
    }
    const problem = pastedReferenceProblem(parsed.value);
    if (problem) {
      startFormProblem.report('pasted-url', problem);
      return undefined;
    }
    if (
      catalogInstance &&
      instanceKey(parsed.value) === instanceKey(catalogInstance) &&
      parsed.value.suggestedModelZuid === catalogInstance.suggestedModelZuid &&
      parsed.value.suggestedItemZuid === catalogInstance.suggestedItemZuid &&
      parsed.value.suggestedArea === catalogInstance.suggestedArea
    )
      return catalogInstance;
    chooseInstance(parsed.value);
    return parsed.value;
  }

  function leavePicker() {
    setPastedUrl('');
    startFormProblem.clear();
    setCatalogInstance(reference ? instanceReference(reference) : undefined);
    setSelectedRootZuid(reference?.modelZuid);
    setStep(reference ? 'view' : 'credentials');
  }

  const rootPickerCollections = useMemo(() => {
    const collections = [...(catalogQuery.catalog?.collections ?? [])];
    if (!catalogInstance) return collections;
    const fallbackReference: CollectionReference | undefined = catalogInstance.suggestedModelZuid
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
  }, [catalogInstance, catalogQuery.catalog?.collections]);

  function confirmRoot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pasted = pastedUrl.trim() ? applyPastedUrl(pastedUrl) : undefined;
    if (pastedUrl.trim() && !pasted) return;
    const targetInstance = pasted ?? catalogInstance;
    if (!targetInstance) {
      startFormProblem.report('instance', 'Choose an instance or paste a Zesty URL.');
      return;
    }
    if (targetInstance.deployment !== deployment || !sessionTokens.read(targetInstance.deployment))
      return;
    // The submit may apply a URL before React has rendered its suggested collection.
    const modelZuid =
      pasted && pasted !== catalogInstance ? pasted.suggestedModelZuid : selectedRootZuid;
    const selected =
      rootPickerCollections.find(
        (collection) =>
          instanceKey(collection.reference) === instanceKey(targetInstance) &&
          collection.reference.modelZuid === modelZuid,
      ) ??
      (modelZuid
        ? {
            label: modelZuid,
            reference: {
              instanceZuid: targetInstance.instanceZuid,
              deployment: targetInstance.deployment,
              apiBaseUrl: targetInstance.apiBaseUrl,
              managerBaseUrl: targetInstance.managerBaseUrl,
              area: targetInstance.suggestedArea ?? 'other',
              modelZuid,
            },
          }
        : undefined);
    if (!selected) {
      startFormProblem.report(
        'root-collection',
        'Choose a root collection or paste a collection URL.',
      );
      return;
    }
    const selectedReference: CollectionReference = {
      ...selected.reference,
      ...(targetInstance.suggestedModelZuid === selected.reference.modelZuid &&
      targetInstance.suggestedItemZuid
        ? { itemZuid: targetInstance.suggestedItemZuid }
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
      return createRootNode(selectedReference, label);
    });
    setSelectedItemId(selectedReference.itemZuid);
    startFormProblem.clear();
    setStep('view');
  }

  function clearToken() {
    sessionTokens.clear(deployment);
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
    };
    clearView();
    offerUndo('View reset', 'Your session token was kept.', undefined, () => restoreView(previous));
  }

  // Restores a view like opening its shared link: the token comes from the store.
  function restoreView(view: PersistedView) {
    const rootReference = view.root.reference;
    startFormProblem.clear();
    setStep('view');
    setPastedUrl('');
    setTreeRoot(view.root);
    setReference(rootReference);
    setContentState(view.contentState);
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
    setPastedUrl('');
    setChosenDeployment(deployment);
    setContentState('latest');
    setViewFilters([]);
    setSelectedItemId(undefined);
    setViewDecodeError(undefined);
    setStep('picker');
    startFormProblem.clear();
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

  function openRootPicker() {
    if (!reference) return;
    setPastedUrl('');
    startFormProblem.clear();
    setCatalogInstance(instanceReference(reference));
    setSelectedRootZuid(reference.modelZuid);
    setStep('picker');
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
        <DropdownMenuItem onClick={resetView}>
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
      <Button variant="outline" size="sm" onClick={copyLink}>
        <Copy size={14} aria-hidden="true" /> Copy link
      </Button>
      {viewOptions}
    </>
  );

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
      <header
        ref={pageHeader}
        className="border-border bg-card/95 sticky top-0 z-30 flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b px-4 py-3 shadow-xs backdrop-blur lg:px-6"
      >
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <h1 className="text-sm font-semibold">Zesty Explorer</h1>
            <span className="text-muted-foreground text-xs">Read-only content browser</span>
          </div>
          {showTabs ? (
            <Tabs
              className="ml-4"
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
              <RefreshButton
                refreshing={isRefreshing}
                failed={refreshFailed}
                onRefresh={() => void refreshAll()}
              />
              {sharedActions}
            </>
          ) : (
            <Badge variant="outline">No collection open</Badge>
          )}
        </div>
      </header>

      <div
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)]"
        hidden={visibleTab !== 'explorer'}
      >
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
              onBack={step === 'picker' && catalogInstance ? leavePicker : undefined}
              onSubmit={saveSessionToken}
            />
          ) : screen === 'picker' ? (
            <Card className="mx-auto my-[8vh] w-full max-w-xl py-0">
              <form
                className="grid gap-4 p-6"
                ref={focusPicker}
                aria-labelledby="root-picker-title"
                noValidate
                onSubmit={confirmRoot}
              >
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Choose a root · {deploymentLabels[deployment]}
                </p>
                <h2 className="text-xl font-semibold" id="root-picker-title">
                  Choose an instance and root collection
                </h2>
                <InstancePicker
                  query={instanceList}
                  value={catalogInstance}
                  onChange={pickInstance}
                  disabled={Boolean(reference)}
                  error={startFormProblem.messageFor('instance')}
                  inputRef={instancePickerInput}
                />
                {catalogInstance ? (
                  <>
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
                      loading={catalogQuery.isLoading}
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
                  </>
                ) : null}
                <Field className="border-t pt-4" error={startFormProblem.messageFor('pasted-url')}>
                  <FieldLabel>Or paste a Zesty URL</FieldLabel>
                  <Input
                    ref={pastedUrlInput}
                    type="url"
                    value={pastedUrl}
                    placeholder="https://8-….manager.zesty.io/content/6-…"
                    onChange={(event) => {
                      const value = event.target.value;
                      setPastedUrl(value);
                      startFormProblem.clear('pasted-url');
                      if ((event.nativeEvent as InputEvent).inputType === 'insertFromPaste')
                        applyPastedUrl(value);
                    }}
                    onBlur={(event) => applyPastedUrl(event.target.value)}
                  />
                  <FieldDescription>
                    {reference
                      ? 'A Zesty Manager or Instances API URL of a collection or item in this instance.'
                      : 'A Zesty Manager or Instances API URL of an instance, collection, or item. Use it for a deep link or an instance the list does not show.'}
                  </FieldDescription>
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" type="button" onClick={leavePicker}>
                    Back
                  </Button>
                  <Button type="submit">Open root collection</Button>
                </div>
              </form>
            </Card>
          ) : null}

          {screen === 'view' && loadStatus.kind === 'loading-root' ? <RootTableSkeleton /> : null}
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
          {screen === 'view' && loadedView && treeRoot && rootSnapshot && rootSchema ? (
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
              >
                <RootTable
                  key={`${treeRoot.reference.instanceZuid}:${treeRoot.reference.modelZuid}:${treeRoot.id}`}
                  schema={rootSchema}
                  snapshot={rootSnapshot}
                  reference={treeRoot.reference}
                  treeRoot={treeRoot}
                  loadedView={loadedView}
                  contentState={contentState}
                  resultsPending={descendantResultsPending}
                  viewFilters={viewFilters}
                  onViewFiltersChange={setViewFilters}
                  onOpenDetails={openDetails}
                  onRetry={() => void refreshCollections()}
                  onPresentationChange={changePresentation}
                  pageHeader={pageHeader}
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
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
