import { ArrowDown, ArrowUp, Check, ChevronDown, EyeOff, Pin, PinOff } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/** A column header as its menu sees it. */
export interface ColumnHeader {
  /** The column's label, e.g. `Workflow status`. */
  readonly label: ReactNode;
  readonly canSort: boolean;
  readonly sorted: false | 'asc' | 'desc';
  readonly sort: (direction: 'asc' | 'desc') => void;
  readonly hide: () => void;
  /** Pinned columns stay at the table's start while it scrolls sideways. */
  readonly pinned: boolean;
  readonly setPinned: (pinned: boolean) => void;
}

/** The whole header is a button that opens the column menu: sort, pin, and hide. */
export function ColumnMenuHeader({ header }: { readonly header: ColumnHeader }) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="group/menu relative -mx-3 -my-2 flex w-[calc(100%+1.5rem)] min-w-0 cursor-pointer items-center gap-1 px-3 py-2 text-left uppercase outline-none hover:text-content-hover focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-inset">
        <span className="truncate">{header.label}</span>
        {header.pinned ? (
          <Pin size={11} className="shrink-0 opacity-60" aria-label="pinned" />
        ) : null}
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
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1" aria-labelledby={headingId}>
        <p
          id={headingId}
          className="m-0 truncate px-2 pt-1.5 pb-1 text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
        >
          {header.label}
        </p>
        {header.canSort ? (
          <>
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
            <MenuSeparator />
          </>
        ) : null}
        <MenuButton
          icon={header.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          onClick={() => {
            setOpen(false);
            header.setPinned(!header.pinned);
          }}
        >
          {header.pinned ? 'Unpin column' : 'Pin column'}
        </MenuButton>
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
