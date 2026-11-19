import { Link2, Search } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { cn } from '../lib/utils';
import { looksLikeUrl } from '../pasted-url';
import { Input } from './ui/input';

interface PickerSearchProps {
  /** Names the field for assistive technology and doubles as its placeholder. */
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** The listbox the arrow keys move through. */
  readonly listId: string;
  readonly activeOptionId: string | undefined;
  readonly onMove: (offset: 1 | -1) => void;
  readonly onEnter: () => void;
  /** Called when the browser pastes a URL, so a paste opens it without pressing Enter. */
  readonly onPasteUrl: (url: string) => void;
  /** The element that says what is wrong with a pasted URL, while something is. */
  readonly problemId: string | undefined;
  readonly autoFocus?: boolean;
}

/**
 * The search field above a picker list. It owns the list's keyboard: arrows move the active
 * option and Enter chooses it, while focus stays in the field (the ARIA combobox pattern).
 */
export function PickerSearch({
  label,
  value,
  onChange,
  listId,
  activeOptionId,
  onMove,
  onEnter,
  onPasteUrl,
  problemId,
  autoFocus = false,
}: PickerSearchProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onEnter();
  };

  return (
    <div className="relative">
      <Search
        size={16}
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-invalid={problemId ? true : undefined}
        aria-describedby={problemId}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        placeholder={label}
        className="h-10 pl-9"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          if (
            (event.nativeEvent as InputEvent).inputType === 'insertFromPaste' &&
            looksLikeUrl(next)
          ) {
            onPasteUrl(next);
          }
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** The single option a picker list shows while its search holds a URL. */
export function PastedUrlOption({
  id,
  problemId,
  url,
  active,
  problem,
  description,
  onChoose,
}: {
  readonly id: string;
  readonly problemId: string;
  readonly url: string;
  readonly active: boolean;
  readonly problem: string | undefined;
  readonly description: string;
  readonly onChoose: () => void;
}) {
  return (
    <div className="grid gap-2 p-1">
      <div
        id={id}
        role="option"
        aria-selected={active}
        tabIndex={-1}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm',
          active ? 'bg-accent' : 'hover:bg-surface-menu-hover',
        )}
        onClick={onChoose}
      >
        <Link2 size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Open this Zesty URL</span>
          <span className="text-muted-foreground block truncate text-xs">{url.trim()}</span>
        </span>
      </div>
      <p className="text-muted-foreground px-3 text-xs">{description}</p>
      {problem ? (
        <p id={problemId} className="text-destructive px-3 text-sm" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
