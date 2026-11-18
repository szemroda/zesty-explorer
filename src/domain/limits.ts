/** The most content items the app loads from one collection. */
export const collectionItemLimit = 200_000;

/**
 * The most content items one view loads across all of its collections. Set by browser memory:
 * Chromium allows a tab about 4 GiB, a searched rich-text item can take 7 KiB, and an earlier
 * view can still be in memory while the next one loads.
 */
export const viewItemLimit = 200_000;
