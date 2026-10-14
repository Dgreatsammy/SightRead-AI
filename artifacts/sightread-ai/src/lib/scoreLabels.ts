/**
 * Decides which labels are worth drawing on the sheet.
 *
 * Audiveris fills in a part name ("Voice", "Part 1", ...) when the page has no
 * printed one. Drawing those would show text that is not on the original, so
 * part names are only drawn when at least one looks like a real printed name
 * (for example "Soprano", "Contralto", "Basso").
 */
const GENERIC_PART_NAME =
  /^(voice|voices|part|parts|music|staff|instrument|untitled|unknown|piano|p)\s*\d*$/i;

export function hasMeaningfulPartNames(source: string): boolean {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return true; // unsure: keep whatever the score says
  }
  const names = Array.from(doc.getElementsByTagName("part-name"))
    .map((el) => (el.textContent ?? "").trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return false;
  return names.some((name) => !GENERIC_PART_NAME.test(name));
}
