import { Check, Clock3, Copy, ExternalLink, History, LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { ContentItem, ContentItemReference, ExplorerError } from '../../domain';
import type { ItemVersionApi } from '../../zesty-api';
import { itemDisplayLabel, managerItemUrl } from '../content-item-presentation';
import { copyText } from '../copy-text';
import { describeExplorerError } from '../error-message';
import { useItemVersionPreview } from '../hooks/useItemVersionPreview';
import {
  compareContentItems,
  describeComparison,
  resolveVersionPair,
  type VersionNumberPair,
  type VersionPair,
} from '../item-version-comparison';
import { matchesVersionPreviewOption, type VersionPreviewOption } from '../item-version-preview';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { FieldsComparison, RawJsonComparison } from './ItemVersionComparison';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { buttonVariants } from './ui/button-variants';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

interface ItemDetailsProps {
  readonly api: ItemVersionApi;
  readonly reference: ContentItemReference | undefined;
  readonly sessionToken: string;
  readonly credentialRevision: string;
  readonly item: ContentItem | undefined;
  readonly onClose: () => void;
  readonly onAuthenticationFailure: () => void;
  readonly finalFocus: RefObject<HTMLElement | null>;
}

function formatted(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '';
}

function formattedDate(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Save time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function savedDescription(value: string | undefined): string {
  const date = formattedDate(value);
  return value && Number.isFinite(Date.parse(value)) ? `Saved ${date}` : date;
}

function isDetailFormat(value: unknown): value is 'fields' | 'raw' {
  return value === 'fields' || value === 'raw';
}

type HistoryMode = 'view' | 'compare';

function authorLabel(option: VersionPreviewOption): string {
  if (option.author) return option.author;
  return option.authorState === 'loading' ? 'Loading author…' : 'Author unavailable';
}

function CopyValue({ value, name }: { readonly value: unknown; readonly name: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="absolute top-2.5 right-2.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
      aria-label={`Copy ${name}`}
      onClick={() => void copyText(formatted(value), `${name} copied`)}
    >
      <Copy size={13} />
    </Button>
  );
}

function VersionBadges({ option }: { readonly option: VersionPreviewOption }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {option.latestSaved ? (
        <Badge className="border-sky-500/40 bg-sky-500/10 text-sky-300">Latest saved</Badge>
      ) : null}
      {option.currentlyPublished ? (
        <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
          Currently published
        </Badge>
      ) : null}
      {option.scheduledAt ? (
        <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">Scheduled</Badge>
      ) : null}
      {option.currentInView ? <Badge variant="outline">Current in view</Badge> : null}
    </div>
  );
}

function VersionCard({
  option,
  selected,
  onSelect,
}: {
  readonly option: VersionPreviewOption;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`relative w-full rounded-lg border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50 ${
        selected
          ? 'border-primary/70 bg-primary/10'
          : 'border-transparent hover:border-border hover:bg-accent/40'
      }`}
      onClick={onSelect}
    >
      <span className="flex items-center justify-between gap-3">
        <strong className="text-sm">Version {option.number}</strong>
        {selected ? <Check className="text-primary" size={16} aria-hidden="true" /> : null}
      </span>
      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
        {formattedDate(option.savedAt)} · {authorLabel(option)}
      </span>
      <span className="mt-2 block">
        <VersionBadges option={option} />
      </span>
      {option.scheduledAt ? (
        <span className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-amber-300">
          <Clock3 className="mt-0.5 shrink-0" size={12} aria-hidden="true" />
          Publishes {formattedDate(option.scheduledAt)}
          {option.additionalSchedules > 0 ? ` · +${option.additionalSchedules} more` : ''}
        </span>
      ) : null}
    </button>
  );
}

function ResourceNotice({
  label,
  error,
  retry,
}: {
  readonly label: string;
  readonly error: ExplorerError;
  readonly retry: () => Promise<void>;
}) {
  const description = describeExplorerError(error, window.location.origin);
  return (
    <div
      className="rounded-md border border-destructive/35 bg-destructive/10 p-2 text-xs"
      role="alert"
    >
      <p>{label}</p>
      <p className="mt-1 text-muted-foreground">{description.recovery}</p>
      <ErrorTechnicalDetails error={error} />
      <Button className="mt-2 h-7" size="sm" variant="outline" onClick={() => void retry()}>
        Retry
      </Button>
    </div>
  );
}

function versionLabel(option: VersionPreviewOption): string {
  return `Version ${option.number}${option.latestSaved ? ' · latest saved' : ''}${option.currentlyPublished ? ' · published' : ''}`;
}

