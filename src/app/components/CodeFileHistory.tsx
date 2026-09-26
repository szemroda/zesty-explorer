// Code history: previews and compares saved versions of a code file, laid out like item history.
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CodeFileZuid, InstanceReference } from '../../domain';
import type { CodeFileApi, ItemVersionApi } from '../../zesty-api';
import {
  displayText,
  versionSource,
  type CodeVersionOption,
  type VersionSource,
} from '../code-file-history';
import { managerCodeFileUrl, neutralTone } from '../code-presentation';
import { useCodeFileHistory, type CodeCredentials } from '../hooks/useCodeFiles';
import {
  countChangedLines,
  diffTextSideBySide,
  resolveVersionPair,
  type SideBySideRow,
  type VersionNumberPair,
} from '../item-version-comparison';
import {
  authorLabel,
  matchesVersionPreviewOption,
  savedDescription,
} from '../item-version-preview';
import { cn } from '../lib/utils';
import { IndentGuides, LineTokens, type SourcePresentation } from './CodeSourceView';
import { SideBySideComparison } from './ItemVersionComparison';
import {
  ModeToggle,
  ResourceNotice,
  VersionBadges,
  VersionCard,
  SavedVersionsSidebar,
  VersionPairSelect,
  type HistoryMode,
} from './SavedVersions';
import { Button } from './ui/button';
import { buttonVariants } from './ui/button-variants';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

interface CodeFileHistoryProps {
  readonly api: CodeFileApi & Pick<ItemVersionApi, 'loadInstanceUsers'>;
  readonly instance: InstanceReference;
  readonly credentials: CodeCredentials;
  readonly file: { readonly id: CodeFileZuid; readonly fileName: string };
  /** The version open in the Code tab, previewed first. */
  readonly shownVersion: number | undefined;
  readonly publishedVersion: number | undefined;
  readonly initialPresentation: SourcePresentation;
  readonly onClose: () => void;
  readonly onAuthenticationFailure: () => void;
}

function isPresentation(value: unknown): value is SourcePresentation {
  return value === 'formatted' || value === 'saved';
}

function describeDiff(rows: readonly SideBySideRow[]): string {
  const { removed, added } = countChangedLines(rows);
  if (removed + added === 0) return 'No line differences';
  return `${removed} ${removed === 1 ? 'line' : 'lines'} removed · ${added} ${added === 1 ? 'line' : 'lines'} added`;
}

