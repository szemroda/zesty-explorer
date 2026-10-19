import { ChevronDown, ChevronRight, Eye, ExternalLink, SlidersHorizontal } from 'lucide-react';
import {
  Fragment,
  memo,
  type CSSProperties,
  type ReactNode,
  use,
  useCallback,
  useState,
} from 'react';
import type { CollectionReference, ContentItem } from '../../domain';
import { actionsColumnId, type ContentTableInstance } from '../content-table-model';
import { ScrollDockContext } from '../scroll-dock';
import {
  itemDisplayLabel,
  managerItemUrl,
  type ContentItemColumn,
} from '../content-item-presentation';
import { ColumnMenuHeader } from './ColumnMenu';
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
  /** Names the table's collection, e.g. for its docked scrollbar. */
  readonly label: string;
  readonly reference: CollectionReference;
  readonly canExpand: boolean;
  readonly onOpenDetails: (item: ContentItem, trigger: HTMLElement) => void;
  readonly renderExpandedRow: (item: ContentItem) => ReactNode;
  /** Shown under the headers while no rows match. */
  readonly emptyContent: ReactNode;
}

type ContentTableRowModel = ReturnType<ContentTableInstance['getRowModel']>['rows'][number];

/**
 * Sticky placement of the cell at `index` among a row's visible cells. The row actions and pinned
 * columns come first; their left offsets live in `--pinned-start-<index>` on the table, so they
 * stay right even when a memoized row skips rendering. The last of them casts the scroll edge.
 */
function pinnedCellPlacement(
  index: number,
  pinnedCount: number,
): { readonly className: string; readonly style?: CSSProperties } {
  if (index >= pinnedCount) return { className: '' };
  return {
    className: index === pinnedCount - 1 ? 'sticky sticky-edge' : 'sticky',
    style: { left: `var(--pinned-start-${index})` },
  };
}

/**
 * Returns the function that flips the frame's edge state, 0 or 1, for CSS to read:
 * `--grid-scrolled` once the scroller leaves its left edge, and `--grid-more-right` while
 * columns are hidden to the right. It writes only the values that changed.
 */
function edgeStateUpdater(scroller: HTMLElement, frame: HTMLElement) {
  const written = new Map<string, string>();
  const write = (name: string, on: boolean) => {
    const value = on ? '1' : '0';
    if (written.get(name) === value) return;
    written.set(name, value);
    frame.style.setProperty(name, value);
  };
  return () => {
    write('--grid-scrolled', scroller.scrollLeft > 1);
    write(
      '--grid-more-right',
      scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 1,
    );
  };
}

