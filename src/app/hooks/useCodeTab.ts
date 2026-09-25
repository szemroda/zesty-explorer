import { useState } from 'react';
import type { CodeSelection, InstanceReference, SharedState } from '../../domain';

export interface CodeTabState {
  readonly selection: CodeSelection;
  readonly select: (selection: CodeSelection) => void;
  readonly fileFilter: string;
  readonly setFileFilter: (fileFilter: string) => void;
  /** Forgets the selection, file filter, and their instance, e.g. when the view is reset. */
  readonly reset: () => void;
  /** Identifies the selected instance, e.g. to remount the Code tab when it changes. */
  readonly instanceKey: string | undefined;
}

/**
 * The Code tab's file, code state, and file filter for the selected instance. Selecting a
 * different instance resets them. Losing the instance for a moment, e.g. while a token is
 * replaced, keeps them.
 */
export function useCodeTab(
  instance: InstanceReference | undefined,
  initial: Pick<SharedState, 'codeSelection' | 'codeFileFilter'> | undefined,
): CodeTabState {
  const [selection, select] = useState<CodeSelection>(
    initial?.codeSelection ?? { state: 'latest' },
  );
  const [fileFilter, setFileFilter] = useState(initial?.codeFileFilter ?? '');
  const instanceKey = instance ? `${instance.deployment}:${instance.instanceZuid}` : undefined;
  const [selectionKey, setSelectionKey] = useState(instanceKey);
  if (instanceKey && instanceKey !== selectionKey) {
    setSelectionKey(instanceKey);
    if (selectionKey) {
      select({ state: 'latest' });
      setFileFilter('');
    }
  }
  const reset = () => {
    select({ state: 'latest' });
    setFileFilter('');
    setSelectionKey(undefined);
  };
  return { selection, select, fileFilter, setFileFilter, reset, instanceKey };
}