function VersionSelect({
  label,
  options,
  selected,
  isDisabled,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly VersionPreviewOption[];
  readonly selected: VersionPreviewOption;
  readonly isDisabled: (number: number) => boolean;
  readonly onChange: (number: number) => void;
}) {
  return (
    <Field className="gap-1.5">
      <FieldLabel className="text-muted-foreground">{label}</FieldLabel>
      <Select
        items={options.map((option) => ({ label: versionLabel(option), value: option.number }))}
        value={selected.number}
        onValueChange={(number) => {
          if (number !== null) onChange(number);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem
              key={option.number}
              value={option.number}
              label={`Version ${option.number}`}
              disabled={isDisabled(option.number)}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">Version {option.number}</span>
                <VersionBadges option={option} />
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {formattedDate(option.savedAt)} · {authorLabel(option)}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription className="px-1 text-[11px] leading-4">
        {formattedDate(selected.savedAt)} · {authorLabel(selected)}
      </FieldDescription>
    </Field>
  );
}

// Before must stay older than After, so each select disables versions that would invert them.
function VersionPairSelect({
  options,
  pair,
  onChange,
}: {
  readonly options: readonly VersionPreviewOption[];
  readonly pair: VersionPair;
  readonly onChange: (pair: VersionNumberPair) => void;
}) {
  return (
    <div className="space-y-4">
      <VersionSelect
        label="Before"
        options={options}
        selected={pair.before}
        isDisabled={(number) => number >= pair.after.number}
        onChange={(before) => onChange({ before, after: pair.after.number })}
      />
      <VersionSelect
        label="After"
        options={options}
        selected={pair.after}
        isDisabled={(number) => number <= pair.before.number}
        onChange={(after) => onChange({ before: pair.before.number, after })}
      />
    </div>
  );
}

const HISTORY_MODES: readonly { readonly value: HistoryMode; readonly label: string }[] = [
  { value: 'view', label: 'View' },
  { value: 'compare', label: 'Compare' },
];

function ModeToggle({
  mode,
  onChange,
}: {
  readonly mode: HistoryMode;
  readonly onChange: (mode: HistoryMode) => void;
}) {
  return (
    <ToggleGroup
      className="h-9 rounded-lg p-1"
      aria-label="Item history mode"
      value={[mode]}
      onValueChange={([next]) => {
        if (next) onChange(next);
      }}
    >
      {HISTORY_MODES.map(({ value, label }) => (
        <ToggleGroupItem key={value} value={value} className="px-3">
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function ValuesList({ values }: { readonly values: Readonly<Record<string, unknown>> }) {
  return (
    <dl className="m-0 divide-y divide-border border-y border-border">
      {Object.entries(values).map(([name, value]) => (
        <div className="group relative grid grid-cols-[150px_1fr] gap-4 px-3 py-3 pr-10" key={name}>
          <dt className="text-xs text-muted-foreground">{name}</dt>
          <dd className="m-0 min-w-0 text-xs leading-5 text-foreground [overflow-wrap:anywhere]">
            {formatted(value)}
          </dd>
          <CopyValue name={name} value={value} />
        </div>
      ))}
    </dl>
  );
}

function ItemDetailsPanel({
  api,
  reference,
  sessionToken,
  credentialRevision,
  item,
  onClose,
  onAuthenticationFailure,
  finalFocus,
}: Omit<ItemDetailsProps, 'item' | 'reference'> & {
  readonly item: ContentItem;
  readonly reference: ContentItemReference;
}) {
  const [format, setFormat] = useState<'fields' | 'raw'>('fields');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<HistoryMode>('view');
  const [chosenPair, setChosenPair] = useState<VersionNumberPair>();
  const preview = useItemVersionPreview({
    api,
    reference,
    currentItem: item,
    sessionToken,
    credentialRevision,
  });
  const authenticationFailed = [preview.history, preview.publishings, preview.authors].some(
    (resource) => resource.error?.kind === 'authentication',
  );
  useEffect(() => {
    if (authenticationFailed) onAuthenticationFailure();
  }, [authenticationFailed, onAuthenticationFailure]);
  const visibleOptions = useMemo(
    () =>
      preview.history.isLoading
        ? []
        : preview.options.filter((option) => matchesVersionPreviewOption(option, search)),
    [preview.history.isLoading, preview.options, search],
  );
  const selected = preview.selectedOption;
  const historyLoaded = !preview.history.isLoading && !preview.history.error;
  const pair =
    mode === 'compare' && historyLoaded
      ? resolveVersionPair(preview.options, selected?.number, chosenPair)
      : undefined;
  const comparison = pair ? compareContentItems(pair.before.item, pair.after.item) : undefined;
  const comparisonUnavailable = preview.history.isLoading
    ? 'Loading saved versions…'
    : preview.history.error
      ? 'Saved versions could not load.'
      : 'This item has only one saved version.';
  const managerUrl = managerItemUrl(reference, item.id);
  function selectMode(next: HistoryMode) {
    setMode(next);
    setChosenPair(undefined);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid h-[min(820px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] grid-rows-[65px_minmax(0,1fr)] gap-0 overflow-hidden p-0"
        aria-labelledby="details-title"
        finalFocus={finalFocus}
        showCloseButton={false}
      >
        <DialogHeader className="flex grid-cols-none flex-row items-center justify-between border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 text-[10px] font-bold tracking-[.12em] text-primary uppercase">
              Item history
            </span>
            <span className="h-4 w-px bg-border" aria-hidden="true" />
            <DialogTitle id="details-title" className="truncate text-base">
              {itemDisplayLabel(item)}
            </DialogTitle>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.id}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {managerUrl ? (
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={managerUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Open in Zesty Manager
              </a>
            ) : null}
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="Close item history"
            >
              <X size={18} />
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[285px_minmax(0,1fr)]">
          <aside
            className="flex min-h-0 flex-col border-r border-border bg-background/70"
            aria-label="Saved versions"
            role="region"
          >
            <div className="border-b border-border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-bold tracking-wide uppercase">
                  <History className="text-primary" size={14} aria-hidden="true" /> Saved versions
                </span>
                <span className="text-xs text-muted-foreground">
                  {preview.history.isLoading ? '…' : preview.options.length} total
                </span>
              </div>
              {mode === 'view' ? (
                <label className="relative block">
                  <Search
                    className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                    size={14}
                    aria-hidden="true"
                  />
                  <Input
                    className="pl-9 text-xs"
                    type="search"
                    aria-label="Search saved versions"
                    placeholder="Search version, author, or status"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {preview.history.isLoading ? (
                <p
                  className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
                  role="status"
                >
                  <LoaderCircle className="animate-spin" size={14} aria-hidden="true" /> Loading
                  saved versions…
                </p>
              ) : null}
              {preview.history.error ? (
                <ResourceNotice
                  label="Saved versions could not load."
                  error={preview.history.error}
                  retry={preview.history.retry}
                />
              ) : null}
              {preview.publishings.error ? (
                <ResourceNotice
                  label="Publishing statuses could not load."
                  error={preview.publishings.error}
                  retry={preview.publishings.retry}
                />
              ) : null}
              {preview.authors.error ? (
                <ResourceNotice
                  label="Authors could not load."
                  error={preview.authors.error}
                  retry={preview.authors.retry}
                />
              ) : null}
              {mode === 'compare' ? (
                pair ? (
                  <VersionPairSelect
                    options={preview.options}
                    pair={pair}
                    onChange={setChosenPair}
                  />
                ) : historyLoaded ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    {comparisonUnavailable}
                  </p>
                ) : null
              ) : (
                <>
                  {visibleOptions.map((option) => (
                    <VersionCard
                      key={option.number}
                      option={option}
                      selected={selected?.number === option.number}
                      onSelect={() => preview.selectVersion(option.number)}
                    />
                  ))}
                  {!preview.history.isLoading && visibleOptions.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      No saved versions match this search.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </aside>

          <section
            className="min-h-0 overflow-y-auto p-5 md:p-6"
            aria-label={mode === 'compare' ? 'Version comparison' : 'Version preview'}
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              {mode === 'compare' ? (
                <div>
                  <h2 className="text-2xl font-bold">
                    {pair
                      ? `Version ${pair.before.number} → ${pair.after.number}`
                      : 'Compare versions'}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {comparison ? describeComparison(comparison) : comparisonUnavailable}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-2xl font-bold">Version {selected?.number ?? '—'}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {savedDescription(selected?.savedAt)} ·{' '}
                      {selected ? authorLabel(selected) : 'Author unavailable'}
                    </p>
                  </div>
                  {selected ? <VersionBadges option={selected} /> : null}
                </>
              )}
            </div>

            <Tabs
              value={format}
              onValueChange={(value) => {
                if (!isDetailFormat(value)) return;
                setFormat(value);
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList aria-label="Item detail format">
                  <TabsTrigger value="fields">Fields</TabsTrigger>
                  <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                </TabsList>
                <ModeToggle mode={mode} onChange={selectMode} />
              </div>
              <TabsContent value="raw">
                {mode === 'view' ? (
                  <pre className="overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6 whitespace-pre-wrap text-code-content">
                    {JSON.stringify(preview.selectedItem.raw, null, 2)}
                  </pre>
                ) : pair ? (
                  <RawJsonComparison
                    key={`${pair.before.number}-${pair.after.number}`}
                    pair={pair}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="fields">
                {mode === 'view' ? (
                  <>
                    <h3 className="mt-3 mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      Content fields
                    </h3>
                    <ValuesList values={preview.selectedItem.fields} />
                    <h3 className="mt-6 mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      Technical metadata
                    </h3>
                    <ValuesList values={preview.selectedItem.metadata} />
                  </>
                ) : pair && comparison ? (
                  <FieldsComparison
                    key={`${pair.before.number}-${pair.after.number}`}
                    comparison={comparison}
                    pair={pair}
                  />
                ) : null}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ItemDetails(props: ItemDetailsProps) {
  if (!props.item || !props.reference) return null;
  return <ItemDetailsPanel {...props} item={props.item} reference={props.reference} />;
}
