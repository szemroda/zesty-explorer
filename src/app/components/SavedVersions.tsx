// The saved versions list and version pickers shared by item history and code history.
import { Check, Clock3, History, LoaderCircle, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExplorerError } from '../../domain';
import { describeExplorerError } from '../error-message';
import type { VersionNumberPair, VersionPair } from '../item-version-comparison';
import { authorLabel, formattedDate, type SavedVersionOption } from '../item-version-preview';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

export type HistoryMode = 'view' | 'compare';

export function VersionBadges({ option }: { readonly option: SavedVersionOption }) {
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

export function VersionCard({
  option,
  selected,
  onSelect,
}: {
  readonly option: SavedVersionOption;
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
          {option.additionalSchedules ? ` · +${option.additionalSchedules} more` : ''}
        </span>
      ) : null}
    </button>
  );
}

/** A failed history source with its recovery advice and a retry. `recovery` replaces the advice. */
export function ResourceNotice({
  label,
  recovery,
  error,
  retry,
}: {
  readonly label: string;
  readonly recovery?: string;
  readonly error: ExplorerError;
  readonly retry: () => Promise<void>;
}) {
  const advice = recovery ?? describeExplorerError(error, window.location.origin).recovery;
  return (
    <div
      className="rounded-md border border-destructive/35 bg-destructive/10 p-2 text-xs"
      role="alert"
    >
      <p>{label}</p>
      <p className="mt-1 text-muted-foreground">{advice}</p>
      <ErrorTechnicalDetails error={error} />
      <Button className="mt-2 h-7" size="sm" variant="outline" onClick={() => void retry()}>
        Retry
      </Button>
    </div>
  );
}

function versionLabel(option: SavedVersionOption): string {
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
  readonly options: readonly SavedVersionOption[];
  readonly selected: SavedVersionOption;
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
export function VersionPairSelect<Option extends SavedVersionOption>({
  options,
  pair,
  onChange,
}: {
  readonly options: readonly Option[];
  readonly pair: VersionPair<Option>;
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

export function ModeToggle({
  label,
  mode,
  onChange,
}: {
  readonly label: string;
  readonly mode: HistoryMode;
  readonly onChange: (mode: HistoryMode) => void;
}) {
  return (
    <ToggleGroup
      className="h-9 rounded-lg p-1"
      aria-label={label}
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

/** The saved versions column of a history dialog: its count, search, and list. */
export function SavedVersionsSidebar({
  isLoading,
  total,
  search,
  onSearchChange,
  children,
}: {
  readonly isLoading: boolean;
  readonly total: number;
  /** Undefined hides the search, e.g. while the column holds the compared versions. */
  readonly search: string | undefined;
  readonly onSearchChange: (search: string) => void;
  readonly children: ReactNode;
}) {
  return (
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
          <span className="text-xs text-muted-foreground">{isLoading ? '…' : total} total</span>
        </div>
        {search === undefined ? null : (
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
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </label>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <p
            className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="animate-spin" size={14} aria-hidden="true" /> Loading saved
            versions…
          </p>
        ) : null}
        {children}
      </div>
    </aside>
  );
}
