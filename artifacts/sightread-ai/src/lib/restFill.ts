/**
 * Draws the rests that optical music recognition failed to read.
 *
 * When a bar's notes add up to less than the bar really lasts, the player
 * keeps that time as silence. Without this module that silence has no rest
 * symbol on the sheet, which looks like the app is pausing for no reason.
 * This adds an ordinary rest where the player is already silent, using the
 * SAME bar-length decisions as playback (resolveMeasureDurations), so what
 * you see and what you hear agree.
 *
 * It only ever ADDS rests at the end of a bar. It never moves, removes or changes a
 * note. If nothing needs filling, the original text is returned unchanged.
 * Only the main line (voice 1) is filled; stray extra voices are left alone.
 */
import { resolveMeasureDurations, type MeasureProbe } from "./playback";

const EPS = 1e-6;

// Standard rest lengths in beats (quarter notes), longest first.
const REST_SHAPES: Array<{ beats: number; type: string; dots: number }> = [
  { beats: 4, type: "whole", dots: 0 },
  { beats: 3, type: "half", dots: 1 },
  { beats: 2, type: "half", dots: 0 },
  { beats: 1.5, type: "quarter", dots: 1 },
  { beats: 1, type: "quarter", dots: 0 },
  { beats: 0.75, type: "eighth", dots: 1 },
  { beats: 0.5, type: "eighth", dots: 0 },
  { beats: 0.25, type: "16th", dots: 0 },
];

/** Splits a gap into standard rests, or null if it can't be written exactly. */
export function splitIntoRests(beats: number) {
  const shapes: typeof REST_SHAPES = [];
  let left = beats;
  while (left > EPS) {
    const shape = REST_SHAPES.find((s) => s.beats <= left + EPS);
    if (!shape) return null; // shorter than a 16th, or not a multiple of it
    shapes.push(shape);
    left -= shape.beats;
  }
  return left < -EPS ? null : shapes;
}

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

function directChild(parent: Element, tag: string): Element | undefined {
  return childElements(parent).find((el) => el.tagName === tag);
}

type MeasureInfo = {
  measure: Element;
  divisions: number;
  maxCursor: number; // in divisions
  lastCursor: number; // cursor after the last element, in divisions
  voiceEnds: Map<string, number>;
  voiceStaff: Map<string, string | undefined>;
  lastNode: Element | null;
};

function readPart(part: Element): { infos: MeasureInfo[]; probe: MeasureProbe } | null {
  const infos: MeasureInfo[] = [];
  const probe: MeasureProbe = { content: [], bar: [] };
  let divisions = 0;
  // Same defaults as the playback parser when a score has no time signature.
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
    let lastStart = 0;
    let maxCursor = 0;
    let lastNode: Element | null = null;
    const voiceEnds = new Map<string, number>();
    const voiceStaff = new Map<string, string | undefined>();

    for (const child of childElements(measure)) {
      if (child.tagName === "backup" || child.tagName === "forward") {
        const d = Number(directChild(child, "duration")?.textContent);
        if (!Number.isFinite(d) || d < 0) return null;
        cursor = child.tagName === "backup" ? Math.max(0, cursor - d) : cursor + d;
        maxCursor = Math.max(maxCursor, cursor);
        lastNode = child;
        continue;
      }
      if (child.tagName !== "note") continue;
      lastNode = child;
      if (directChild(child, "grace")) continue;
      const d = Number(directChild(child, "duration")?.textContent);
      if (!Number.isFinite(d) || d <= 0) return null;
      const isChord = !!directChild(child, "chord");
      const start = isChord ? lastStart : cursor;
      if (!isChord) {
        lastStart = cursor;
        cursor += d;
      }
      maxCursor = Math.max(maxCursor, cursor);
      const voice = directChild(child, "voice")?.textContent?.trim() || "1";
      voiceEnds.set(voice, Math.max(voiceEnds.get(voice) ?? 0, start + d));
      voiceStaff.set(voice, directChild(child, "staff")?.textContent?.trim());
    }

    infos.push({ measure, divisions, maxCursor, lastCursor: cursor, voiceEnds, voiceStaff, lastNode });
    probe.content.push(maxCursor / divisions);
    probe.bar.push((beats * 4) / beatType);
  }
  return infos.length > 0 ? { infos, probe } : null;
}

/**
 * Returns the score text with unread rests drawn in, or the original text
 * (identical) when there is nothing to add or the score cannot be read safely.
 */
export function fillMissingRests(source: string): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, "application/xml");
  } catch {
    return source;
  }
  const parts = Array.from(doc.getElementsByTagName("part"));
  if (parts.length === 0) return source;

  const read = parts.map(readPart);
  if (read.some((entry) => entry === null)) return source;
  const parsed = read as Array<NonNullable<ReturnType<typeof readPart>>>;
  const resolved = resolveMeasureDurations(parsed.map((entry) => entry.probe));

  let changed = false;
  parsed.forEach(({ infos }) => {
    infos.forEach((info, index) => {
      if (info.maxCursor <= 0 || info.voiceEnds.size === 0) return;
      const target = resolved[index] * info.divisions;
      const gapDivisions = target - info.maxCursor;
      if (gapDivisions <= EPS) return;
      const gapBeats = gapDivisions / info.divisions;
      const shapes = splitIntoRests(gapBeats);
      if (!shapes) return; // can't be written as ordinary rests: leave it
      const unit = Math.round(info.divisions);
      if (Math.abs(info.divisions - unit) > EPS && shapes.some((s) => (s.beats * info.divisions) % 1 > EPS))
        return;

      // Only the main line (voice 1) gets the rest, and only if it reaches the
      // end of the bar's notes. Stray fragment voices are left alone so the
      // sheet is not cluttered with rests for notes that are not really there.
      const voices =
        Math.abs((info.voiceEnds.get("1") ?? -1) - info.maxCursor) < EPS ? ["1"] : [];
      if (voices.length === 0) return;

      const anchor: Node | null = info.lastNode ? info.lastNode.nextSibling : null;
      let cursor = info.lastCursor;
      for (const voice of voices) {
        const move = cursor - info.maxCursor;
        if (move > EPS) {
          const backup = doc.createElement("backup");
          const dur = doc.createElement("duration");
          dur.textContent = String(move);
          backup.appendChild(dur);
          info.measure.insertBefore(backup, anchor);
        } else if (move < -EPS) {
          const forward = doc.createElement("forward");
          const dur = doc.createElement("duration");
          dur.textContent = String(-move);
          forward.appendChild(dur);
          info.measure.insertBefore(forward, anchor);
        }
        cursor = info.maxCursor;
        for (const shape of shapes) {
          const note = doc.createElement("note");
          note.appendChild(doc.createElement("rest"));
          const dur = doc.createElement("duration");
          dur.textContent = String(shape.beats * info.divisions);
          note.appendChild(dur);
          const v = doc.createElement("voice");
          v.textContent = voice;
          note.appendChild(v);
          const type = doc.createElement("type");
          type.textContent = shape.type;
          note.appendChild(type);
          for (let i = 0; i < shape.dots; i++) note.appendChild(doc.createElement("dot"));
          const staff = info.voiceStaff.get(voice);
          if (staff) {
            const s = doc.createElement("staff");
            s.textContent = staff;
            note.appendChild(s);
          }
          info.measure.insertBefore(note, anchor);
          cursor += shape.beats * info.divisions;
        }
        changed = true;
      }
    });
  });

  if (!changed) return source;
  return new XMLSerializer().serializeToString(doc);
}
