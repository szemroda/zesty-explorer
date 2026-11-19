import { useQuery } from '@tanstack/react-query';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  CollectionCatalogEntry,
  CollectionCatalogGroup,
  CollectionField,
  ExplorerError,
  ModelZuid,
} from '../../domain';
import { relationshipSchemaQuery, type SchemaLoader } from '../hooks/useSchemaIndex';
import { cn } from '../lib/utils';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { looksLikeUrl } from '../pasted-url';
import { PastedUrlHelp, PastedUrlOption, PickerSearch } from './PickerSearch';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

interface RootPickerProps {
  /** The heading's id, so a dialog around the picker can name itself after it. */
  readonly titleId: string;
  readonly instanceName: string;
  /** The catalog, plus an uncatalogued collection a pasted URL or shared link named. */
  readonly collections: readonly CollectionCatalogEntry[];
  readonly loading: boolean;
  readonly error: ExplorerError | undefined;
  readonly warning: ExplorerError | undefined;
  readonly onRetry: () => void;
  /** The collection chosen so far, e.g. the open root or the one a pasted URL named. */
  readonly selected: ModelZuid | undefined;
  readonly onSelect: (modelZuid: ModelZuid) => void;
  /** The open view's root, and every collection its tree uses. */
  readonly openRoot: ModelZuid | undefined;
  readonly inView: ReadonlySet<ModelZuid>;
  /** Opening the open root keeps its tree, so there is nothing to add related collections to. */
  readonly rootHasChildren: boolean;
  readonly addRelated: boolean;
  readonly onAddRelatedChange: (addRelated: boolean) => void;
  readonly onOpen: (modelZuid: ModelZuid) => void;
  /** Opens a pasted Zesty URL and returns what is wrong with it, if anything. */
  readonly onPasteUrl: (url: string) => string | undefined;
  readonly onSwitchInstance: () => void;
  /** Present when a view is open behind the picker, to go back to it. */
  readonly onCancel?: () => void;
  readonly loadSchema: SchemaLoader;
}

const groupOrder: readonly CollectionCatalogGroup[] = ['content', 'blocks', 'other'];
const groupLabels: Readonly<Record<CollectionCatalogGroup, string>> = {
  content: 'Content',
  blocks: 'Blocks',
  other: 'Other',
};

/** Zesty Manager's names for model types, so the picker speaks the language users know. */
const modelTypes: Readonly<Record<string, { readonly name: string; readonly hint: string }>> = {
  pageset: { name: 'Multi page model', hint: 'Each item is a page with its own URL.' },
  templateset: { name: 'Single page model', hint: 'One item with one page.' },
  dataset: { name: 'Headless dataset', hint: 'Items without pages, used by other content.' },
  block: { name: 'Block', hint: 'Reusable content placed on pages.' },
  blocks: { name: 'Block', hint: 'Reusable content placed on pages.' },
  uncatalogued: {
    name: 'Uncatalogued collection',
    hint: 'Your session cannot see it in the collection catalog. It can still open.',
  },
};

/** Zesty Manager's names for field types. Other datatypes show as Zesty returns them. */
const fieldTypes: Readonly<Record<string, string>> = {
  text: 'Text',
  textarea: 'Textarea',
  wysiwyg_basic: 'WYSIWYG',
  wysiwyg_advanced: 'WYSIWYG',
  article_writer: 'Article writer',
  markdown: 'Markdown',
  images: 'Media',
  files: 'Files',
  date: 'Date',
  datetime: 'Date and time',
  number: 'Number',
  currency: 'Currency',
  yes_no: 'Yes/No',
  dropdown: 'Dropdown',
  color: 'Color',
  link: 'Link',
  internal_link: 'Internal link',
  uuid: 'UUID',
  sort: 'Sort',
};

function bySection(collections: readonly CollectionCatalogEntry[]) {
  return collections.toSorted(
    (left, right) =>
      groupOrder.indexOf(left.group) - groupOrder.indexOf(right.group) ||
      left.label.localeCompare(right.label),
  );
}

/**
 * The value after it has stayed the same for `delayMs`, so arrowing through loads one schema.
 * The first defined value shows at once.
 */
function useSettled<Value>(value: Value, delayMs: number): Value {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled ?? value;
}

/**
 * Chooses the root collection of a view. It lists the whole collection catalog by section and
 * previews the highlighted collection's fields, so users recognise models they know from Zesty
 * Manager before opening one. The search also takes a pasted Zesty URL.
 */
