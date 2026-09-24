import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  ExternalLink,
  SlidersHorizontal,
} from 'lucide-react';
import { Fragment, memo, type ReactNode, useCallback, useState } from 'react';
import type { CollectionReference, ContentItem } from '../../domain';
import type { ContentTableInstance } from '../content-table-model';
import { formatContentValue, type ContentItemColumn } from '../content-item-presentation';
import { Button } from './ui/button';
import { buttonVariants } from './ui/button-variants';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { TooltipTrigger } from './ui/tooltip';

interface ContentTableGridProps {
  readonly table: ContentTableInstance;
  readonly reference: CollectionReference;
  readonly canExpand: boolean;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly renderExpandedRow: (item: ContentItem) => ReactNode;
  readonly emptyContent?: ReactNode;
}

type ContentTableRowModel = ReturnType<ContentTableInstance['getRowModel']>['rows'][number];

interface ContentTableBodyRowProps {
  readonly table: ContentTableInstance;
  readonly row: ContentTableRowModel;
  readonly reference: CollectionReference;
  readonly canExpand: boolean;
  readonly expanded: boolean;
  readonly visibleColumnCount: number;
  readonly toggleExpanded: (itemId: ContentItem['id']) => void;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly renderExpandedRow: (item: ContentItem) => ReactNode;
}

