import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CollectionNode, ContentItem, ItemZuid } from '../../domain';
import { nodePath } from '../../explorer-core';
import type { ContentItemColumn } from '../content-item-presentation';
import { exportBaseName, exportFile, saveFile, type ExportFormat } from '../export-file';
import { loadedItemsById } from '../load-view';
import { plural } from '../lib/utils';
import {
  exportableColumns,
  exportTable,
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
  /** The items this table shows below its parent item. */
  readonly items: readonly ContentItem[];
  /** Root items that match the view's search and filters, in table order. */
  readonly rootItems: readonly ContentItem[];
}

/** Exports a nested table, for its parent item or across every parent in the view. */
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
}: RootTableExportProps) {
  const [rows, setRows] = useState<'filtered' | 'all'>('filtered');
  const [columnChoice, setColumnChoice] = useState<'visible' | 'all'>('visible');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [summaries, setSummaries] = useState<Readonly<Partial<Record<string, RelatedSummary>>>>({});
  const allColumns = exportableColumns(columns);
  const visibleColumns = allColumns.filter((column) => columnVisibility[column.id] !== false);
  const related = node.children.flatMap((child) => {
    const summary = summaries[child.id];
    return summary ? [{ node: child, summary }] : [];
  });
  const filtered = rows === 'filtered' || filteredItems.length === allItemIds.length;
  const rowCount = filtered ? filteredItems.length : allItemIds.length;
  const chosenColumns = columnChoice === 'visible' ? visibleColumns : allColumns;

  function request(): ExportRequest {
    const loaded = loadedItemsById(view.loadedView);
    const items = filtered ? filteredItems : allItemIds.flatMap((id) => loaded.get(id) ?? []);
    return { rows: items.map((item) => ({ item })), columns: chosenColumns, related };
  }

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
              const summary = summaries[child.id];
              return (
                <div key={child.id} className="flex min-h-8 items-center gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={summary !== undefined}
                      onCheckedChange={(checked) =>
                        setSummaries({ ...summaries, [child.id]: checked ? 'names' : undefined })
                      }
                    />
                    <span className="truncate">{child.name}</span>
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
        <StatusNote columnVisibility={columnVisibility} />
      </div>
      <ExportFooter
        subject={title}
        view={view}
        format={format}
        rowCount={rowCount}
        columnCount={chosenColumns.length + related.length}
        request={request}
      />
    </>
  );
}

function NestedExportPanel({
  view,
  root,
  node,
  parentNode,
  items,
  rootItems,
  columns,
  columnVisibility,
}: NestedTableExportProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  // An item with nothing related has nothing of its own to export.
  const [rows, setRows] = useState<'item' | 'all'>(items.length > 0 ? 'item' : 'all');
  const everyParent = rowsUnderEveryParent(view, nodePath(root, node.id), rootItems);
  const visibleColumns = exportableColumns(columns).filter(
    (column) => columnVisibility[column.id] !== false,
  );
  const request = (): ExportRequest =>
    rows === 'item'
      ? { rows: items.map((item) => ({ item })), columns: visibleColumns }
      : { rows: everyParent, columns: visibleColumns, parentNode };

  return (
    <>
      <div className="grid gap-1.5 p-3.5">
        <p className="m-0 text-sm font-semibold">Export {node.name}</p>
        <Choice
          label="Rows"
          value={rows}
          options={[
            { value: 'item', label: `This item ${items.length}` },
            { value: 'all', label: `All ${everyParent.length}` },
          ]}
          onChange={setRows}
        />
        <FormatChoice value={format} onChange={setFormat} />
        {rows === 'all' ? (
          <Note>
            Rows come from the {plural(rootItems.length, 'filtered item', 'filtered items')} of{' '}
            {root.name}, each with its {parentNode.name} ZUID and name.
          </Note>
        ) : null}
        <StatusNote columnVisibility={columnVisibility} />
      </div>
      <ExportFooter
        subject={node.name}
        view={view}
        format={format}
        rowCount={rows === 'item' ? items.length : everyParent.length}
        columnCount={visibleColumns.length + (rows === 'all' ? 2 : 0)}
        request={request}
      />
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
  rowCount,
  columnCount,
  request,
}: {
  readonly subject: string;
  readonly view: ExportView;
  readonly format: ExportFormat;
  readonly rowCount: number;
  readonly columnCount: number;
  /** Called on download, so a large file is only built when someone asks for it. */
  readonly request: () => ExportRequest;
}) {
  const baseName = exportBaseName(subject, view.scope, new Date());
  const summary = `${plural(rowCount, 'row', 'rows')}, ${plural(columnCount, 'column', 'columns')}`;

  function download() {
    const file = exportFile(exportTable(view, request()), format, subject, baseName);
    saveFile(file);
    toast.success(`Downloaded ${file.name}`, { description: summary });
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
