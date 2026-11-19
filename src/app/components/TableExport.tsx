import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CollectionNode, ContentItem, ItemZuid } from '../../domain';
import { nodePath } from '../../explorer-core';
import type { ContentItemColumn } from '../content-item-presentation';
import { exportBaseName, exportFile, saveFile, type ExportFormat } from '../export-file';
import { loadedItemsById, loadedSnapshot } from '../load-view';
import { plural } from '../lib/utils';
import {
  exportableColumns,
  exportHeaders,
  exportTable,
  incompleteNodes,
  inTableOrder,
  rowsUnderEveryParent,
  type ExportRequest,
  type ExportView,
  type RelatedSummary,
} from '../table-export';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

interface ColumnsShown {
  /** Every column the table has, shown or not. */
  readonly columns: readonly ContentItemColumn[];
  /** The table's column visibility; a column missing from it is shown. */
  readonly columnVisibility: Readonly<Record<string, boolean>>;
  /** Columns the table pins ahead of the rest, in order. */
  readonly pinnedColumns: readonly string[];
}

interface RootTableExportProps extends ColumnsShown {
  readonly title: string;
  readonly view: ExportView;
  readonly node: CollectionNode;
  /** Root items that match the view's search and filters, in table order. */
  readonly filteredItems: readonly ContentItem[];
  /** Every root item, in table order. */
  readonly allItemIds: readonly ItemZuid[];
}

/** Exports the root table: one row per item, with child collections summed up in columns. */
export function RootTableExport(props: RootTableExportProps) {
  return (
    <ExportPopover label={`Export ${props.title}`}>
      <RootExportPanel {...props} />
    </ExportPopover>
  );
}

interface NestedTableExportProps extends ColumnsShown {
  readonly view: ExportView;
  readonly root: CollectionNode;
  readonly node: CollectionNode;
  readonly parentNode: CollectionNode;
  /** The item this table lists related items for; undefined if it is no longer loaded. */
  readonly parentItem: ContentItem | undefined;
  /** The items this table shows below its parent item. */
  readonly items: readonly ContentItem[];
  /** Root items that match the view's search and filters, in table order. */
  readonly rootItems: readonly ContentItem[];
}

/**
 * Exports a nested table, for its parent item or across every parent in the view. Each row starts
 * with its parent's ZUID and name, so files join on ZUIDs.
 */
export function NestedTableExport(props: NestedTableExportProps) {
  return (
    <ExportPopover label={`Export ${props.node.name}`}>
      <NestedExportPanel {...props} />
    </ExportPopover>
  );
}

function ExportPopover({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={label} />}>
        <Download size={14} aria-hidden="true" /> Export
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] overflow-hidden" aria-label={label}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function RootExportPanel({
  title,
  view,
  node,
  filteredItems,
  allItemIds,
  columns,
  columnVisibility,
  pinnedColumns,
}: RootTableExportProps) {
  const [rows, setRows] = useState<'filtered' | 'all'>('filtered');
  const [columnChoice, setColumnChoice] = useState<'visible' | 'all'>('visible');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [summaries, setSummaries] = useState<Readonly<Partial<Record<string, RelatedSummary>>>>({});
  const allColumns = inTableOrder(exportableColumns(columns), pinnedColumns);
  const visibleColumns = allColumns.filter((column) => columnVisibility[column.id] !== false);
  const related = node.children.flatMap((child) => {
    const summary = summaries[child.id];
    const loaded = loadedSnapshot(child, view.loadedView, view.scope) !== undefined;
    return summary && loaded ? [{ node: child, summary }] : [];
  });
  const filtered = rows === 'filtered' || filteredItems.length === allItemIds.length;
  const loaded = loadedItemsById(view.loadedView);
  const items = filtered ? filteredItems : allItemIds.flatMap((id) => loaded.get(id) ?? []);
  const request: ExportRequest = {
    rows: items.map((item) => ({ item })),
    columns: columnChoice === 'visible' ? visibleColumns : allColumns,
    related,
  };

  return (
    <>
      <div className="grid gap-1.5 p-3.5">
        <p className="m-0 text-sm font-semibold">Export {title}</p>
        {filteredItems.length !== allItemIds.length ? (
          <Choice
            label="Rows"
            value={rows}
            options={[
              { value: 'filtered', label: `Filtered ${filteredItems.length}` },
              { value: 'all', label: `All ${allItemIds.length}` },
            ]}
            onChange={setRows}
          />
        ) : null}
        <Choice
          label="Columns"
          value={columnChoice}
          options={[
            { value: 'visible', label: `Visible ${visibleColumns.length}` },
            { value: 'all', label: `All ${allColumns.length}` },
          ]}
          onChange={setColumnChoice}
        />
        <FormatChoice value={format} onChange={setFormat} />
        {node.children.length > 0 ? (
          <fieldset className="m-0 mt-2 grid gap-1 border-0 border-t border-border p-0 pt-3">
            <legend className="float-left m-0 p-0 text-xs font-semibold">
              Add related collections as columns
            </legend>
            <p className="m-0 mb-1 text-xs text-muted-foreground">
              Still one row per item. Related items share a cell.
            </p>
            {node.children.map((child) => {
              // A collection that is loading or failed to load would sum up as nothing at all.
              const loaded = loadedSnapshot(child, view.loadedView, view.scope) !== undefined;
              const summary = loaded ? summaries[child.id] : undefined;
              return (
                <div key={child.id} className="flex min-h-8 items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs has-disabled:cursor-default has-disabled:text-muted-foreground">
                    <Checkbox
                      disabled={!loaded}
                      checked={summary !== undefined}
                      onCheckedChange={(checked) =>
                        setSummaries({ ...summaries, [child.id]: checked ? 'names' : undefined })
                      }
                    />
                    <span className="truncate">{child.name}</span>
                    {loaded ? null : <span className="shrink-0">Not loaded</span>}
                  </label>
                  {summary ? (
                    <SummarySelect
                      label={`${child.name} value`}
                      value={summary}
                      onChange={(next) => setSummaries({ ...summaries, [child.id]: next })}
                    />
                  ) : null}
                </div>
              );
            })}
          </fieldset>
        ) : null}
        <IncompleteNote view={view} nodes={[node, ...related.map((column) => column.node)]} />
        <StatusNote columnVisibility={columnVisibility} />
      </div>
      <ExportFooter subject={title} view={view} format={format} request={request} />
    </>
  );
}

