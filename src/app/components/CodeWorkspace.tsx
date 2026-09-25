// The Code tab: every `/web/views` file of the instance and the selected file's explained source.
import { ArrowLeft, FileCode2, FileQuestion } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  CodeFile,
  CodeFileZuid,
  CodeState,
  CollectionCatalog,
  ExplorerError,
  InstanceReference,
  ModelZuid,
} from '../../domain';
import {
  analyzeParsley,
  formattedLines,
  parseParsley,
  savedLines,
  sourceModeFor,
  type CodeCollection,
  type CodeFileSummary,
} from '../../parsley';
import type { CodeFileApi, CollectionApi } from '../../zesty-api';
import {
  catalogTones,
  codeStateLabels,
  fileFormatLabel,
  fileTypeLabel,
} from '../code-presentation';
import type { CodeSelection } from '../../domain';
import {
  clearCodeCacheOutsideRevision,
  useCodeFiles,
  useCodeSchemas,
  type CodeCredentials,
} from '../hooks/useCodeFiles';
import { cn } from '../lib/utils';
import { CodeSourceView, type SourcePresentation } from './CodeSourceView';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Skeleton } from './ui/skeleton';

interface CallSite {
  readonly fileId: CodeFileZuid;
  readonly fileName: string;
  readonly target: string;
}

interface CodeWorkspaceProps {
  readonly api: CodeFileApi & Pick<CollectionApi, 'loadCollectionSchema'>;
  readonly instance: InstanceReference;
  readonly credentials: CodeCredentials;
  readonly catalog: CollectionCatalog | undefined;
  readonly selection: CodeSelection;
  readonly onSelectionChange: (selection: CodeSelection) => void;
  readonly onOpenCollection: (modelZuid: ModelZuid) => void;
  readonly onAuthenticationFailure: () => void;
}

