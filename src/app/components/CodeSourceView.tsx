// Annotated source with a "What this code uses" card and a "How it works" card.
// Hovering an entry or step highlights its source lines; clicking pins it and scrolls to it.
import {
  Braces,
  CircleHelp,
  Database,
  ExternalLink,
  Globe,
  Info,
  ListOrdered,
  MessageSquareText,
  Puzzle,
  Repeat,
  Split,
  Variable,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CodeFileZuid, ModelZuid } from '../../domain';
import {
  matchingLines,
  refCollection,
  type CodeAnalysis,
  type CollectionAccess,
  type DisplayLine,
  type DisplayToken,
  type SnippetUsage,
  type Step,
} from '../../parsley';
import {
  neutralTone,
  tokenClasses,
  type CollectionTone,
  type ToneLookup,
} from '../code-presentation';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { TooltipTrigger } from './ui/tooltip';

export type SourcePresentation = 'formatted' | 'saved';

interface CodeSourceViewProps {
  readonly analysis: CodeAnalysis;
  readonly saved: readonly DisplayLine[];
  readonly formatted: readonly DisplayLine[];
  readonly presentation: SourcePresentation;
  readonly onPresentationChange: (presentation: SourcePresentation) => void;
  /** Pinned when the view opens, e.g. the include a user returns to. */
  readonly initialPinned?: string;
  readonly fieldsLoading: boolean;
  /** Collection colors, shared by every file of the instance. */
  readonly toneFor: ToneLookup;
  readonly onOpenSnippet: (fileId: CodeFileZuid, callSite: string) => void;
  readonly onOpenCollection: (modelZuid: ModelZuid) => void;
}

const accessLabels: Readonly<Record<CollectionAccess, string>> = {
  loop: 'loop',
  relationship: 'via relationship',
  bound: 'this item',
  reference: 'referenced',
};

function toneForTarget(
  target: string | undefined,
  steps: readonly Step[],
  toneFor: ToneLookup,
): CollectionTone {
  const collection =
    refCollection(target) ?? steps.find((step) => step.target === target)?.collection;
  return collection ? toneFor(collection) : neutralTone;
}

