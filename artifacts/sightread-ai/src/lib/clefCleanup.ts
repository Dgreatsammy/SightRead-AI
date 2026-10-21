/**
 * Removes clefs the recogniser invented, for the DRAWN sheet.
 *
 * Seen in real readings: a treble clef with an "8" above it (octave up) read
 * from a stray glyph, sometimes twice in a row at the start of a staff, and once
 * in the middle of a soprano line. The viewer then draws every note an octave
 * away from where the printed page has it, even though the notes themselves
 * (and the sound) are right.
 *
 * Two rules, both conservative:
 *  1. Two clefs for the same staff in the same place: only the last one counts.
 *  2. A clef's octave mark ("8") is kept only if it moves the staff's notes
 *     CLOSER to the middle of that clef's normal range. A real tenor "treble 8"
 *     passes (tenor notes sit low); an "8 above" on a bass or soprano line fails.
 *
 * Pitches are never changed. If nothing needs changing the original text is
 * returned unchanged.
 */

// Middle of each clef's comfortable range, as MIDI note numbers.
const CLEF_CENTRE: Record<string, number> = { G: 71, F: 50, C: 60 };
const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function kids(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((n): n is Element => n.nodeType === 1);
}
const child = (parent: Element, tag: string) => kids(parent).find((e) => e.tagName === tag);

function midiOf(note: Element): number | null {
  const pitch = child(note, "pitch");
  if (!pitch) return null;
  const step = STEP[child(pitch, "step")?.textContent ?? ""];
  const octave = Number(child(pitch, "octave")?.textContent);
  const alter = Number(child(pitch, "alter")?.textContent ?? 0) || 0;
  if (step === undefined || !Number.isFinite(octave)) return null;
  return (octave + 1) * 12 + step + alter;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** True when the octave mark brings the staff's notes nearer the clef's centre. */
export function octaveMarkFits(sign: string, octaveChange: number, medianPitch: number): boolean {
  const centre = CLEF_CENTRE[sign];
  if (centre === undefined || octaveChange === 0) return true;
  const written = medianPitch - 12 * octaveChange;
  return Math.abs(written - centre) < Math.abs(medianPitch - centre);
}

export interface ClefCleanupResult {
  xml: string;
  removedClefs: number;
  removedOctaveMarks: number;
}

export function cleanClefs(source: string): ClefCleanupResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return { xml: source, removedClefs: 0, removedOctaveMarks: 0 };
  }
  let removedClefs = 0;
  let removedOctaveMarks = 0;

  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    const measures = kids(part).filter((e) => e.tagName === "measure");

    // Median sounding pitch per staff, from the part's own notes.
    const byStaff = new Map<string, number[]>();
    for (const measure of measures) {
      for (const note of kids(measure).filter((e) => e.tagName === "note")) {
        const midi = midiOf(note);
        if (midi === null) continue;
        const staff = child(note, "staff")?.textContent?.trim() || "1";
        const list = byStaff.get(staff) ?? [];
        list.push(midi);
        byStaff.set(staff, list);
      }
    }

    for (const measure of measures) {
      for (const attributes of kids(measure).filter((e) => e.tagName === "attributes")) {
        // Rule 1: duplicate clefs for the same staff in one block: keep the last.
        const clefs = kids(attributes).filter((e) => e.tagName === "clef");
        const lastForStaff = new Map<string, Element>();
        for (const clef of clefs) lastForStaff.set(clef.getAttribute("number") || "1", clef);
        for (const clef of clefs) {
          if (lastForStaff.get(clef.getAttribute("number") || "1") !== clef) {
            attributes.removeChild(clef);
            removedClefs++;
          }
        }
        // Rule 2: octave marks that do not fit the notes.
        for (const clef of kids(attributes).filter((e) => e.tagName === "clef")) {
          const mark = child(clef, "clef-octave-change");
          if (!mark) continue;
          const change = Number(mark.textContent);
          const sign = child(clef, "sign")?.textContent?.trim() ?? "";
          const med = median(byStaff.get(clef.getAttribute("number") || "1") ?? []);
          if (!Number.isFinite(change) || change === 0 || med === null) continue;
          if (!octaveMarkFits(sign, change, med)) {
            clef.removeChild(mark);
            removedOctaveMarks++;
          }
        }
      }
    }
  }

  if (removedClefs === 0 && removedOctaveMarks === 0) {
    return { xml: source, removedClefs, removedOctaveMarks };
  }
  return { xml: new XMLSerializer().serializeToString(doc), removedClefs, removedOctaveMarks };
}