function NestedExportPanel({
  view,
  root,
  node,
  parentNode,
  parentItem,
  items,
  rootItems,
  columns,
  columnVisibility,
  pinnedColumns,
}: NestedTableExportProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  // An item with nothing related has nothing of its own to export.
  const [scope, setScope] = useState<'item' | 'all'>(items.length > 0 ? 'item' : 'all');
  const path = nodePath(root, node.id);
  // Walking every parent can be large, so it waits until someone picks it.
  const rows =
    scope === 'item'
      ? items.map((item) => ({ item, parent: parentItem }))
      : rowsUnderEveryParent(view, path, rootItems);
  const columnsShown = inTableOrder(exportableColumns(columns), pinnedColumns).filter(
    (column) => columnVisibility[column.id] !== false,
  );
  const request: ExportRequest = { rows, columns: columnsShown, parentNode };

  return (
    <>
      <div className="grid gap-1.5 p-3.5">
        <p className="m-0 text-sm font-semibold">Export {node.name}</p>
        <Choice
          label="Rows"
          value={scope}
          options={[
            { value: 'item', label: `This item ${items.length}` },
            { value: 'all', label: 'All' },
          ]}
          onChange={setScope}
        />
        <FormatChoice value={format} onChange={setFormat} />
        {scope === 'all' ? (
          <Note>
            {node.name} related to any of the{' '}
            {plural(rootItems.length, 'filtered item', 'filtered items')} of {root.name}.
          </Note>
        ) : null}
        <IncompleteNote view={view} nodes={scope === 'item' ? [node] : path} />
        <StatusNote columnVisibility={columnVisibility} />
      </div>
      <ExportFooter subject={node.name} view={view} format={format} request={request} />
    </>
  );
}

const formats: readonly { readonly value: ExportFormat; readonly label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel' },
  { value: 'json', label: 'JSON' },
];

function FormatChoice({
  value,
  onChange,
}: {
  readonly value: ExportFormat;
  readonly onChange: (format: ExportFormat) => void;
}) {
  return <Choice label="Format" value={value} options={formats} onChange={onChange} />;
}

/** A labelled row of mutually exclusive options. */
function Choice<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly onChange: (value: Value) => void;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        onValueChange={([next]) => {
          if (next) onChange(next);
        }}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const summaryOptions: readonly { readonly value: RelatedSummary; readonly label: string }[] = [
  { value: 'names', label: 'Names' },
  { value: 'count', label: 'Count' },
];

function SummarySelect({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: RelatedSummary;
  readonly onChange: (value: RelatedSummary) => void;
}) {
  return (
    <Select
      items={summaryOptions}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {summaryOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Status is loaded per item as cells come into view, so a file cannot hold it for every row.
function StatusNote({ columnVisibility }: Pick<ColumnsShown, 'columnVisibility'>) {
  if (columnVisibility.$status === false) return null;
  return <Note>Publication status is not exported.</Note>;
}

function IncompleteNote({
  view,
  nodes,
}: {
  readonly view: ExportView;
  readonly nodes: readonly CollectionNode[];
}) {
  const incomplete = incompleteNodes(view, nodes);
  if (incomplete.length === 0) return null;
  const names = incomplete.map((node) => node.name).join(', ');
  return (
    <Note>
      {names} did not fully load, so the file may miss related items or rows. Refresh to try again.
    </Note>
  );
}

function Note({ children }: { readonly children: ReactNode }) {
  return (
    <p className="m-0 rounded-md border border-border bg-surface-control px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function ExportFooter({
  subject,
  view,
  format,
  request,
}: {
  readonly subject: string;
  readonly view: ExportView;
  readonly format: ExportFormat;
  readonly request: ExportRequest;
}) {
  const baseName = exportBaseName(subject, view.scope, new Date());
  const rowCount = request.rows.length;
  const columnCount = exportHeaders(request).length;
  const summary = `${plural(rowCount, 'row', 'rows')}, ${plural(columnCount, 'column', 'columns')}`;

  // The file is built here, on download, because a large one takes a while.
  function download() {
    try {
      const file = exportFile(exportTable(view, request), format, subject, baseName);
      saveFile(file);
      toast.success(`Downloaded ${file.name}`, { description: summary });
    } catch (error) {
      toast.error('The file could not be created', {
        description: `${error instanceof Error ? error.message : String(error)}. Try fewer rows or columns, or CSV.`,
      });
    }
  }

  return (
    <div className="grid gap-2 border-t border-border bg-surface-subtle p-3.5">
      <p className="m-0 text-xs text-muted-foreground tabular-nums">{summary}</p>
      <p className="m-0 truncate font-mono text-[11px] text-content-subtle">
        {baseName}.{format}
      </p>
      <Button disabled={rowCount === 0 || columnCount === 0} onClick={download}>
        <Download size={15} aria-hidden="true" /> Download{' '}
        {formats.find((option) => option.value === format)?.label}
      </Button>
    </div>
  );
}
