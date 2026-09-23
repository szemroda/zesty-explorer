import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { ContentItem } from '../domain';
import type { ContentItemColumn } from './content-item-presentation';
import { columnWidthLimits, defaultContentColumnWidth } from './content-item-presentation';

const contentTableFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});

const contentColumnHelper = createColumnHelper<typeof contentTableFeatures, ContentItem>();

interface CreateContentTableColumnsOptions {
  readonly definitions: readonly ContentItemColumn[];
  readonly actionColumnWidth: number;
  readonly renderValue: (value: unknown) => ReactNode;
}

export function createContentTableColumns({
  definitions,
  actionColumnWidth,
  renderValue,
}: CreateContentTableColumnsOptions) {
  return contentColumnHelper.columns([
    contentColumnHelper.display({
      id: 'actions',
      header: 'Item actions',
      size: actionColumnWidth,
      enableHiding: false,
      enableResizing: false,
    }),
    ...definitions.map((column) =>
      contentColumnHelper.accessor((item) => column.read(item), {
        id: column.id,
        header: column.label,
        size: column.defaultWidth,
        enableSorting: column.sortable,
        cell: ({ getValue }) => renderValue(getValue()),
      }),
    ),
  ]);
}

export function contentActionColumnWidth(canExpand: boolean, hasManagerLink: boolean): number {
  if (canExpand) return hasManagerLink ? 140 : 102;
  return hasManagerLink ? 94 : 56;
}

interface UseContentTableOptions {
  readonly data: readonly ContentItem[];
  readonly columns: ReturnType<typeof createContentTableColumns>;
  readonly sorting: SortingState;
  readonly columnSizing: ColumnSizingState;
  readonly columnVisibility: ColumnVisibilityState;
  readonly pagination: PaginationState;
  readonly onSortingChange: OnChangeFn<SortingState>;
  readonly onColumnSizingChange: OnChangeFn<ColumnSizingState>;
  readonly onColumnVisibilityChange: OnChangeFn<ColumnVisibilityState>;
  readonly onPaginationChange: OnChangeFn<PaginationState>;
}

export function useContentTable({
  data,
  columns,
  sorting,
  columnSizing,
  columnVisibility,
  pagination,
  onSortingChange,
  onColumnSizingChange,
  onColumnVisibilityChange,
  onPaginationChange,
}: UseContentTableOptions) {
  return useTable({
    features: contentTableFeatures,
    data,
    columns,
    state: { sorting, columnSizing, columnVisibility, pagination },
    onSortingChange,
    onColumnSizingChange,
    onColumnVisibilityChange,
    onPaginationChange,
    manualSorting: true,
    enableSortingRemoval: false,
    defaultColumn: {
      size: defaultContentColumnWidth,
      minSize: columnWidthLimits.min,
      maxSize: columnWidthLimits.max,
    },
    columnResizeMode: 'onChange',
  });
}

export type ContentTableInstance = ReturnType<typeof useContentTable>;