export function CodeSourceView({
  analysis,
  saved,
  formatted,
  presentation,
  onPresentationChange,
  initialPinned,
  fieldsLoading,
  toneFor,
  onOpenSnippet,
  onOpenCollection,
}: CodeSourceViewProps) {
  const [hovered, setHovered] = useState<string>();
  const [pinned, setPinned] = useState(initialPinned);
  const active = hovered ?? pinned;
  const lines = presentation === 'formatted' ? formatted : saved;
  const matches = useMemo(
    () => (active ? matchingLines(lines, active) : undefined),
    [active, lines],
  );
  const activeTone = toneForTarget(active, analysis.steps, toneFor);
  const codeRef = useRef<HTMLDivElement>(null);
  const { usage, steps } = analysis;
  const togglePin = (target: string) =>
    setPinned((current) => (current === target ? undefined : target));
  const entryProps = (target: string) => ({
    active: active === target,
    pinned: pinned === target,
    onEnter: () => setHovered(target),
    onLeave: () => setHovered(undefined),
    onSelect: () => togglePin(target),
  });

  // Pinning scrolls the first matching line into view, in either presentation.
  useEffect(() => {
    if (!pinned) return;
    const first = Math.min(...matchingLines(lines, pinned));
    const container = codeRef.current;
    const line = container?.querySelector<HTMLElement>(`[data-line="${first}"]`);
    if (!container || !line) return;
    const top = line.offsetTop;
    const visible =
      top >= container.scrollTop &&
      top + line.offsetHeight <= container.scrollTop + container.clientHeight;
    if (!visible)
      container.scrollTo?.({
        top: Math.max(0, top - container.clientHeight / 4),
        behavior: 'smooth',
      });
  }, [pinned, lines]);

  const unrecognizedCount = usage.unrecognized.length;
  const nothingUsed =
    usage.collections.length +
      usage.inputs.length +
      usage.variables.length +
      usage.snippets.length +
      usage.remote.length +
      unrecognizedCount ===
    0;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-4">
      <section
        className="border-border bg-surface-recessed flex min-h-0 flex-col overflow-hidden rounded-xl border"
        aria-label="Source"
      >
        <div className="border-border bg-surface-header flex items-center justify-between gap-3 border-b px-3 py-2">
          <ToggleGroup
            aria-label="Source presentation"
            value={[presentation]}
            onValueChange={([next]) => {
              if (next) onPresentationChange(next);
            }}
          >
            <ToggleGroupItem value="formatted">Formatted</ToggleGroupItem>
            <ToggleGroupItem value="saved">As saved</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-muted-foreground text-xs">
            {saved.length} {saved.length === 1 ? 'line' : 'lines'} saved → {formatted.length}{' '}
            formatted
          </span>
        </div>
        <div
          ref={codeRef}
          className="relative min-h-0 flex-1 overflow-auto py-2 font-mono text-[12.5px] leading-6 [tab-size:2]"
          data-testid="code-lines"
        >
          {lines.map((line, index) => {
            const matched = matches?.has(index);
            return (
              <div
                key={index}
                data-line={index}
                {...(matched ? { 'data-highlighted': '' } : {})}
                className={cn(
                  'flex transition-opacity',
                  matches && !matched && 'opacity-35',
                  matched && activeTone.row,
                )}
              >
                <span className="text-muted-foreground/60 w-12 shrink-0 pr-3 text-right select-none">
                  {index + 1}
                </span>
                <span
                  className={cn(
                    'min-w-0 pr-4',
                    presentation === 'saved' ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
                  )}
                >
                  <IndentGuides count={line.indent} />
                  <LineTokens
                    line={line}
                    saved={presentation === 'saved'}
                    toneFor={toneFor}
                    onSelect={togglePin}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1.25fr)] gap-4">
        <aside
          className="border-border bg-card flex min-h-0 flex-col gap-4 overflow-auto rounded-xl border p-4"
          aria-label="What this code uses"
        >
          <div>
            <h3 className="text-sm font-semibold">What this code uses</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Hover or click an entry to find it in the source.
            </p>
          </div>
          {nothingUsed ? (
            <p className="text-muted-foreground text-xs">
              Zesty Explorer found no collections, inputs, variables, snippets, or remote requests
              in this file.
            </p>
          ) : null}

          {usage.collections.length ? (
            <UsageSection
              icon={<Database size={14} />}
              title="Collections"
              count={usage.collections.length}
            >
              {usage.collections.map(({ collection, fields, access, ref }) => {
                const tone = toneFor(collection.modelZuid);
                return (
                  <UsageEntry
                    key={ref}
                    {...entryProps(ref)}
                    actions={
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground ml-4 inline-flex items-center gap-1 text-[11px] underline-offset-4 hover:underline"
                        onClick={() => onOpenCollection(collection.modelZuid)}
                      >
                        <ExternalLink size={11} aria-hidden="true" /> Open {collection.label} in
                        Explorer
                      </button>
                    }
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn('size-2 rounded-full', tone.dot)} aria-hidden="true" />
                      <strong className={tone.text}>{collection.label}</strong>
                      <code className="text-muted-foreground text-[11px]">{collection.name}</code>
                      <span className="ml-auto flex gap-1">
                        {access.map((kind) => (
                          <Badge key={kind} variant="outline">
                            {accessLabels[kind]}
                          </Badge>
                        ))}
                      </span>
                    </div>
                    {fields.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1 pl-4">
                        {fields.map((field) => (
                          <span
                            key={field.name}
                            className="border-border bg-background/60 text-muted-foreground rounded border px-1.5 py-0.5 text-[11px]"
                          >
                            {field.label}
                          </span>
                        ))}
                      </div>
                    ) : fieldsLoading ? (
                      <p className="text-muted-foreground mt-1 pl-4 text-[11px]">Loading fields…</p>
                    ) : null}
                  </UsageEntry>
                );
              })}
            </UsageSection>
          ) : null}

          <PlainEntries
            icon={<Braces size={14} />}
            title="Request parameters"
            entries={usage.inputs}
            className="text-orange-300"
            entryProps={entryProps}
          />
          <PlainEntries
            icon={<Variable size={14} />}
            title="Variables"
            entries={usage.variables}
            className="text-orange-200"
            entryProps={entryProps}
          />

          {usage.snippets.length ? (
            <UsageSection
              icon={<Puzzle size={14} />}
              title="Snippets"
              count={usage.snippets.length}
            >
              {usage.snippets.map((snippet) => (
                <UsageEntry
                  key={snippet.target}
                  {...entryProps(snippet.target)}
                  actions={
                    <OpenSnippetButton
                      snippet={snippet}
                      callSite={snippet.target}
                      onOpen={onOpenSnippet}
                    />
                  }
                >
                  <code className="text-teal-300">{snippet.label}</code>
                  {snippet.detail ? (
                    <span className="text-muted-foreground ml-2 text-[11px]">{snippet.detail}</span>
                  ) : null}
                </UsageEntry>
              ))}
            </UsageSection>
          ) : null}

          <PlainEntries
            icon={<Globe size={14} />}
            title="Remote requests"
            entries={usage.remote}
            className="break-all text-[11px] text-emerald-300/85"
            entryProps={entryProps}
          />

          {unrecognizedCount ? (
            <UsageSection
              icon={<CircleHelp size={14} />}
              title="Not recognized"
              count={unrecognizedCount}
            >
              <p className="text-muted-foreground px-2 text-[11px]">
                Zesty Explorer could not interpret these. That alone does not mean the code is
                wrong.
              </p>
              {usage.unrecognized.map((entry) => (
                <UsageEntry key={entry.target} {...entryProps(entry.target)}>
                  <code className="text-code-content break-all">{entry.label}</code>
                  {entry.detail ? (
                    <p className="text-muted-foreground mt-0.5 text-[11px]">{entry.detail}</p>
                  ) : null}
                </UsageEntry>
              ))}
            </UsageSection>
          ) : null}
        </aside>

        <section
          className="border-border bg-card flex min-h-0 flex-col gap-3 overflow-auto rounded-xl border p-4"
          aria-label="How it works"
        >
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <ListOrdered size={15} aria-hidden="true" /> How it works
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">
              What the code does, in order. Click a step to jump to it.
            </p>
          </div>
          {unrecognizedCount ? (
            <p
              className="border-border bg-muted/50 text-muted-foreground flex gap-2 rounded-md border px-2.5 py-2 text-xs"
              role="status"
            >
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Partly explained. {unrecognizedCount}{' '}
                {unrecognizedCount === 1 ? 'part is' : 'parts are'} not recognized; they are marked
                in the source and listed under Not recognized.
              </span>
            </p>
          ) : null}
          {steps.length ? (
            <ol className="grid gap-0.5">
              {steps.map((step) => (
                <li key={step.target} style={{ paddingLeft: `${step.depth * 14}px` }}>
                  <UsageEntry
                    {...entryProps(step.target)}
                    actions={
                      step.snippet ? (
                        <OpenSnippetButton
                          snippet={step.snippet}
                          callSite={step.target}
                          onOpen={onOpenSnippet}
                          className="ml-5"
                        />
                      ) : undefined
                    }
                  >
                    <StepContent step={step} toneFor={toneFor} />
                  </UsageEntry>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-xs">
              This file has no loops, conditions, assignments, or includes to explain.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export function IndentGuides({ count }: { readonly count: number }) {
  return Array.from({ length: count }, (_, guide) => (
    <span
      key={guide}
      className="border-divider-emphasis inline-block w-[2ch] border-l"
      aria-hidden="true"
    >
      {' '}
    </span>
  ));
}

// In `As saved`, leading whitespace stays as saved but draws a guide every two columns.
function SavedIndent({ text }: { readonly text: string }) {
  const units = text.match(/\t| {2}| /g) ?? [];
  return units.map((unit, index) => (
    <span key={index} className={cn(unit !== ' ' && 'border-divider-emphasis border-l')}>
      {unit}
    </span>
  ));
}

export function LineTokens({
  line,
  saved,
  toneFor,
  onSelect,
}: {
  readonly line: DisplayLine;
  readonly saved: boolean;
  readonly toneFor: ToneLookup;
  readonly onSelect: (target: string) => void;
}) {
  return line.tokens.map((token, index) => {
    if (saved && index === 0 && token.kind === 'text') {
      const indent = /^[ \t]+/.exec(token.text)?.[0];
      if (indent) {
        return (
          <span key={index}>
            <SavedIndent text={indent} />
            <TokenSpan
              token={{ ...token, text: token.text.slice(indent.length) }}
              toneFor={toneFor}
              onSelect={onSelect}
            />
          </span>
        );
      }
    }
    return <TokenSpan key={index} token={token} toneFor={toneFor} onSelect={onSelect} />;
  });
}

function TokenSpan({
  token,
  toneFor,
  onSelect,
}: {
  readonly token: DisplayToken;
  readonly toneFor: ToneLookup;
  readonly onSelect: (target: string) => void;
}) {
  const collection = refCollection(token.ref);
  const tone = collection ? toneFor(collection) : undefined;
  const className = cn(
    tokenClasses[token.kind],
    tone && token.kind === 'collection' && cn(tone.text, tone.chip),
    tone && (token.kind === 'alias' || token.kind === 'field') && tone.text,
  );
  if (!token.hint) return <span className={className}>{token.text}</span>;
  const ref = token.ref;
  return (
    <TooltipTrigger
      text={token.hint}
      render={<span />}
      className={cn(className, ref ? 'cursor-pointer hover:brightness-125' : 'cursor-help')}
      {...(ref ? { onClick: () => onSelect(ref) } : {})}
    >
      {token.text}
    </TooltipTrigger>
  );
}

function PlainEntries({
  icon,
  title,
  entries,
  className,
  entryProps,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly entries: readonly {
    readonly target: string;
    readonly label: string;
    readonly detail?: string;
  }[];
  readonly className: string;
  readonly entryProps: (target: string) => UsageEntryState;
}) {
  if (!entries.length) return null;
  return (
    <UsageSection icon={icon} title={title} count={entries.length}>
      {entries.map((entry) => (
        <UsageEntry key={entry.target} {...entryProps(entry.target)}>
          <code className={className}>{entry.label}</code>
          {entry.detail ? (
            <span className="text-muted-foreground ml-2 text-[11px]">{entry.detail}</span>
          ) : null}
        </UsageEntry>
      ))}
    </UsageSection>
  );
}

function OpenSnippetButton({
  snippet,
  callSite,
  onOpen,
  className,
}: {
  readonly snippet: SnippetUsage;
  readonly callSite: string;
  readonly onOpen: (fileId: CodeFileZuid, callSite: string) => void;
  readonly className?: string;
}) {
  const fileId = snippet.fileId;
  if (!fileId) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('h-6 px-2 text-[11px]', className)}
      onClick={() => onOpen(fileId, callSite)}
    >
      Open snippet
    </Button>
  );
}

function StepContent({ step, toneFor }: { readonly step: Step; readonly toneFor: ToneLookup }) {
  const tone = step.collection ? toneFor(step.collection) : undefined;
  const icons: Readonly<Record<Step['kind'], ReactNode>> = {
    loop: <Repeat size={12} className={cn('mt-0.5 shrink-0', tone?.text ?? 'text-orange-300')} />,
    condition: <Split size={12} className="mt-0.5 shrink-0 text-fuchsia-300" />,
    branch: <Split size={12} className="mt-0.5 shrink-0 text-fuchsia-300" />,
    assignment: <Variable size={12} className="mt-0.5 shrink-0 text-orange-200" />,
    include: <Puzzle size={12} className="mt-0.5 shrink-0 text-teal-300" />,
    note: <MessageSquareText size={12} className="text-muted-foreground mt-0.5 shrink-0" />,
    unrecognized: <CircleHelp size={12} className="text-muted-foreground mt-0.5 shrink-0" />,
  };
  return (
    <div className="flex gap-1.5">
      <span aria-hidden="true">{icons[step.kind]}</span>
      <div className="grid min-w-0 gap-0.5">
        <p className={cn(step.kind === 'note' ? 'text-muted-foreground italic' : 'font-semibold')}>
          {step.number ? (
            <span className="text-muted-foreground mr-1.5 font-mono text-[10px] font-normal">
              {step.number}
            </span>
          ) : null}
          <span className={step.kind === 'loop' ? tone?.text : undefined}>{step.title}</span>
        </p>
        {step.details.map((detail, index) => (
          <p key={index} className="text-muted-foreground break-words">
            {detail}
          </p>
        ))}
      </div>
    </div>
  );
}

interface UsageEntryState {
  readonly active: boolean;
  readonly pinned: boolean;
  readonly onEnter: () => void;
  readonly onLeave: () => void;
  readonly onSelect: () => void;
}

function UsageSection({
  icon,
  title,
  count,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-1" aria-label={title}>
      <h4 className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
        {icon}
        {title}
        <span className="text-muted-foreground/70">{count}</span>
      </h4>
      {children}
    </section>
  );
}

// Hovering an entry previews its lines; activating it pins them. Actions such as "Open snippet"
// sit beside the pressable area rather than inside it.
function UsageEntry({
  active,
  pinned,
  onEnter,
  onLeave,
  onSelect,
  actions,
  children,
}: UsageEntryState & { readonly actions?: ReactNode; readonly children: ReactNode }) {
  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        'hover:bg-surface-menu-hover rounded-md',
        active && 'bg-surface-menu-hover',
        pinned && 'ring-primary/50 ring-1',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={pinned}
        onFocus={onEnter}
        onBlur={onLeave}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
        className="focus-visible:ring-ring/40 cursor-pointer rounded-md px-2 py-1.5 text-xs outline-none focus-visible:ring-2"
      >
        {children}
      </div>
      {actions ? <div className="px-2 pb-1.5">{actions}</div> : null}
    </div>
  );
}
