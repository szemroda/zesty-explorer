import { useState } from 'react';
import type { CodeSelection, InstanceReference } from '../../domain';

export interface CodeSelectionState {
  readonly selection: CodeSelection;
  readonly select: (selection: CodeSelection) => void;
  /** Forgets the selection and its instance, e.g. when the view is reset. */
  readonly reset: () => void;
  /** Identifies the selected instance, e.g. to remount the Code tab when it changes. */
  readonly instanceKey: string | undefined;
}

/**
 * The Code tab's file and code state for the selected instance. Selecting a different instance
 * resets it. Losing the instance for a moment, e.g. while a token is replaced, keeps it.
 */
export function useCodeSelection(
  instance: InstanceReference | undefined,
  initialSelection: CodeSelection | undefined,
): CodeSelectionState {
  const [selection, select] = useState<CodeSelection>(initialSelection ?? { state: 'latest' });
  const instanceKey = instance ? `${instance.deployment}:${instance.instanceZuid}` : undefined;
  const [selectionKey, setSelectionKey] = useState(instanceKey);
  if (instanceKey && instanceKey !== selectionKey) {
    setSelectionKey(instanceKey);
    if (selectionKey) select({ state: 'latest' });
  }
  const reset = () => {
    select({ state: 'latest' });
    setSelectionKey(undefined);
  };
  return { selection, select, reset, instanceKey };
}