export function RootPicker({
  titleId,
  instanceName,
  collections,
  loading,
  error,
  warning,
  onRetry,
  selected,
  onSelect,
  openRoot,
  inView,
  rootHasChildren,
  addRelated,
  onAddRelatedChange,
  onOpen,
  onPasteUrl,
  onSwitchInstance,
  onCancel,
  loadSchema,
}: RootPickerProps) {
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [urlProblem, setUrlProblem] = useState<string>();
  const pastingUrl = looksLikeUrl(search);
  const needle = search.trim().toLocaleLowerCase();
  const visible = pastingUrl
    ? []
    : bySection(collections).filter((entry) =>
        [entry.label, entry.name, entry.type, entry.reference.modelZuid]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle),
      );
  // A search that hides the chosen collection moves the choice to the first match.
  const highlighted = visible.find((entry) => entry.reference.modelZuid === selected) ?? visible[0];
  const activeIndex = highlighted ? visible.indexOf(highlighted) : -1;
  const previewed = useSettled(highlighted, 150);
  const keepsTree = highlighted?.reference.modelZuid === openRoot && rootHasChildren;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    // jsdom has no scrollIntoView.
    list.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const openUrl = (url: string) => {
    const problem = onPasteUrl(url);
    setUrlProblem(problem);
    if (!problem) setSearch('');
  };
  const open = () => {
    if (pastingUrl) {
      openUrl(search);
      return;
    }
    if (highlighted) onOpen(highlighted.reference.modelZuid);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid gap-3 px-5 pt-4 pb-3">
        {/* Clear of a dialog's close button. */}
        <div className="pr-8">
          <h2 className="text-base font-semibold" id={titleId}>
            Open a collection
          </h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {loading
              ? `Loading the collections of ${instanceName}…`
              : error
                ? `The collections of ${instanceName} could not load.`
                : `${instanceName} has ${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}. The one you open fills the main table.`}{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-2 hover:no-underline"
              onClick={onSwitchInstance}
            >
              Switch instance
            </button>
          </p>
        </div>
        <PickerSearch
          label="Search collections by name or ZUID, or paste a Zesty URL"
          value={search}
          onChange={(next) => {
            setSearch(next);
            setUrlProblem(undefined);
          }}
          listId={listId}
          activeOptionId={
            pastingUrl ? optionId(0) : activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          onMove={(offset) => {
            const next = visible[activeIndex + offset];
            if (next) onSelect(next.reference.modelZuid);
          }}
          onEnter={open}
          onPasteUrl={openUrl}
          problemId={pastingUrl && urlProblem ? `${listId}-problem` : undefined}
          autoFocus
        />
        {warning ? (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            role="status"
          >
            <p>{warning.message}</p>
            <ErrorTechnicalDetails error={warning} />
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          'border-border grid min-h-0 flex-1 grid-cols-1 border-t',
          !pastingUrl && 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]',
        )}
      >
        <div ref={list} className="min-h-0 overflow-y-auto p-2">
          {!pastingUrl && error ? (
            <div
              className="border-destructive/40 bg-destructive/10 text-destructive m-1 grid gap-2 rounded-md border p-3 text-sm"
              role="alert"
            >
              <p>{error.message}</p>
              <ErrorTechnicalDetails error={error} />
              <div>
                <Button type="button" variant="outline" onClick={onRetry}>
                  Retry catalog
                </Button>
              </div>
            </div>
          ) : null}
          {!pastingUrl && loading ? (
            <p
              className="text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm"
              role="status"
              aria-label="Loading collection catalog"
            >
              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
              Loading collections…
            </p>
          ) : null}
          {!pastingUrl && !loading && !error && visible.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-sm" role="status">
              {collections.length === 0
                ? 'This session returned an empty collection catalog. Paste a collection URL to open one directly.'
                : 'No collection matches. Paste its Zesty URL to open it.'}
            </p>
          ) : null}
          <div id={listId} role="listbox" aria-labelledby={titleId}>
            {pastingUrl ? (
              <PastedUrlOption id={optionId(0)} url={search} onChoose={() => openUrl(search)} />
            ) : (
              groupOrder.map((group) => {
                const entries = visible.filter((entry) => entry.group === group);
                if (entries.length === 0) return null;
                const labelId = `${listId}-${group}`;
                return (
                  <div key={group} role="group" aria-labelledby={labelId}>
                    <p
                      id={labelId}
                      className={cn(
                        'text-muted-foreground px-3 pb-1 text-xs font-medium',
                        entries[0] === visible[0] ? 'pt-1' : 'pt-4',
                      )}
                    >
                      {groupLabels[group]}
                    </p>
                    {entries.map((entry) => {
                      const index = visible.indexOf(entry);
                      return (
                        <div
                          key={entry.reference.modelZuid}
                          id={optionId(index)}
                          data-index={index}
                          role="option"
                          aria-selected={entry === highlighted}
                          tabIndex={-1}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 text-sm',
                            entry === highlighted ? 'bg-accent' : 'hover:bg-surface-menu-hover',
                          )}
                          onClick={() => onSelect(entry.reference.modelZuid)}
                          onDoubleClick={() => onOpen(entry.reference.modelZuid)}
                        >
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate',
                                entry === highlighted && 'font-medium',
                              )}
                            >
                              {entry.label}
                            </span>
                            {/* Tells apart collections that share a label. */}
                            <span className="text-muted-foreground block truncate text-xs">
                              {entry.name} · {entry.reference.modelZuid}
                            </span>
                          </span>
                          {entry.reference.modelZuid === openRoot ? (
                            <span className="text-primary text-xs font-medium">Open now</span>
                          ) : inView.has(entry.reference.modelZuid) ? (
                            <span className="text-muted-foreground text-xs">In this view</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
          {pastingUrl ? (
            <PastedUrlHelp
              problemId={`${listId}-problem`}
              problem={urlProblem}
              description="A Zesty Manager or Instances API URL of a collection or item. An item URL also opens that item's details."
            />
          ) : null}
        </div>

        <div
          className="border-border bg-muted/30 min-h-0 overflow-y-auto border-t p-5 md:border-t-0 md:border-l"
          hidden={pastingUrl}
        >
          {previewed ? (
            <CollectionPreview
              key={previewed.reference.modelZuid}
              entry={previewed}
              collections={collections}
              loadSchema={loadSchema}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Choose a collection to see its fields.</p>
          )}
        </div>
      </div>

      <div className="border-border flex flex-wrap items-center gap-3 border-t px-5 py-3">
        <label
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-sm',
            keepsTree && 'cursor-default opacity-60',
          )}
        >
          <Checkbox
            className="mt-0.5"
            checked={addRelated && !keepsTree}
            disabled={keepsTree}
            onCheckedChange={onAddRelatedChange}
          />
          <span className="grid gap-0.5">
            <span className="font-medium">Add related collections</span>
            <span className="text-muted-foreground text-xs">
              {keepsTree
                ? 'This collection is open with its tree, which stays as it is.'
                : 'Builds the collection tree from Zesty relationships. You can remove or add collections afterwards.'}
            </span>
          </span>
        </label>
        <div className="flex gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button type="button" disabled={pastingUrl ? false : !highlighted} onClick={open}>
            {pastingUrl ? 'Open URL' : `Open ${highlighted?.label ?? 'collection'}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function fieldType(field: CollectionField, collections: readonly CollectionCatalogEntry[]): string {
  // Zesty spells some datatypes with hyphens and others with underscores.
  const datatype = (field.datatype ?? '').toLowerCase().replaceAll('-', '_');
  if (field.relatedModelZuid) {
    const related =
      collections.find((entry) => entry.reference.modelZuid === field.relatedModelZuid)?.label ??
      field.relatedModelZuid;
    return `${datatype === 'one_to_many' ? 'Links' : 'Link'} to ${related}`;
  }
  return fieldTypes[datatype] ?? field.datatype ?? field.kind;
}

function CollectionPreview({
  entry,
  collections,
  loadSchema,
}: {
  readonly entry: CollectionCatalogEntry;
  readonly collections: readonly CollectionCatalogEntry[];
  readonly loadSchema: SchemaLoader;
}) {
  const schema = useQuery(relationshipSchemaQuery(entry.reference, loadSchema, 'dialog'));
  const type = modelTypes[entry.type.trim().toLowerCase()];
  // Collections outside content and blocks have no Manager page.
  const managerUrl =
    entry.reference.area === 'other'
      ? undefined
      : `${entry.reference.managerBaseUrl}/${entry.reference.area}/${entry.reference.modelZuid}`;

  return (
    <section className="grid gap-4" aria-label={`${entry.label} fields`}>
      <div>
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{entry.label}</h3>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {type ? `${type.name}. ${type.hint}` : entry.type}
        </p>
        {managerUrl ? (
          <a
            href={managerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs underline underline-offset-2"
          >
            Open in Zesty Manager <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : null}
      </div>
      {schema.isPending ? (
        <div className="grid gap-2" role="status" aria-label="Loading fields">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="bg-muted h-5 animate-pulse rounded" />
          ))}
        </div>
      ) : schema.isError ? (
        <p className="text-destructive text-sm" role="alert">
          The fields could not load. {schema.error.message}
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="text-muted-foreground mb-1 text-left text-xs">
            {schema.data.fields.length} {schema.data.fields.length === 1 ? 'field' : 'fields'}
          </caption>
          <tbody>
            {schema.data.fields.map((field) => (
              <tr key={field.id} className="border-border border-t first:border-t-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  {field.label}
                </th>
                <td className="text-muted-foreground py-1.5 text-right">
                  {fieldType(field, collections)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
