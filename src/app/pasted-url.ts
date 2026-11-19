/** Text that the instance list and root picker treat as a pasted Zesty URL, not a search. */
export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}
