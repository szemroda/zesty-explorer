import { ArrowDown, ArrowUp, Check, ChevronDown, EyeOff } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { ViewFilter } from '../../domain';
import type { FilterField } from '../filter-fields';
import type { FilterContext } from './FilterEditor';
import { ColumnFilterForm, type FilterScope, type ScopeChoice } from './ColumnFilterForm';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/** A column header as its menu sees it. */
export interface ColumnHeader {
  readonly columnId: string;
  /** The column's label, e.g. `Workflow status`. */
  readonly label: ReactNode;
  readonly canSort: boolean;
  readonly sorted: false | 'asc' | 'desc';
  readonly sort: (direction: 'asc' | 'desc') => void;
  readonly hide: () => void;
}

/** A column's filter as its menu edits it. */
export interface ColumnFilterEditor {
  /** Names the form for assistive technology, e.g. `View filter`. */
  readonly label: string;
  readonly field: FilterField;
  /** The filter the column shows; undefined while the column is not filtered. */
  readonly current:
    | {
        readonly filter: ViewFilter;
        readonly scope: FilterScope;
        /** The condition and value without the field, e.g. `is Draft, In review`. */
        readonly summary: string;
      }
    | undefined;
  readonly scopeChoice: ScopeChoice | undefined;
  readonly itemsFor: FilterContext['itemsFor'];
  /**
   * Writes `filter` (its `nodePath` relative to the table) into the list of `scope`, taking it out
   * of the other list when the user moved it.
   */
  readonly apply: (filter: ViewFilter, scope: FilterScope) => void;
  readonly clear: () => void;
}

interface ColumnMenuHeaderProps {
  readonly header: ColumnHeader;
  /** Undefined for columns that cannot be filtered; their menu sorts and hides only. */
  readonly filter: ColumnFilterEditor | undefined;
}

/** The whole header is a button that opens the column menu: sort, filter, hide. */
export function ColumnMenuHeader({ header, filter }: ColumnMenuHeaderProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const current = filter?.current;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {current ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 border-b-2 border-primary/60 bg-primary/8"
        />
      ) : null}
      <PopoverTrigger className="group/menu relative -mx-3 -my-2 flex w-[calc(100%+1.5rem)] min-w-0 cursor-pointer flex-col items-stretch gap-0.5 px-3 py-2 text-left outline-none hover:text-content-hover focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-inset">
        <span className="flex min-w-0 items-center gap-1 uppercase">
          <span className="truncate">{header.label}</span>
          {header.sorted === 'asc' ? (
            <ArrowUp size={12} className="shrink-0" aria-label="sorted ascending" />
          ) : null}
          {header.sorted === 'desc' ? (
            <ArrowDown size={12} className="shrink-0" aria-label="sorted descending" />
          ) : null}
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/head:opacity-60 group-focus-visible/menu:opacity-60 group-data-popup-open/menu:opacity-100"
          />
        </span>
        {current ? (
          <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold tracking-normal text-primary normal-case">
            <span className="sr-only">filtered: </span>
            <span className="truncate">{current.summary}</span>
            {current.scope === 'view' && filter.scopeChoice ? (
              <span className="shrink-0 rounded-sm bg-primary/16 px-1 text-[10px] leading-4">
                all {filter.scopeChoice.root}
              </span>
            ) : null}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1" aria-labelledby={headingId}>
        <p
          id={headingId}
          className="m-0 truncate px-2 pt-1.5 pb-1 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
        >
          {header.label}
        </p>
        {header.canSort ? (
          <div role="group" aria-label="Sort">
            <MenuButton
              icon={<ArrowUp size={14} />}
              checked={header.sorted === 'asc'}
              onClick={() => {
                header.sort('asc');
                setOpen(false);
              }}
            >
              Sort ascending
            </MenuButton>
            <MenuButton
              icon={<ArrowDown size={14} />}
              checked={header.sorted === 'desc'}
              onClick={() => {
                header.sort('desc');
                setOpen(false);
              }}
            >
              Sort descending
            </MenuButton>
          </div>
        ) : null}
        {filter ? (
          <>
            <MenuSeparator />
            <ColumnFilterForm
              label={filter.label}
              field={filter.field}
              filter={current?.filter}
              scope={current?.scope ?? 'table'}
              scopeChoice={filter.scopeChoice}
              itemsFor={filter.itemsFor}
              onApply={(next, scope) => {
                filter.apply(next, scope);
                setOpen(false);
              }}
              onClear={() => {
                filter.clear();
                setOpen(false);
              }}
            />
          </>
        ) : null}
        <MenuSeparator />
        <MenuButton
          icon={<EyeOff size={14} />}
          onClick={() => {
            setOpen(false);
            header.hide();
          }}
        >
          Hide column
        </MenuButton>
      </PopoverContent>
    </Popover>
  );
}

function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}

interface MenuButtonProps {
  readonly icon: ReactNode;
  /** Marks the current choice of a group, e.g. the current sort; omit for plain actions. */
  readonly checked?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

function MenuButton({ icon, checked, onClick, children }: MenuButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none hover:bg-surface-menu-hover focus-visible:bg-surface-menu-hover focus-visible:ring-2 focus-visible:ring-ring/45 [&_svg]:shrink-0 [&>svg:first-child]:text-muted-foreground"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked ? <Check size={14} className="text-primary" aria-hidden="true" /> : null}
    </button>
  );
}
