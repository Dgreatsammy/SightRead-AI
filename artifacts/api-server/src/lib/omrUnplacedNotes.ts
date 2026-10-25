/**
 * Finds notes that Audiveris recognised but could not place in a bar.
 *
 * Audiveris keeps a project file (.omr, written with the -save option). For
 * every bar and staff it records all the note chords it found (`head-chords`)
 * and, separately, which chords it assigned to a voice. When its rhythm step
 * cannot fit a busy bar together, the leftover chords are simply never written
 * to the MusicXML export: the notes vanish and the bar is silently incomplete.
 *
 * Seen in a real reading of "Ding Dong! Merrily on High": chorus bar 9 had 8
 * chords on the top staff but only 3 placed. The 5 left over were exactly the
 * soprano notes missing from the export, and the one placed lower note then
 * played inside the soprano line. Those 5 chords carried a confidence of about
 * 0.94, so the recogniser's own confidence grades would not have flagged it;
 * the unplaced count is the signal. On that piece no other bar had any
 * unplaced chord, but other wrong bars (right notes at the wrong times) have
 * none either, so this catches the worst kind of error, not every error.
 *
 * Nothing here changes the score. Any failure returns an empty list: a
 * missing warning must never break an import.
 */
import JSZip from "jszip";
import { promises as fs } from "node:fs";

export interface UnplacedNotes {
  /** Page (sheet) number, starting at 1. */
  page: number;
  /** Bar number on that page, starting at 1. */
  bar: number;
  /** How many recognised note chords were left out of the bar. */
  count: number;
}

/** Counts unplaced chords per bar for ONE sheet's project XML. */
export function findUnplacedNotesInSheet(
  sheetXml: string,
): { bar: number; count: number }[] {
  const perBar = new Map<number, number>();
  const measures = /<measure id="(\d+)">([\s\S]*?)<\/measure>/g;
  for (let match = measures.exec(sheetXml); match; match = measures.exec(sheetXml)) {
    const bar = Number(match[1]);
    const body = match[2] ?? "";
    const listed = /<head-chords>([^<]*)<\/head-chords>/.exec(body)?.[1];
    if (!listed) continue;
    const used = new Set<string>();
    const usedPattern = /chord="(\d+)"/g;
    for (let m = usedPattern.exec(body); m; m = usedPattern.exec(body)) {
      if (m[1]) used.add(m[1]);
    }
    const missing = listed
      .split(/\s+/)
      .filter((id) => id.length > 0 && !used.has(id)).length;
    if (missing > 0) perBar.set(bar, (perBar.get(bar) ?? 0) + missing);
  }
  return [...perBar.entries()]
    .map(([bar, count]) => ({ bar, count }))
    .sort((a, b) => a.bar - b.bar);
}

/** Reads a saved Audiveris .omr file and reports unplaced notes on every page. */
export async function readUnplacedNotes(omrPath: string): Promise<UnplacedNotes[]> {
  try {
    const archive = await JSZip.loadAsync(await fs.readFile(omrPath));
    const sheets = archive
      .file(/(^|\/)sheet#(\d+)\/sheet#\2\.xml$/)
      .map((entry) => ({
        entry,
        page: Number(/sheet#(\d+)\//.exec(entry.name)?.[1]),
      }))
      .filter((sheet) => Number.isFinite(sheet.page))
      .sort((a, b) => a.page - b.page);

    const found: UnplacedNotes[] = [];
    for (const { entry, page } of sheets) {
      for (const item of findUnplacedNotesInSheet(await entry.async("string"))) {
        found.push({ page, ...item });
      }
    }
    return found;
  } catch {
    return [];
  }
}
