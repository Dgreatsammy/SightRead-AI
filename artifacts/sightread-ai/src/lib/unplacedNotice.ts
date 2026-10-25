/**
 * Turns the server's "notes found but not placed" list into a plain notice.
 *
 * Audiveris sometimes recognises the notes of a busy bar but cannot fit them
 * together, so they are left out and the bar is incomplete (in a real reading
 * of "Ding Dong! Merrily on High" a whole run of soprano notes vanished and a
 * lower note played inside the soprano line instead). When the server reports
 * that, the singer should hear it said plainly rather than practise the bar.
 */
export interface UnplacedNotes {
  page: number;
  bar: number;
  count: number;
}

/** Keeps only well-formed entries; anything else from the server is ignored. */
export function readUnplacedNotes(value: unknown): UnplacedNotes[] {
  if (!Array.isArray(value)) return [];
  const clean: UnplacedNotes[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { page, bar, count } = item as Record<string, unknown>;
    if (
      Number.isInteger(page) && (page as number) >= 1 &&
      Number.isInteger(bar) && (bar as number) >= 1 &&
      Number.isInteger(count) && (count as number) >= 1
    ) {
      clean.push({ page: page as number, bar: bar as number, count: count as number });
    }
  }
  return clean;
}

/** Empty string when nothing was left out. */
export function describeUnplacedNotes(list: UnplacedNotes[]): string {
  if (list.length === 0) return "";
  const labels = list.map((item) =>
    item.page > 1 ? `${item.bar} (page ${item.page})` : String(item.bar),
  );
  const where =
    labels.length === 1
      ? `Bar ${labels[0]} is`
      : `Bars ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]} are`;
  const total = list.reduce((sum, item) => sum + item.count, 0);
  const notes = total === 1 ? "1 note was" : `${total} notes were`;
  return `${where} incomplete: ${notes} read but could not be placed, so what you see and hear there is not reliable.`;
}