export function CodeFileHistory({
  api,
  instance,
  credentials,
  file,
  shownVersion,
  publishedVersion,
  initialPresentation,
  onClose,
  onAuthenticationFailure,
}: CodeFileHistoryProps) {
  const [presentation, setPresentation] = useState(initialPresentation);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<HistoryMode>('view');
  const [selectedNumber, setSelectedNumber] = useState(shownVersion);
  const [chosenPair, setChosenPair] = useState<VersionNumberPair>();
  const history = useCodeFileHistory({
    api,
    instance,
    fileId: file.id,
    publishedVersion,
    credentials,
  });
  const authenticationFailed = [history.versions, history.authors].some(
    (resource) => resource.error?.kind === 'authentication',
  );
  useEffect(() => {
    if (authenticationFailed) onAuthenticationFailure();
  }, [authenticationFailed, onAuthenticationFailure]);

  const { options } = history;
  const visibleOptions = useMemo(
    () => options.filter((option) => matchesVersionPreviewOption(option, search)),
    [options, search],
  );
  const selected = options.find((option) => option.number === selectedNumber) ?? options[0];
  const historyLoaded = !history.versions.isLoading && !history.versions.error;
  const pair = useMemo(
    () =>
      mode === 'compare' && historyLoaded
        ? resolveVersionPair(options, selected?.number, chosenPair)
        : undefined,
    [chosenPair, historyLoaded, mode, options, selected?.number],
  );
  const selectedSource = useMemo(
    () => (selected ? versionSource(file.fileName, selected.code) : undefined),
    [file.fileName, selected],
  );
  const rows = useMemo(() => {
    if (!pair) return undefined;
    const text = (option: CodeVersionOption) =>
      presentation === 'saved'
        ? option.code
        : displayText(versionSource(file.fileName, option.code).formatted);
    return diffTextSideBySide(text(pair.before), text(pair.after));
  }, [file.fileName, pair, presentation]);
  const content =
    mode === 'view' ? (
      selectedSource ? (
        <VersionSourceLines source={selectedSource} presentation={presentation} />
      ) : null
    ) : pair && rows ? (
      <SideBySideComparison
        key={`${pair.before.number}-${pair.after.number}-${presentation}`}
        label="Source comparison"
        rows={rows}
        pair={pair}
        identicalMessage={
          presentation === 'saved'
            ? 'The sources of these versions are identical.'
            : 'The sources of these versions differ only in whitespace outside strings.'
        }
      />
    ) : null;
  function selectMode(next: HistoryMode) {
    setMode(next);
    setChosenPair(undefined);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid h-[min(820px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] grid-rows-[65px_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        aria-labelledby="code-history-title"
        showCloseButton={false}
      >
        <DialogHeader className="flex grid-cols-none flex-row items-center justify-between border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-[10px] font-bold tracking-[.12em] text-primary uppercase">
              Code history
            </span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <DialogTitle id="code-history-title" className="truncate font-mono text-base">
              {file.fileName}
            </DialogTitle>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{file.id}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              href={managerCodeFileUrl(instance, file.id)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} aria-hidden="true" />
              Open in Zesty Manager
            </a>
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="Close code history"
            >
              <X size={18} />
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[285px_minmax(0,1fr)]">
          <SavedVersionsSidebar
            isLoading={history.versions.isLoading}
            total={history.total}
            search={mode === 'view' ? search : undefined}
            onSearchChange={setSearch}
          >
            {history.versions.error ? (
              <ResourceNotice
                label={history.versions.error.message}
                {...(history.versions.error.kind === 'missing-resource'
                  ? { recovery: 'Refresh the Code tab to update its file list.' }
                  : {})}
                error={history.versions.error}
                retry={history.versions.retry}
              />
            ) : null}
            {history.total > options.length ? (
              <p className="px-2 text-xs text-muted-foreground" role="status">
                Zesty returned only the newest {options.length} of {history.total} saved versions.
                Older versions are not listed.
              </p>
            ) : null}
            {history.authors.error ? (
              <ResourceNotice
                label="Authors could not load."
                error={history.authors.error}
                retry={history.authors.retry}
              />
            ) : null}
            {mode === 'compare' ? (
              pair ? (
                <VersionPairSelect options={options} pair={pair} onChange={setChosenPair} />
              ) : historyLoaded && options.length === 1 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  This file has only one saved version.
                </p>
              ) : null
            ) : (
              <>
                {visibleOptions.map((option) => (
                  <VersionCard
                    key={option.number}
                    option={option}
                    selected={selected?.number === option.number}
                    onSelect={() => setSelectedNumber(option.number)}
                  />
                ))}
                {options.length > 0 && visibleOptions.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    No saved versions match this search.
                  </p>
                ) : null}
              </>
            )}
          </SavedVersionsSidebar>

          <section
            className="min-h-0 overflow-y-auto p-5 md:p-6"
            aria-label={mode === 'compare' ? 'Version comparison' : 'Version preview'}
          >
            {historyLoaded && options.length === 0 ? (
              <p
                className="mx-auto mt-[8vh] max-w-md text-center text-sm text-muted-foreground"
                role="status"
              >
                Zesty returned no saved versions of this file.
              </p>
            ) : selected ? (
              <>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  {mode === 'compare' ? (
                    <div>
                      <h2 className="text-2xl font-bold">
                        {pair
                          ? `Version ${pair.before.number} → ${pair.after.number}`
                          : 'Compare versions'}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {rows ? describeDiff(rows) : 'This file has only one saved version.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <h2 className="text-2xl font-bold">Version {selected.number}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {savedDescription(selected.savedAt)} · {authorLabel(selected)}
                        </p>
                      </div>
                      <VersionBadges option={selected} />
                    </>
                  )}
                </div>

                <Tabs
                  value={presentation}
                  onValueChange={(value) => {
                    if (isPresentation(value)) setPresentation(value);
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <TabsList aria-label="Source presentation">
                      <TabsTrigger value="formatted">Formatted</TabsTrigger>
                      <TabsTrigger value="saved">As saved</TabsTrigger>
                    </TabsList>
                    <ModeToggle label="Code history mode" mode={mode} onChange={selectMode} />
                  </div>
                  {/* Only the active panel mounts, so both render the chosen presentation. */}
                  <TabsContent value="formatted">{content}</TabsContent>
                  <TabsContent value="saved">{content}</TabsContent>
                </Tabs>
              </>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionSourceLines({
  source,
  presentation,
}: {
  readonly source: VersionSource;
  readonly presentation: SourcePresentation;
}) {
  const saved = presentation === 'saved';
  const lines = saved ? source.saved : source.formatted;
  return (
    <div className="mt-3 overflow-auto rounded-lg border border-border bg-surface-recessed py-2 font-mono text-[12px] leading-6 [tab-size:2]">
      {lines.map((line, index) => (
        <div key={index} className="flex">
          <span className="w-12 shrink-0 pr-3 text-right text-muted-foreground/60 select-none">
            {index + 1}
          </span>
          <span
            className={cn(
              'min-w-0 pr-4',
              saved ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
            )}
          >
            <IndentGuides count={line.indent} />
            <LineTokens line={line} saved={saved} toneFor={() => neutralTone} onSelect={() => {}} />
          </span>
        </div>
      ))}
    </div>
  );
}
