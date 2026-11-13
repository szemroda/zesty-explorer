import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A count with its noun, e.g. `plural(1, 'item', 'items')` is "1 item". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "12 items", or "3 of 12 items" when only some are shown. */
export function shownCount(shown: number, total: number, one: string, many: string): string {
  return shown === total ? plural(total, one, many) : `${shown} of ${plural(total, one, many)}`;
}
