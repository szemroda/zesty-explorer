import { Building2, Check, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  deploymentLabels,
  type Deployment,
  type InstanceListEntry,
  type InstanceReference,
} from '../../domain';
import { describeExplorerError } from '../error-message';
import type { InstanceListQueryResult } from '../hooks/useInstanceList';
import { cn } from '../lib/utils';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { looksLikeUrl } from '../pasted-url';
import { PastedUrlHelp, PastedUrlOption, PickerSearch } from './PickerSearch';
import { Button } from './ui/button';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

interface InstancePickerProps {
  readonly query: InstanceListQueryResult;
  readonly deployment: Deployment;
  /** The instance open now, shown first when the instance list does not include it. */
  readonly current: InstanceReference | undefined;
  readonly onChoose: (instance: InstanceReference) => void;
  /** Opens a pasted Zesty URL and returns what is wrong with it, if anything. */
  readonly onPasteUrl: (url: string) => string | undefined;
  readonly onDeploymentChange: (deployment: Deployment) => void;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

interface InstanceChoice extends InstanceListEntry {
  readonly unlisted?: true;
}

const deployments = Object.keys(deploymentLabels) as Deployment[];

function sameInstance(left: InstanceReference, right: InstanceReference): boolean {
  return left.instanceZuid === right.instanceZuid && left.deployment === right.deployment;
}

/**
 * The instances one session token can read in one deployment, searchable by name or ZUID. The
 * search also takes a pasted Zesty URL, which opens an instance the list does not show.
 */
export function InstancePicker({
  query,
  deployment,
  current,
  onChoose,
  onPasteUrl,
  onDeploymentChange,
  autoFocus = false,
  className,
}: InstancePickerProps) {
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [urlProblem, setUrlProblem] = useState<string>();
  const listed = useMemo(
    () =>
      (query.list?.instances ?? []).toSorted((left, right) => {
        const unnamed = Number(!left.name) - Number(!right.name);
        return (
          unnamed ||
          (left.name ?? '').localeCompare(right.name ?? '', undefined, { sensitivity: 'base' }) ||
          left.reference.instanceZuid.localeCompare(right.reference.instanceZuid)
        );
      }),
    [query.list],
  );
  const unlisted =
    current && !listed.some((entry) => sameInstance(entry.reference, current))
      ? { reference: current, unlisted: true as const }
      : undefined;
  const choices: readonly InstanceChoice[] = unlisted ? [unlisted, ...listed] : listed;
  const pastingUrl = looksLikeUrl(search);
  const needle = search.trim().toLocaleLowerCase();
  const visible = pastingUrl
    ? []
    : choices.filter((choice) =>
        `${choice.name ?? ''} ${choice.reference.instanceZuid}`
          .toLocaleLowerCase()
          .includes(needle),
      );
  const active = Math.min(Math.max(activeIndex, 0), Math.max(visible.length - 1, 0));
  const optionId = (index: number) => `${listId}-option-${index}`;
  const failure = query.error
    ? { ...describeExplorerError(query.error, window.location.origin), error: query.error }
    : undefined;
  const otherDeployments = deployments
    .filter((candidate) => candidate !== deployment)
    .map((candidate) => deploymentLabels[candidate])
    .join(' or ');

  useEffect(() => {
    // jsdom has no scrollIntoView.
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const openUrl = (url: string) => {
    const problem = onPasteUrl(url);
    setUrlProblem(problem);
    if (!problem) setSearch('');
  };
  const choose = (choice: InstanceChoice | undefined) => {
    if (choice) onChoose(choice.reference);
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="grid gap-3 px-4 pb-3">
        <PickerSearch
          label="Search instances by name or ZUID, or paste a Zesty URL"
          value={search}
          onChange={(next) => {
            setSearch(next);
            setActiveIndex(0);
            setUrlProblem(undefined);
          }}
          listId={listId}
          activeOptionId={pastingUrl || visible.length > 0 ? optionId(active) : undefined}
          onMove={(offset) =>
            setActiveIndex(Math.min(Math.max(active + offset, 0), visible.length - 1))
          }
          onEnter={() => (pastingUrl ? openUrl(search) : choose(visible[active]))}
          onPasteUrl={openUrl}
          problemId={pastingUrl && urlProblem ? `${listId}-problem` : undefined}
          autoFocus={autoFocus}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground text-xs" id={`${listId}-deployment`}>
            Deployment
          </span>
          <ToggleGroup
            aria-labelledby={`${listId}-deployment`}
            value={[deployment]}
            onValueChange={([next]) => {
              if (next && next !== deployment) onDeploymentChange(next);
            }}
          >
            {deployments.map((candidate) => (
              <ToggleGroupItem key={candidate} value={candidate}>
                {deploymentLabels[candidate]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <div ref={list} className="border-border min-h-0 flex-1 overflow-y-auto border-t p-2">
        <div id={listId} role="listbox" aria-label="Instances">
          {pastingUrl ? (
            <PastedUrlOption id={optionId(0)} url={search} onChoose={() => openUrl(search)} />
          ) : (
            visible.map((choice, index) => {
              const isCurrent = Boolean(current && sameInstance(choice.reference, current));
              return (
                <div
                  key={`${choice.reference.instanceZuid}:${choice.reference.deployment}`}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                    index === active ? 'bg-accent' : 'hover:bg-surface-menu-hover',
                  )}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => choose(choice)}
                >
                  <Building2
                    size={15}
                    className="text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {choice.name ?? choice.reference.instanceZuid}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {choice.unlisted && query.list
                        ? 'Not in your instance list'
                        : choice.reference.instanceZuid}
                    </span>
                  </span>
                  {isCurrent ? (
                    <span className="text-primary flex items-center gap-1 text-xs font-medium">
                      <Check size={13} aria-hidden="true" /> Open
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        {pastingUrl ? (
          <PastedUrlHelp
            problemId={`${listId}-problem`}
            problem={urlProblem}
            description="A Zesty Manager or Instances API URL of an instance, collection, or item. Use it for an instance the list does not show."
          />
        ) : null}
        {!pastingUrl && query.isLoading ? (
          <p
            className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm"
            role="status"
            aria-label="Loading instance list"
          >
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
            Loading instances…
          </p>
        ) : null}
        {!pastingUrl && query.list && choices.length > 0 && visible.length === 0 ? (
          <p className="text-muted-foreground px-3 py-4 text-sm">
            No instance matches. Paste its Zesty URL to open it.
          </p>
        ) : null}
        {!pastingUrl && query.list && choices.length === 0 ? (
          <p className="text-muted-foreground px-3 py-4 text-sm" role="status">
            Zesty lists no {deploymentLabels[deployment]} instances for this session token. If you
            work in {otherDeployments}, choose it above. Or paste a Zesty URL.
          </p>
        ) : null}
      </div>
      {failure ? (
        <div
          className="border-destructive/40 bg-destructive/10 text-destructive m-2 grid gap-1 rounded-md border p-3 text-sm"
          role="alert"
        >
          <p>{failure.message}</p>
          <p>{failure.recovery}</p>
          <p>Paste a Zesty URL above to open an instance directly.</p>
          <ErrorTechnicalDetails error={failure.error} />
          <div>
            <Button type="button" variant="outline" onClick={() => void query.refresh()}>
              Retry instance list
            </Button>
          </div>
        </div>
      ) : query.list?.warning || query.list?.truncated ? (
        <div
          className="m-2 grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          role="status"
        >
          {query.list.warning ? <p>{query.list.warning.message}</p> : null}
          {query.list.truncated ? (
            <p>
              Zesty returned {query.list.truncated.returned} of {query.list.truncated.total}{' '}
              instances.
            </p>
          ) : null}
          <p>Paste a Zesty URL above to open one that is missing.</p>
          {query.list.warning ? <ErrorTechnicalDetails error={query.list.warning} /> : null}
        </div>
      ) : null}
    </div>
  );
}