interface ContentTableBodyRowProps {
  readonly table: ContentTableInstance;
  readonly row: ContentTableRowModel;
  readonly reference: CollectionReference;
  readonly canExpand: boolean;
  readonly expanded: boolean;
  readonly visibleColumnCount: number;
  /** How many leading cells stay in place: the row actions and every pinned column. */
  readonly pinnedCount: number;
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
  pinnedCount,
  toggleExpanded,
  onOpenDetails,
  renderExpandedRow,
}: ContentTableBodyRowProps) {
  return (
    <Fragment>
      <TableRow className="group hover:bg-transparent">
        {row.getVisibleCells().map((cell, index) => {
          const placement = pinnedCellPlacement(index, pinnedCount);
          return (
            <TableCell
              key={cell.id}
              className={`h-11 max-w-[520px] border-b border-divider-subtle px-3 py-2 align-middle whitespace-nowrap group-hover:bg-surface-hover ${
                index < pinnedCount ? 'z-3 bg-panel' : ''
              } ${cell.column.id === actionsColumnId ? 'px-2.5' : ''} ${placement.className}`}
              style={placement.style}
            >
              {cell.column.id === actionsColumnId ? (
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
          );
        })}
      </TableRow>
      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell
            className="h-auto bg-surface-recessed p-0 hover:bg-surface-recessed"
            colSpan={visibleColumnCount}
          >
            {/* Pinned to the scroller's visible width, so scrolling it never moves related tables. */}
            <div className="sticky left-0 z-6 w-[100cqw] bg-surface-recessed">
              {renderExpandedRow(row.original)}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
});

export function ContentTableGrid({
  table,
  label,
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
  const registerScroller = use(ScrollDockContext);
  // Stable, so the scroller registers once rather than on every render.
  const scrollerRef = useCallback(
    (scroller: HTMLDivElement | null) => {
      const frame = scroller?.parentElement;
      if (!scroller || !frame) return;
      const updateEdges = edgeStateUpdater(scroller, frame);
      updateEdges();
      scroller.addEventListener('scroll', updateEdges, { passive: true });
      const unregister = registerScroller(scroller, label, updateEdges);
      return () => {
        scroller.removeEventListener('scroll', updateEdges);
        unregister();
      };
    },
    [label, registerScroller],
  );
  // Pinning moves the actions and pinned columns ahead of the rest, as headers and cells render.
  const stickyColumns = table.getStartVisibleLeafColumns();
  const visibleColumns = [...stickyColumns, ...table.getCenterVisibleLeafColumns()];
  const visibleColumnCount = visibleColumns.length;
  const pinnedOffsets = Object.fromEntries(
    stickyColumns.map((column, index) => [
      `--pinned-start-${index}`,
      `${column.getStart('start')}px`,
    ]),
  );

  return (
    <div className="relative isolate w-full min-w-0">
      <div
        ref={scrollerRef}
        className="@container w-full min-w-0 overflow-x-auto"
        // Keeps a focused cell or header from scrolling into view underneath the sticky columns.
        style={{ scrollPaddingInlineStart: table.getStartTotalSize() }}
      >
        <Table
          className="border-separate border-spacing-0 text-xs"
          style={{
            width: `max(100%, ${table.getTotalSize()}px)`,
            tableLayout: 'fixed',
            ...pinnedOffsets,
          }}
        >
          <colgroup>
            {visibleColumns.map((column, index) => (
              <col
                key={column.id}
                style={
                  index === visibleColumns.length - 1 ? undefined : { width: column.getSize() }
                }
              />
            ))}
          </colgroup>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow className="hover:bg-transparent" key={group.id}>
                {group.headers.map((header, index) => {
                  const placement = pinnedCellPlacement(index, stickyColumns.length);
                  return (
                    <TableHead
                      key={header.id}
                      className={`group/head h-9 max-w-[520px] border-b border-divider-subtle bg-surface-header px-3 py-2 text-left align-middle text-[11px] font-bold tracking-[0.045em] whitespace-nowrap text-foreground/75 uppercase ${
                        index < stickyColumns.length ? `z-4 ${placement.className}` : 'relative'
                      }`}
                      style={placement.style}
                    >
                      {header.isPlaceholder ? null : header.column.id === actionsColumnId ? (
                        <span className="sr-only">
                          <table.FlexRender header={header} />
                        </span>
                      ) : (
                        <ColumnMenuHeader
                          header={{
                            label: <table.FlexRender header={header} />,
                            canSort: header.column.getCanSort(),
                            sorted: header.column.getIsSorted(),
                            sort: (direction) => header.column.toggleSorting(direction === 'desc'),
                            hide: () => header.column.toggleVisibility(false),
                            pinned: header.column.getIsPinned() === 'start',
                            setPinned: (pinned) => header.column.pin(pinned ? 'start' : false),
                          }}
                        />
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
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="[&_tr:last-child_td]:border-b-0">
            {/* Headers stay while nothing matches, so a filtered header still shows its filter. */}
            {table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumnCount} className="p-0">
                  <div className="sticky left-0 w-[100cqw]">{emptyContent}</div>
                </TableCell>
              </TableRow>
            ) : null}
            {table.getRowModel().rows.map((row) => (
              <ContentTableBodyRow
                key={row.original.id}
                table={table}
                row={row}
                reference={reference}
                canExpand={canExpand}
                expanded={expanded.has(row.original.id)}
                visibleColumnCount={visibleColumnCount}
                pinnedCount={stickyColumns.length}
                toggleExpanded={toggleExpanded}
                onOpenDetails={onOpenDetails}
                renderExpandedRow={renderExpandedRow}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 z-5 w-14 bg-linear-to-l from-black/70 via-black/30 to-transparent transition-opacity duration-150"
        style={{ opacity: 'var(--grid-more-right, 0)' }}
      />
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
  const itemLabel = itemDisplayLabel(item);
  const managerUrl = managerItemUrl(reference, item.id);

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
      {managerUrl ? (
        <TooltipTrigger
          text="Open in Zesty Manager in a new tab"
          render={
            <a
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
              aria-label={`Open ${itemLabel} in Zesty Manager`}
              href={managerUrl}
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