const ContentTableBodyRow = memo(function ContentTableBodyRow({
  table,
  row,
  reference,
  canExpand,
  expanded,
  visibleColumnCount,
  toggleExpanded,
  onOpenDetails,
  renderExpandedRow,
}: ContentTableBodyRowProps) {
  return (
    <Fragment>
      <TableRow className="group hover:bg-transparent">
        {row.getVisibleCells().map((cell) => (
          <TableCell
            key={cell.id}
            className={`h-11 max-w-[520px] border-b border-divider-subtle px-3 py-2 align-middle whitespace-nowrap group-hover:bg-surface-hover ${
              cell.column.id === 'actions' ? 'sticky left-0 z-3 bg-panel px-2.5 shadow-sticky' : ''
            }`}
          >
            {cell.column.id === 'actions' ? (
              <ContentItemActions
                item={row.original}
                reference={reference}
                canExpand={canExpand}
                expanded={expanded}
                onToggleExpanded={() => toggleExpanded(row.original.id)}
                onOpenDetails={onOpenDetails}
              />
            ) : (
              <table.FlexRender cell={cell} />
            )}
          </TableCell>
        ))}
      </TableRow>
      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell
            className="h-auto bg-surface-recessed p-0 hover:bg-surface-recessed"
            colSpan={visibleColumnCount}
          >
            {renderExpandedRow(row.original)}
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
});

export function ContentTableGrid({
  table,
  reference,
  canExpand,
  onOpenDetails,
  renderExpandedRow,
  emptyContent,
}: ContentTableGridProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<ContentItem['id']>>(new Set());
  const toggleExpanded = useCallback((itemId: ContentItem['id']) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  if (table.getRowModel().rows.length === 0 && emptyContent) return emptyContent;

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <Table
        className="border-separate border-spacing-0 text-xs"
        style={{ width: `max(100%, ${table.getTotalSize()}px)`, tableLayout: 'fixed' }}
      >
        <colgroup>
          {table.getVisibleLeafColumns().map((column, index, visibleColumns) => (
            <col
              key={column.id}
              style={index === visibleColumns.length - 1 ? undefined : { width: column.getSize() }}
            />
          ))}
        </colgroup>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow className="hover:bg-transparent" key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={`relative h-9 max-w-[520px] border-b border-divider-subtle bg-surface-header px-3 py-2 text-left align-middle text-[11px] font-bold tracking-[0.045em] whitespace-nowrap text-foreground/75 uppercase ${
                    header.id === 'actions'
                      ? 'sticky left-0 z-4 bg-surface-header shadow-sticky'
                      : ''
                  }`}
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <Button
                      variant="ghost"
                      className="h-auto gap-1.5 p-0 font-[inherit] text-inherit hover:bg-transparent hover:text-content-hover"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <table.FlexRender header={header} />
                      {header.column.getIsSorted() === 'asc' ? <ChevronUp size={13} /> : null}
                      {header.column.getIsSorted() === 'desc' ? <ChevronDown size={13} /> : null}
                    </Button>
                  ) : header.id === 'actions' ? (
                    <span className="sr-only">
                      <table.FlexRender header={header} />
                    </span>
                  ) : (
                    <table.FlexRender header={header} />
                  )}
                  {header.column.getCanResize() ? (
                    <span
                      data-slot="column-resize-handle"
                      aria-hidden="true"
                      className="absolute inset-y-1.5 -right-0.5 w-1.5 cursor-col-resize rounded-full hover:bg-accent/50"
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                    />
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="[&_tr:last-child_td]:border-b-0">
          {table.getRowModel().rows.map((row) => (
            <ContentTableBodyRow
              key={row.original.id}
              table={table}
              row={row}
              reference={reference}
              canExpand={canExpand}
              expanded={expanded.has(row.original.id)}
              visibleColumnCount={visibleColumnCount}
              toggleExpanded={toggleExpanded}
              onOpenDetails={onOpenDetails}
              renderExpandedRow={renderExpandedRow}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface ContentItemActionsProps {
  readonly item: ContentItem;
  readonly reference: CollectionReference;
  readonly canExpand: boolean;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
}

export function ContentItemActions({
  item,
  reference,
  canExpand,
  expanded,
  onToggleExpanded,
  onOpenDetails,
}: ContentItemActionsProps) {
  const label = formatContentValue(item.fields.title ?? item.fields.name);
  const itemLabel = label === '\u2014' ? item.id : label;
  const hasManagerLink = reference.area !== 'other';

  return (
    <div className="flex w-max items-center gap-1.5" role="group" aria-label="Item actions">
      {canExpand ? (
        <TooltipTrigger
          text={expanded ? 'Hide related items' : 'Show related items'}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative mr-1.5 after:pointer-events-none after:absolute after:inset-y-1.5 after:-right-1.5 after:w-px after:bg-border"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} relationships for ${item.id}`}
              aria-expanded={expanded}
              onClick={onToggleExpanded}
            />
          }
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </TooltipTrigger>
      ) : null}
      <TooltipTrigger
        text="Open item details"
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Open details for ${itemLabel}`}
            onClick={(event) => onOpenDetails(item, event.currentTarget)}
          />
        }
      >
        <Eye size={15} />
      </TooltipTrigger>
      {hasManagerLink ? (
        <TooltipTrigger
          text="Open in Zesty Manager in a new tab"
          render={
            <a
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={`Open ${itemLabel} in Zesty Manager`}
              href={`${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}/${item.id}`}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <ExternalLink size={15} />
        </TooltipTrigger>
      ) : null}
    </div>
  );
}

interface ContentColumnsMenuProps {
  readonly table: ContentTableInstance;
  readonly columns: readonly ContentItemColumn[];
  readonly label: string;
}

export function ContentColumnsMenu({ table, columns, label }: ContentColumnsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" aria-label={label}>
            <SlidersHorizontal size={14} /> Columns
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-56">
        {table
          .getAllLeafColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(checked) => column.toggleVisibility(checked)}
            >
              {columns.find((definition) => definition.id === column.id)?.label ?? column.id}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ContentTablePaginationProps {
  readonly table: ContentTableInstance;
  readonly itemCount: number;
  readonly itemLabel: string;
}

const pageSizes = [25, 50, 100] as const;

export function ContentTablePagination({
  table,
  itemCount,
  itemLabel,
}: ContentTablePaginationProps) {
  return (
    <div className="flex min-h-12 items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <span className="mr-auto">
        {itemCount} {itemLabel}
      </span>
      {table.getPageCount() > 1 ? (
        <>
          <Button
            variant="outline"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </Button>
          <span className="text-foreground/80">
            Page {table.state.pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </Button>
        </>
      ) : null}
      <label className="flex items-center gap-2">
        Items
        <Select
          items={pageSizes.map((size) => ({ label: String(size), value: String(size) }))}
          value={String(table.state.pagination.pageSize)}
          onValueChange={(size) => {
            if (size !== null) table.setPageSize(Number(size));
          }}
        >
          <SelectTrigger className="min-w-20" size="sm" aria-label="Items per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {pageSizes.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
