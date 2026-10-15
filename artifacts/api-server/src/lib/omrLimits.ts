/**
 * Limits for the score-reading (OMR) step. Reading a page takes the server
 * about a minute, so a long score (a full chorus, an orchestral piece) would
 * keep the server busy for a very long time and the person waiting would see
 * nothing. These limits make that fail fast with a clear message instead.
 */
export const DEFAULT_OMR_TIMEOUT_MS = 240_000; // 4 minutes (hosting proxies cut off near 5)
export const DEFAULT_OMR_MAX_PAGES = 4;

/** Reads a positive whole number from an environment value, else the fallback. */
export function readPositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Audiveris page-range argument: pages 1..maxPages (extra pages are ignored). */
export function pageRange(maxPages: number): string {
  return `1-${Math.max(1, Math.floor(maxPages))}`;
}

/** True when a child process was stopped because it ran past its time limit. */
export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { killed?: unknown; signal?: unknown; code?: unknown };
  return (
    details.killed === true ||
    details.code === "ETIMEDOUT" ||
    (details.signal === "SIGKILL" && details.killed !== false)
  );
}

export function timeoutMessage(timeoutMs: number, maxPages: number): string {
  const minutes = Math.round(timeoutMs / 60_000);
  return (
    `Reading this score took longer than ${minutes} minutes, so it was stopped. ` +
    `Long or many-page scores can't be read yet: only the first ${maxPages} pages are read. ` +
    `Try uploading just the page or pages you want to practise (one or two pages works best), ` +
    `or use a clean PDF or a MusicXML file.`
  );
}
