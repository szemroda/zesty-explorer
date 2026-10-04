import {
  ArrowUpRight,
  FileSpreadsheet,
  LoaderCircle,
  MoreHorizontal,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { CollectionCatalog, CollectionCatalogEntry, ModelZuid } from '../../domain';
import {
  describeFileProblem,
  fileLines,
  issueCopy,
  importableRowsCsv,
  markdownReport,
  matchesLineQuery,
  needsAttention,
  parseCsv,
  parseLineQuery,
  problemRowsCsv,
  summarize,
  takesAnyLine,
  type CsvExport,
  type FileLine,
  type Finding,
  type FindingGroup,
  type FindingTone,
  type ImportCheck as Check,
} from '../../import-check';
import type { CollectionApi } from '../../zesty-api';
import { copyText } from '../copy-text';
import { useImportCheck, type CsvSource, type ImportCheckState } from '../hooks/useImportCheck';
import { cn } from '../lib/utils';
import { CollectionPicker } from './CollectionPicker';
import { ImportCheckGrid } from './ImportCheckGrid';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';

const dot: Readonly<Record<FindingTone, string>> = {
  rejected: 'bg-destructive',
  'at-risk': 'bg-amber-400',
  quiet: 'bg-muted-foreground/50',
};

/**
 * The Import check tab: predicts how many items Zesty's Import CSV would create from a file, and
 * why the others would not. The file is read locally and nothing is written to Zesty.
 */
export function ImportCheck({
  api,
  credentials,
  catalog,
  initialModelZuid,
  onAuthenticationFailure,
}: {
  readonly api: CollectionApi;
  readonly credentials: { readonly revision: string; readonly sessionToken: string };
  readonly catalog: CollectionCatalog | undefined;
  readonly initialModelZuid: ModelZuid | undefined;
  readonly onAuthenticationFailure: () => void;
}) {
  const collections = useMemo(
    () => (catalog?.collections ?? []).filter((entry) => entry.group !== 'other'),
    [catalog],
  );
  const [modelZuid, setModelZuid] = useState(initialModelZuid);
  const collection = collections.find((entry) => entry.reference.modelZuid === modelZuid);
  const [source, setSource] = useState<CsvSource>();
  const [changing, setChanging] = useState(false);
  const { state, reload, authenticationFailed } = useImportCheck({
    api,
    credentials,
    collection,
    source,
  });

  useEffect(() => {
    if (authenticationFailed) onAuthenticationFailure();
  }, [authenticationFailed, onAuthenticationFailure]);

  // Zesty's importer also reads the file as UTF-8. Each file is checked against fresh Zesty data.
  async function chooseFile(file: File) {
    const text = await file.text();
    reload();
    setSource({ fileName: file.name, parsed: parseCsv(text) });
    setChanging(false);
  }

  if (state.status === 'ready' && !changing && collection) {
    return (
      <Workspace check={state.check} collection={collection} onChange={() => setChanging(true)} />
    );
  }
  return (
    <div className="grid min-h-[calc(100vh-72px)] place-items-center p-6">
      <section className="grid w-full max-w-md gap-5" aria-labelledby="import-check-title">
        <div className="grid gap-1.5">
          <h2 id="import-check-title" className="text-xl font-semibold">
            Check a CSV before you import it
          </h2>
          <p className="text-muted-foreground text-sm">
            See how many entries Zesty will import, and why the others won’t.
          </p>
        </div>
        <CollectionPicker
          label="Collection to import into"
          collections={collections}
          value={collection?.reference.modelZuid}
          onChange={(entry: CollectionCatalogEntry | undefined) =>
            setModelZuid(entry?.reference.modelZuid)
          }
        />
        <CsvFileButton source={source} onFile={(file) => void chooseFile(file)} />
        <SetupStatus state={state} onShowResults={() => setChanging(false)} />
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <ShieldCheck size={14} className="shrink-0 text-emerald-500" aria-hidden="true" />
          The file stays in your browser. Nothing is written to Zesty.
        </p>
      </section>
    </div>
  );
}

function CsvFileButton({
  source,
  onFile,
}: {
  readonly source: CsvSource | undefined;
  readonly onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label="CSV file to check"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <Button type="button" className="w-full" onClick={() => input.current?.click()}>
        {source ? <FileSpreadsheet size={15} /> : <Upload size={15} />}
        {source ? source.fileName : 'Choose CSV file'}
      </Button>
    </>
  );
}

function SetupStatus({
  state,
  onShowResults,
}: {
  readonly state: ImportCheckState;
  readonly onShowResults: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
        <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> {state.step}…
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <p className="text-destructive text-sm" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status === 'ready') {
    return (
      <Button variant="outline" onClick={onShowResults}>
        Show results
      </Button>
    );
  }
  return null;
}

function Workspace({
  check,
  collection,
  onChange,
}: {
  readonly check: Check;
  readonly collection: CollectionCatalogEntry;
  readonly onChange: () => void;
}) {
  const groups = useMemo(() => summarize(check), [check]);
  const lines = useMemo(() => fileLines(check), [check]);
  const [findingId, setFindingId] = useState<string>();
  const [showAll, setShowAll] = useState(() => !lines.some(needsAttention));
  const [search, setSearch] = useState('');
  const [selectedLine, setSelectedLine] = useState<number>();
  const contents = useRef<HTMLElement>(null);

  const finding = groups.flatMap((group) => group.findings).find((item) => item.id === findingId);
  const query = parseLineQuery(search);
  const visible = lines.filter((line) => {
    if (query.kind !== 'none') return matchesLineQuery(line, query);
    if (finding?.lines) return takesAnyLine(line, finding.lines);
    if (finding) return true;
    return showAll || needsAttention(line);
  });
  const selected = lines.find((line) => line.line === selectedLine);

  useEffect(() => {
    if (selectedLine === undefined) return;
    contents.current
      ?.querySelector(`[data-line="${selectedLine}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedLine]);

  // A column finding scrolls to its column; anything else starts at the left.
  useEffect(() => {
    const focused = contents.current?.querySelector('[data-focused]');
    if (focused) {
      focused.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      return;
    }
    contents.current?.querySelector('[role="region"]')?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [findingId]);

  function pick(id: string) {
    setFindingId((current) => (current === id ? undefined : id));
    setSearch('');
    setSelectedLine(undefined);
  }

  function jumpToRow(row: number) {
    const target = check.rows[row - 1];
    if (!target) return;
    const line = target.record.line;
    if (!visible.some((candidate) => candidate.line === line)) {
      setFindingId(undefined);
      setSearch('');
      setShowAll(true);
    }
    setSelectedLine(line);
  }

  return (
    <div className="flex flex-col lg:h-[calc(100vh-72px)]">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <FileSpreadsheet
            size={16}
            className="text-muted-foreground shrink-0"
            aria-hidden="true"
          />
          <span className="truncate font-medium">{check.fileName}</span>
          <span className="text-muted-foreground" aria-label="into">
            →
          </span>
          <span className="truncate font-medium">{collection.label}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
            onClick={onChange}
          >
            Change
          </button>
        </p>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <label className="relative flex flex-1 items-center sm:w-80 sm:flex-none">
            <Search
              className="text-muted-foreground absolute left-3"
              size={15}
              aria-hidden="true"
            />
            <Input
              type="search"
              className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
              aria-label="Search the file"
              placeholder="Find a value, “line 12” or “row 12”"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setFindingId(undefined);
                setSelectedLine(undefined);
              }}
            />
            {search ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground absolute right-2.5 grid size-5 place-items-center rounded"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
          <MoreMenu check={check} groups={groups} collectionLabel={collection.label} />
        </div>
      </header>
      <div
        className={cn(
          'grid min-h-0 flex-1 lg:grid-cols-[20rem_minmax(0,1fr)]',
          selected && 'xl:grid-cols-[20rem_minmax(0,1fr)_19rem]',
        )}
      >
        <nav
          className="border-border min-h-0 overflow-y-auto border-b pb-4 lg:border-r lg:border-b-0"
          aria-label="Summary"
        >
          <Headline check={check} />
          {groups.length === 0 ? (
            <p className="text-muted-foreground px-4 pt-4 text-sm">
              No problems found. Zesty should import every entry.
            </p>
          ) : (
            groups.map((group) => (
              <GroupList key={group.id} group={group} selectedId={findingId} onPick={pick} />
            ))
          )}
        </nav>
        <section
          ref={contents}
          className="flex min-h-0 min-w-0 flex-col max-lg:h-[75vh]"
          aria-label="File contents"
        >
          <GridHeading
            finding={finding}
            search={query.kind === 'none' ? undefined : search.trim()}
            shown={visible.length}
            showAll={showAll}
            totalLines={check.funnel.dataLines}
            onShowAll={setShowAll}
            onClear={() => setFindingId(undefined)}
          />
          <ImportCheckGrid
            check={check}
            lines={visible}
            selectedLine={selectedLine}
            onSelect={(line) => setSelectedLine((current) => (current === line ? undefined : line))}
            {...(query.kind === 'text' ? { highlight: query.text } : {})}
            {...(finding?.column !== undefined ? { focusColumn: finding.column } : {})}
          />
        </section>
        {selected ? (
          <Details
            entry={selected}
            check={check}
            onClose={() => setSelectedLine(undefined)}
            onJump={jumpToRow}
          />
        ) : null}
      </div>
    </div>
  );
}

function Headline({ check }: { readonly check: Check }) {
  const { funnel } = check;
  return (
    <div className="border-border border-b px-4 py-4">
      <p className="flex items-baseline gap-2">
        <span
          className={cn(
            'text-4xl font-semibold tabular-nums',
            check.fileRejected && 'text-destructive',
          )}
        >
          {funnel.created}
        </span>{' '}
        <span className="text-muted-foreground text-sm">
          {funnel.created === 1 ? 'item' : 'items'} expected
        </span>
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        from {funnel.dataLines} lines in the file · nothing is written to Zesty
      </p>
    </div>
  );
}

function GroupList({
  group,
  selectedId,
  onPick,
}: {
  readonly group: FindingGroup;
  readonly selectedId: string | undefined;
  readonly onPick: (id: string) => void;
}) {
  const titleId = `import-check-group-${group.id}`;
  return (
    <section className="px-2 pt-4" aria-labelledby={titleId}>
      <h3
        id={titleId}
        className="text-muted-foreground flex justify-between px-2 pb-1 text-xs font-medium"
      >
        {group.title}
        {group.deducted ? <span className="tabular-nums">−{group.deducted}</span> : null}
      </h3>
      <ul>
        {group.findings.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={item.id === selectedId}
              onClick={() => onPick(item.id)}
              className={cn(
                'focus-visible:ring-ring/45 flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2',
                item.id === selectedId ? 'bg-primary/15' : 'hover:bg-surface-menu-hover',
              )}
            >
              <span
                className={cn('size-2 shrink-0 rounded-full', dot[item.tone])}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  item.column !== undefined && 'font-mono text-xs',
                )}
              >
                {item.label}
              </span>
              {item.count !== undefined ? (
                <span className="text-muted-foreground tabular-nums">{item.count}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GridHeading({
  finding,
  search,
  shown,
  showAll,
  totalLines,
  onShowAll,
  onClear,
}: {
  readonly finding: Finding | undefined;
  readonly search: string | undefined;
  readonly shown: number;
  readonly showAll: boolean;
  readonly totalLines: number;
  readonly onShowAll: (showAll: boolean) => void;
  readonly onClear: () => void;
}) {
  const base = 'border-border flex min-h-12 items-center gap-3 border-b px-4 py-2 text-sm';
  if (search !== undefined) {
    return (
      <div className={base} role="status">
        <span className="text-muted-foreground">
          {shown === 1 ? '1 match' : `${shown} matches`} for “{search}”
        </span>
      </div>
    );
  }
  if (finding) {
    return (
      <div className={base} role="status">
        <p className="min-w-0 flex-1">
          <span className="font-medium">{finding.label}</span>
          <span className="text-muted-foreground"> · {finding.fix}</span>
        </p>
        <Button variant="ghost" size="icon-xs" aria-label="Back to the overview" onClick={onClear}>
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className={base}>
      <div className="bg-muted inline-flex rounded-md p-0.5" role="group" aria-label="Lines shown">
        {[
          { all: false, label: 'Needs attention' },
          { all: true, label: `All ${totalLines} lines` },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={showAll === option.all}
            onClick={() => onShowAll(option.all)}
            className={cn(
              'rounded px-2.5 py-1 text-xs',
              showAll === option.all
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Details({
  entry,
  check,
  onClose,
  onJump,
}: {
  readonly entry: FileLine;
  readonly check: Check;
  readonly onClose: () => void;
  readonly onJump: (row: number) => void;
}) {
  const heading =
    entry.kind === 'record'
      ? `Row ${entry.row.row} · line ${entry.row.record.line}`
      : `Line ${entry.line}`;
  // Below `xl` the panel slides over the bottom of the page instead of taking a column.
  return (
    <aside
      className="border-border bg-card max-xl:shadow-panel min-h-0 overflow-y-auto border-t p-4 max-xl:fixed max-xl:inset-x-0 max-xl:bottom-0 max-xl:z-40 max-xl:max-h-[50vh] xl:border-t-0 xl:border-l"
      aria-label="Line details"
    >
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{heading}</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label="Close line details"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="mt-3 grid gap-4 text-sm">
        <DetailsBody entry={entry} check={check} onJump={onJump} />
      </div>
    </aside>
  );
}

function DetailsBody({
  entry,
  check,
  onJump,
}: {
  readonly entry: FileLine;
  readonly check: Check;
  readonly onJump: (row: number) => void;
}) {
  if (entry.kind === 'blank') {
    return <p className="text-muted-foreground">A blank line. Zesty skips it without a message.</p>;
  }
  if (entry.kind === 'unread') {
    return (
      <p className="text-destructive">
        {entry.problem ? describeFileProblem(entry.problem) : 'This line could not be read.'}
      </p>
    );
  }
  const { row } = entry;
  const notes: string[] = [];
  if (row.record.lineSpan > 1) {
    notes.push(`Spans ${row.record.lineSpan} lines because a cell contains a line break.`);
  }
  if (row.pathPart !== undefined) notes.push(`Becomes the URL /${row.pathPart}.`);
  return (
    <>
      {entry.problem ? (
        <p className="text-destructive">{describeFileProblem(entry.problem)}</p>
      ) : null}
      {check.fileRejected && !entry.problem ? (
        <p className="text-muted-foreground">
          Zesty rejects the whole file, so this entry isn’t imported either.
        </p>
      ) : null}
      {row.issues.length === 0 && !check.fileRejected ? (
        <p className="text-emerald-400">Zesty should import this entry.</p>
      ) : (
        row.issues.map((issue) => {
          const related =
            issue.relatedRow === undefined ? undefined : check.rows[issue.relatedRow - 1];
          const possible = issue.certainty === 'possible';
          return (
            <div key={`${issue.code}-${issue.column}`} className="grid gap-1.5">
              <p className="flex items-center gap-2 font-medium">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    possible ? dot['at-risk'] : dot.rejected,
                  )}
                  aria-hidden="true"
                />
                {possible ? 'May fail' : 'Won’t import'}
              </p>
              <p>{issue.message}</p>
              <p className="text-muted-foreground">{issueCopy[issue.code].fix}</p>
              {related ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => onJump(related.row)}
                >
                  <ArrowUpRight size={13} /> Go to row {related.row}
                </Button>
              ) : null}
            </div>
          );
        })
      )}
      {notes.map((note) => (
        <p key={note} className="text-muted-foreground text-xs">
          {note}
        </p>
      ))}
    </>
  );
}

function download(file: CsvExport) {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${file.fileName}`, {
    description: file.rows === 1 ? '1 row' : `${file.rows} rows`,
  });
}

function MoreMenu({
  check,
  groups,
  collectionLabel,
}: {
  readonly check: Check;
  readonly groups: readonly FindingGroup[];
  readonly collectionLabel: string;
}) {
  const { funnel } = check;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="More actions" />}
      >
        <MoreHorizontal size={17} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={check.fileRejected || funnel.rejected + funnel.atRisk === 0}
          onClick={() => download(problemRowsCsv(check))}
        >
          Download rows with problems
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={check.fileRejected}
          onClick={() => download(importableRowsCsv(check))}
        >
          Download importable rows
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void copyText(markdownReport(check, groups, collectionLabel), 'Report copied')
          }
        >
          Copy report
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
