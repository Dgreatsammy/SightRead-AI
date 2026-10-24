/**
 * Puts back the opening rest that optical music recognition drops right after
 * a repeat sign.
 *
 * Seen in a real reading of "Ding Dong! Merrily on High": the first bar of the
 * chorus (the bar that carries the start-repeat sign) really begins with a
 * rest for the tenor and bass. The recogniser lost that rest, probably because
 * it sits next to the repeat dots, so those parts came out one beat short with
 * their notes starting on beat 1 instead of beat 2.
 *
 * Without this module `fillMissingRests` then fills the missing beat at the END
 * of the bar. That draws the rest in the wrong place and, because playback uses
 * the same bar lengths, makes the lower voices enter a beat early and then fall
 * silent on the last beat of the first chorus bar: a pause in the wrong place.
 *
 * The repair is deliberately narrow. It only acts on a bar that carries a
 * start-repeat sign, only on a part whose whole bar is short, and only when
 * another part in the same bar reaches the full bar length (so a genuine pickup
 * bar, where every part is short, is never touched). It writes a visible rest
 * at the start of the bar's first line and shifts the rest of that part's bar
 * later by the same amount. No note is changed or removed.
 *
 * This runs on the score text BEFORE both playback and drawing read it, so what
 * is drawn and what is heard still agree. If nothing needs changing the
 * original text is returned unchanged.
 */
import { splitIntoRests } from "./restFill";

const EPS = 1e-6;

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

function directChild(parent: Element, tag: string): Element | undefined {
  return childElements(parent).find((el) => el.tagName === tag);
}

interface BarInfo {
  measure: Element;
  divisions: number;
  barBeats: number; // full bar length in quarter notes, from the time signature
  contentBeats: number; // longest line in the bar, in quarter notes
  hasStartRepeat: boolean;
}

function readBars(part: Element): BarInfo[] | null {
  const bars: BarInfo[] = [];
  let divisions = 0;
  let beats = 4;
  let beatType = 4;

  for (const measure of childElements(part).filter((el) => el.tagName === "measure")) {
    for (const attributes of childElements(measure).filter((el) => el.tagName === "attributes")) {
      const div = Number(directChild(attributes, "divisions")?.textContent);
      if (Number.isFinite(div) && div > 0) divisions = div;
      const time = directChild(attributes, "time");
      if (time) {
        const b = Number(directChild(time, "beats")?.textContent);
        const t = Number(directChild(time, "beat-type")?.textContent);
        if (Number.isFinite(b) && b > 0 && Number.isFinite(t) && t > 0) {
          beats = b;
          beatType = t;
        }
      }
    }
    if (divisions <= 0) return null; // cannot place a rest without a time unit

    let cursor = 0;
    let maxCursor = 0;
    for (const child of childElements(measure)) {
      if (child.tagName === "backup" || child.tagName === "forward") {
        const d = Number(directChild(child, "duration")?.textContent);
        if (!Number.isFinite(d) || d < 0) return null;
        cursor = child.tagName === "backup" ? Math.max(0, cursor - d) : cursor + d;
        maxCursor = Math.max(maxCursor, cursor);
        continue;
      }
      if (child.tagName !== "note" || directChild(child, "grace")) continue;
      const d = Number(directChild(child, "duration")?.textContent);
      if (!Number.isFinite(d) || d <= 0) return null;
      if (!directChild(child, "chord")) cursor += d;
      maxCursor = Math.max(maxCursor, cursor);
    }

    const hasStartRepeat = childElements(measure).some(
      (el) =>
        el.tagName === "barline" &&
        childElements(el).some(
          (r) => r.tagName === "repeat" && r.getAttribute("direction") === "forward",
        ),
    );

    bars.push({
      measure,
      divisions,
      barBeats: (beats * 4) / beatType,
      contentBeats: maxCursor / divisions,
      hasStartRepeat,
    });
  }
  return bars.length > 0 ? bars : null;
}

/** Returns the score text with the dropped opening rests put back, or the original text. */
export function restoreRestAfterRepeat(source: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return source;
  }
  const parts = Array.from(doc.getElementsByTagName("part"));
  if (parts.length < 2) return source; // needs another part to compare against

  const read = parts.map(readBars);
  if (read.some((entry) => entry === null)) return source;
  const bars = read as BarInfo[][];

  let changed = false;
  const barCount = Math.max(...bars.map((list) => list.length));
  for (let index = 0; index < barCount; index += 1) {
    const column = bars.map((list) => list[index]).filter((bar): bar is BarInfo => !!bar);
    if (!column.some((bar) => bar.hasStartRepeat)) continue;

    const full = column.some((bar) => bar.contentBeats >= bar.barBeats - 0.01);
    if (!full) continue; // every part is short: a real pickup, leave it alone

    for (const bar of column) {
      const gapBeats = bar.barBeats - bar.contentBeats;
      if (gapBeats <= 0.01 || bar.contentBeats <= 0) continue;

      const shapes = splitIntoRests(gapBeats);
      if (!shapes) continue; // cannot be written as ordinary rests
      if (shapes.some((s) => Math.abs(s.beats * bar.divisions - Math.round(s.beats * bar.divisions)) > EPS))
        continue;

      const firstNote = childElements(bar.measure).find((el) => el.tagName === "note");
      if (!firstNote) continue;
      // If the bar already opens with a rest, the recogniser did read one and
      // the shortfall is something else: do not guess.
      if (directChild(firstNote, "rest")) continue;

      const voice = directChild(firstNote, "voice")?.textContent?.trim() || "1";
      const staff = directChild(firstNote, "staff")?.textContent?.trim();

      for (const shape of shapes) {
        const note = doc.createElement("note");
        note.appendChild(doc.createElement("rest"));
        const dur = doc.createElement("duration");
        dur.textContent = String(Math.round(shape.beats * bar.divisions));
        note.appendChild(dur);
        const v = doc.createElement("voice");
        v.textContent = voice;
        note.appendChild(v);
        const type = doc.createElement("type");
        type.textContent = shape.type;
        note.appendChild(type);
        for (let i = 0; i < shape.dots; i += 1) note.appendChild(doc.createElement("dot"));
        if (staff) {
          const s = doc.createElement("staff");
          s.textContent = staff;
          note.appendChild(s);
        }
        bar.measure.insertBefore(note, firstNote);
      }
      changed = true;
    }
  }

  if (!changed) return source;
  return new XMLSerializer().serializeToString(doc);
}