export function CodeWorkspace({
  api,
  instance,
  credentials,
  catalog,
  selection,
  onSelectionChange,
  onOpenCollection,
  onAuthenticationFailure,
}: CodeWorkspaceProps) {
  const [presentation, setPresentation] = useState<SourcePresentation>('formatted');
  // Include navigation history; the top entry is where "Back" returns to.
  const [callSites, setCallSites] = useState<readonly CallSite[]>([]);
  const [returnPin, setReturnPin] = useState<string>();
  const { state, fileId } = selection;
  const queryClient = useQueryClient();
  // A call site belongs to the version the user came from, so switching code states drops it.
  const [shownState, setShownState] = useState(state);
  if (state !== shownState) {
    setShownState(state);
    setCallSites([]);
    setReturnPin(undefined);
  }

  useEffect(
    () => clearCodeCacheOutsideRevision(queryClient, credentials.revision),
    [credentials.revision, queryClient],
  );

  // The file list always comes from the latest saved files, which include unpublished ones.
  const latest = useCodeFiles({ api, instance, state: 'latest', credentials, enabled: true });
  const selectedInLatest = latest.list?.files.find((file) => file.id === fileId);
  const published = useCodeFiles({
    api,
    instance,
    state: 'published',
    credentials,
    enabled: state === 'published' || Boolean(latest.list && fileId && !selectedInLatest),
  });
  const stateQuery = state === 'latest' ? latest : published;
  const otherQuery = state === 'latest' ? published : latest;
  const selected = stateQuery.list?.files.find((file) => file.id === fileId);
  const otherState: CodeState = state === 'latest' ? 'published' : 'latest';
  const inOtherState = otherQuery.list?.files.find((file) => file.id === fileId);
  // Names the file even when the selected code state has no version of it.
  const named = selected ?? inOtherState;
  const authenticationFailed =
    latest.error?.kind === 'authentication' || published.error?.kind === 'authentication';

  useEffect(() => {
    if (authenticationFailed) onAuthenticationFailure();
  }, [authenticationFailed, onAuthenticationFailure]);

  const select = (next: CodeSelection) => {
    setReturnPin(undefined);
    onSelectionChange(next);
  };
  const openFromList = (id: CodeFileZuid) => {
    setCallSites([]);
    select({ state, fileId: id });
  };
  const openSnippet = (snippetId: CodeFileZuid, callSite: string) => {
    if (!fileId || !selected) return;
    setCallSites((current) => [
      ...current,
      { fileId, fileName: selected.fileName, target: callSite },
    ]);
    select({ state, fileId: snippetId });
  };
  const returnToCallSite = () => {
    const callSite = callSites.at(-1);
    if (!callSite) return;
    setCallSites((current) => current.slice(0, -1));
    onSelectionChange({ state, fileId: callSite.fileId });
    setReturnPin(callSite.target);
  };

  const files = useMemo(
    () =>
      [...(latest.list?.files ?? [])].sort((left, right) =>
        left.fileName.localeCompare(right.fileName, 'en', { numeric: true, sensitivity: 'base' }),
      ),
    [latest.list],
  );

  return (
    <div className="grid h-[calc(100vh-72px)] min-h-0 grid-cols-[16rem_minmax(0,1fr)]">
      <nav
        className="border-border bg-card min-h-0 overflow-auto border-r p-3"
        aria-label="Code files"
      >
        <p className="text-muted-foreground mb-2 flex items-center gap-2 px-2 text-xs font-semibold tracking-wider uppercase">
          <FileCode2 size={15} aria-hidden="true" /> Files
          {latest.list ? <span className="text-muted-foreground/70">{files.length}</span> : null}
        </p>
        {latest.isLoading ? (
          <div className="grid gap-2 px-2" aria-label="Loading code files">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-5" />
            ))}
          </div>
        ) : null}
        {latest.error ? (
          <div className="text-muted-foreground grid gap-2 px-2 text-xs" role="alert">
            <p>{latest.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void latest.refresh()}>
              Retry
            </Button>
          </div>
        ) : null}
        {latest.list?.warning ? (
          <p className="text-muted-foreground mb-2 px-2 text-xs" role="status">
            {latest.list.warning.message}
          </p>
        ) : null}
        {latest.list && files.length === 0 ? (
          <p className="text-muted-foreground px-2 text-xs">
            This instance returned no code files.
          </p>
        ) : null}
        <ul className="grid gap-0.5">
          {files.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => openFromList(file.id)}
                aria-current={file.id === fileId ? 'true' : undefined}
                className={cn(
                  'hover:bg-surface-menu-hover grid w-full rounded-md px-2 py-1.5 text-left',
                  file.id === fileId && 'bg-surface-menu-hover ring-primary/40 ring-1',
                )}
              >
                <span className="truncate font-mono text-xs">{file.fileName}</span>
                <span className="text-muted-foreground text-[11px]">{fileTypeLabel(file)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section className="flex min-h-0 min-w-0 flex-col gap-3 p-4 lg:px-6">
        {named ? (
          <div className="flex min-h-7 flex-wrap items-center gap-3">
            <h2 className="min-w-0 truncate font-mono text-base font-semibold">{named.fileName}</h2>
            <Badge variant="secondary">{fileTypeLabel(named)}</Badge>
            <Badge variant="outline">{fileFormatLabel(named.fileName)}</Badge>
            {selected ? (
              <span className="text-muted-foreground text-xs">
                {codeStateLabels[state]} · version {selected.version}
              </span>
            ) : null}
          </div>
        ) : null}

        {callSites.length ? (
          <div className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">
              Opened from an include in{' '}
              <code className="text-foreground">{callSites.at(-1)!.fileName}</code>. Its analysis
              does not include this snippet.
            </span>
            <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={returnToCallSite}>
              <ArrowLeft size={14} aria-hidden="true" /> Back to call site
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1">
          {stateQuery.error ? (
            <CodeError error={stateQuery.error} onRetry={() => void stateQuery.refresh()} />
          ) : !fileId ? (
            <Empty
              title="Choose a file"
              description="Select a file on the left to see its source, what it uses, and how it works."
            />
          ) : selected ? (
            <ExplainedFile
              key={`${selected.id}:${state}`}
              api={api}
              instance={instance}
              credentials={credentials}
              file={selected}
              files={files}
              catalog={catalog}
              presentation={presentation}
              onPresentationChange={setPresentation}
              {...(returnPin ? { initialPinned: returnPin } : {})}
              onOpenSnippet={openSnippet}
              onOpenCollection={onOpenCollection}
            />
          ) : stateQuery.isLoading || otherQuery.isLoading ? (
            <Skeleton className="h-full min-h-64" />
          ) : inOtherState ? (
            <Empty
              title={`No ${codeStateLabels[state].toLowerCase()} version`}
              description={`${inOtherState.fileName} has no ${codeStateLabels[state].toLowerCase()} version. Zesty Explorer does not switch code states for you.`}
              action={
                <Button variant="outline" onClick={() => select({ state: otherState, fileId })}>
                  View {codeStateLabels[otherState].toLowerCase()}
                </Button>
              }
            />
          ) : (
            <Empty
              icon
              title="File not found"
              description={`No file with ZUID ${fileId} was returned for this instance. It may have been deleted, or your session may not be able to read it. Choose a file from the list.`}
            />
          )}
        </div>
      </section>
    </div>
  );
}

interface ExplainedFileProps {
  readonly api: Pick<CollectionApi, 'loadCollectionSchema'>;
  readonly instance: InstanceReference;
  readonly credentials: CodeCredentials;
  readonly file: CodeFile;
  readonly files: readonly CodeFileSummary[];
  readonly catalog: CollectionCatalog | undefined;
  readonly presentation: SourcePresentation;
  readonly onPresentationChange: (presentation: SourcePresentation) => void;
  readonly initialPinned?: string;
  readonly onOpenSnippet: (fileId: CodeFileZuid, callSite: string) => void;
  readonly onOpenCollection: (modelZuid: ModelZuid) => void;
}

// Parses once per file; re-analyzes as field schemas arrive, since each schema can reveal a
// relationship whose related collection needs its own schema.
function ExplainedFile({
  api,
  instance,
  credentials,
  file,
  files,
  catalog,
  presentation,
  onPresentationChange,
  initialPinned,
  onOpenSnippet,
  onOpenCollection,
}: ExplainedFileProps) {
  const [requested, setRequested] = useState<readonly ModelZuid[]>([]);
  const { schemas, isLoading } = useCodeSchemas({
    api,
    instance,
    modelZuids: requested,
    credentials,
  });
  const document = useMemo(() => parseParsley(file.code), [file.code]);
  const collections = useMemo(
    () =>
      (catalog?.collections ?? []).map((entry): CodeCollection => ({
        modelZuid: entry.reference.modelZuid,
        name: entry.name,
        label: entry.label,
      })),
    [catalog],
  );
  const analysis = useMemo(
    () =>
      analyzeParsley(document, {
        collections,
        schemas,
        files,
        ...(file.contentModelZuid ? { boundModelZuid: file.contentModelZuid } : {}),
      }),
    [collections, document, file.contentModelZuid, files, schemas],
  );
  const missing = analysis.wantedModels.filter((modelZuid) => !requested.includes(modelZuid));
  if (missing.length) setRequested([...requested, ...missing]);

  const toneFor = useMemo(
    () => catalogTones(collections.map((collection) => collection.modelZuid)),
    [collections],
  );
  const mode = sourceModeFor(file.fileName, document);
  const saved = useMemo(
    () => savedLines(document, analysis.annotations, mode),
    [analysis.annotations, document, mode],
  );
  const formatted = useMemo(
    () => formattedLines(document, analysis.annotations, mode),
    [analysis.annotations, document, mode],
  );

  return (
    <CodeSourceView
      analysis={analysis}
      saved={saved}
      formatted={formatted}
      presentation={presentation}
      onPresentationChange={onPresentationChange}
      {...(initialPinned ? { initialPinned } : {})}
      fieldsLoading={isLoading || missing.length > 0}
      toneFor={toneFor}
      onOpenSnippet={onOpenSnippet}
      onOpenCollection={onOpenCollection}
    />
  );
}

function Empty({
  icon,
  title,
  description,
  action,
}: {
  readonly icon?: boolean;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div
      className="border-border text-muted-foreground mx-auto mt-[8vh] grid max-w-md justify-items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm"
      role="status"
    >
      {icon ? <FileQuestion size={20} aria-hidden="true" /> : null}
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function CodeError({
  error,
  onRetry,
}: {
  readonly error: ExplorerError;
  readonly onRetry: () => void;
}) {
  return (
    <Card
      className="border-destructive/40 bg-destructive/10 mx-auto my-[8vh] max-w-2xl"
      role="alert"
    >
      <CardHeader>
        <h3 className="text-lg font-semibold">Code files could not load</h3>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </CardHeader>
      <CardContent>
        <ErrorTechnicalDetails error={error} />
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </CardFooter>
    </Card>
  );
}
