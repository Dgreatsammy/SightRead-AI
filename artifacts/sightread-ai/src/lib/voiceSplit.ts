/**
 * Playback-only voice separation.
 *
 * The drawn score is left exactly as OMR recognised it. This module is used
 * ONLY by the playback parser (parseMusicXml) on its own parsed copy of the
 * document, so a singer can listen to Soprano / Alto / Tenor / Bass
 * individually even when the notation shows them as stacked chords.
 *
 * Real Audiveris output for a two-voice choral staff (soprano over alto, or
 * tenor over bass) mixes several conventions inside ONE staff:
 *   - thirds and other intervals written as stacked two-note chords,
 *   - unisons written as a single note, or as a second voice after <backup>,
 *   - a few stray fragments of a third voice.
 * So the lower voice cannot be read off any single convention. Instead, each
 * measure is rebuilt by TIME: at every moment a note starts, the highest note
 * belongs to the upper voice and the lowest to the lower voice. A lone note
 * that nothing else covers is a unison, so it is copied into the lower voice.
 */

const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

// A part is treated as a two-voice choral staff only if:
//   - it has at least this many note onsets in total, and
//   - at least MIN_MULTI_RATIO of them have 2+ notes sounding together, and
//   - at least MIN_PAIR_SHARE of those are exactly two notes.
// A single-voice melody (no simultaneous notes) or a piano-style staff
// (chords of 3+) is therefore left completely alone.
const MIN_ONSETS = 4;
const MIN_MULTI_RATIO = 0.5;
const MIN_PAIR_SHARE = 0.6;
const EPS = 1e-6;

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1,
  );
}

function directChild(parent: Element, tag: string): Element | undefined {
  return childElements(parent).find((el) => el.tagName === tag);
}

function pitchValue(note: Element): number | null {
  const pitch = directChild(note, "pitch");
  if (!pitch) return null;
  const step = STEP_SEMITONES[directChild(pitch, "step")?.textContent ?? ""];
  const octave = Number(directChild(pitch, "octave")?.textContent);
  const alterText = directChild(pitch, "alter")?.textContent;
  const alter = alterText ? Number(alterText) : 0;
  if (step === undefined || !Number.isFinite(octave) || !Number.isFinite(alter))
    return null;
  return octave * 12 + step + alter;
}

function noteDuration(note: Element): number | null {
  const value = Number(directChild(note, "duration")?.textContent);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Sets <voice> on a note, creating it in schema position if missing. */
function setVoice(doc: Document, note: Element, voice: string): void {
  const existing = directChild(note, "voice");
  if (existing) {
    existing.textContent = voice;
    return;
  }
  const el = doc.createElement("voice");
  el.textContent = voice;
  // MusicXML order: ... duration, tie*, voice, type ...
  const anchor = [...childElements(note)]
    .reverse()
    .find((c) => c.tagName === "duration" || c.tagName === "tie");
  if (anchor) note.insertBefore(el, anchor.nextSibling);
  else note.appendChild(el);
}

/** One note or rest as the timeline sees it. */
type Ev = {
  el: Element;
  start: number;
  dur: number;
  midi: number | null; // null = rest
  voice: string;
};

/**
 * Reads a measure into timed events (following <backup> and <forward>).
 * Returns null if the measure contains anything that makes timing unsafe to
 * rebuild (grace or unpitched notes, a note with no duration or unreadable
 * pitch, another staff).
 */
function readMeasure(measure: Element): Ev[] | null {
  const events: Ev[] = [];
  let cursor = 0;
  let lastStart = 0;
  for (const child of childElements(measure)) {
    if (child.tagName === "backup" || child.tagName === "forward") {
      const d = Number(directChild(child, "duration")?.textContent);
      if (!Number.isFinite(d) || d < 0) return null;
      cursor =
        child.tagName === "backup" ? Math.max(0, cursor - d) : cursor + d;
      continue;
    }
    if (child.tagName !== "note") continue;
    if (directChild(child, "grace") || directChild(child, "unpitched"))
      return null;
    const staff = directChild(child, "staff")?.textContent?.trim();
    if (staff && staff !== "1") return null;
    const dur = noteDuration(child);
    if (dur === null) return null;
    const isRest = !!directChild(child, "rest");
    const midi = isRest ? null : pitchValue(child);
    if (!isRest && midi === null) return null;
    const isChord = !!directChild(child, "chord");
    const start = isChord ? lastStart : cursor;
    if (!isChord) {
      lastStart = cursor;
      cursor += dur;
    }
    events.push({
      el: child,
      start,
      dur,
      midi,
      voice: directChild(child, "voice")?.textContent?.trim() || "1",
    });
  }
  return events;
}

/** Counts, per measure, how many onsets have 1, 2 or 3+ notes sounding. */
function onsetStats(events: Ev[]) {
  const byStart = new Map<number, number>();
  for (const ev of events) {
    if (ev.midi === null) continue;
    const key = Math.round(ev.start * 1000);
    byStart.set(key, (byStart.get(key) ?? 0) + 1);
  }
  let onsets = 0;
  let multi = 0;
  let pairs = 0;
  for (const count of byStart.values()) {
    onsets++;
    if (count >= 2) multi++;
    if (count === 2) pairs++;
  }
  return { onsets, multi, pairs };
}

/** Lines of the rebuilt measure; null if timing can't be made consistent. */
function planMeasure(events: Ev[]): { upper: Ev[]; lower: Ev[] } | null {
  const pitched = events.filter((ev) => ev.midi !== null);
  if (pitched.length === 0) return null; // rest-only bar: nothing to split

  const byStart = new Map<number, Ev[]>();
  for (const ev of pitched) {
    const key = Math.round(ev.start * 1000);
    const list = byStart.get(key);
    if (list) list.push(ev);
    else byStart.set(key, [ev]);
  }

  const upper: Ev[] = [];
  const lower: Ev[] = [];
  for (const key of [...byStart.keys()].sort((a, b) => a - b)) {
    const group = byStart.get(key)!;
    group.sort((a, b) => b.midi! - a.midi!); // stable: highest first
    if (group.length >= 2) {
      upper.push(group[0]);
      lower.push(group[group.length - 1]); // extra middle notes are dropped
    } else if (group[0].voice === "1") {
      upper.push(group[0]);
    } else {
      lower.push(group[0]);
    }
  }
  // Rests stay with the voice they were written in.
  for (const ev of events) {
    if (ev.midi !== null) continue;
    if (ev.voice === "1") upper.push(ev);
    else lower.push(ev);
  }

  // A note nothing else sounds under is a unison: copy it into the lower voice.
  const covered = (line: Ev[], at: number) =>
    line.some((ev) => ev.start <= at + EPS && at < ev.start + ev.dur - EPS);
  for (const ev of [...upper]) {
    if (ev.midi === null) continue;
    if (!covered(lower, ev.start)) {
      lower.push({
        ...ev,
        el: ev.el.cloneNode(true) as Element,
        voice: "2",
      });
    }
  }

  const byTime = (a: Ev, b: Ev) => a.start - b.start || a.dur - b.dur;
  upper.sort(byTime);
  lower.sort(byTime);

  // Within one line nothing may overlap, otherwise timing would be wrong.
  for (const line of [upper, lower]) {
    for (let i = 1; i < line.length; i++) {
      if (line[i].start < line[i - 1].start + line[i - 1].dur - EPS) return null;
    }
  }
  return { upper, lower };
}

const signature = (items: Array<{ voice: string; start: number; dur: number; midi: number | null }>) =>
  items
    .map((i) => `${i.voice}|${i.start}|${i.dur}|${i.midi}`)
    .sort()
    .join(";");

function makeRest(doc: Document, dur: number, voice: string): Element {
  const note = doc.createElement("note");
  note.appendChild(doc.createElement("rest"));
  const d = doc.createElement("duration");
  d.textContent = String(dur);
  note.appendChild(d);
  const v = doc.createElement("voice");
  v.textContent = voice;
  note.appendChild(v);
  return note;
}

/** Turns a line of events into elements, filling gaps with rests. */
function buildLine(
  doc: Document,
  line: Ev[],
  voice: string,
  padTo: number,
): { elements: Element[]; end: number } {
  const elements: Element[] = [];
  let cursor = 0;
  for (const ev of line) {
    if (ev.start > cursor + EPS) {
      elements.push(makeRest(doc, ev.start - cursor, voice));
      cursor = ev.start;
    }
    const el = ev.el;
    const chord = directChild(el, "chord");
    if (chord) el.removeChild(chord);
    for (const child of Array.from(el.childNodes)) {
      const tag = (child as Element).tagName;
      // Lyrics, beams and notation marks belong to the drawn score only.
      if (voice === "2" && (tag === "lyric" || tag === "notations" || tag === "beam"))
        el.removeChild(child);
    }
    setVoice(doc, el, voice);
    elements.push(el);
    cursor = ev.start + ev.dur;
  }
  if (padTo > cursor + EPS) {
    elements.push(makeRest(doc, padTo - cursor, voice));
    cursor = padTo;
  }
  return { elements, end: cursor };
}

export function splitStackedChordsIntoVoices(doc: Document): boolean {
  let changed = false;
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    if (trySplitPart(doc, part)) changed = true;
  }
  return changed;
}

function trySplitPart(doc: Document, part: Element): boolean {
  const measures = childElements(part).filter((el) => el.tagName === "measure");
  if (measures.length === 0) return false;

  // Gate on the part as a whole (see the constants above).
  const read = measures.map((measure) => ({ measure, events: readMeasure(measure) }));
  let onsets = 0;
  let multi = 0;
  let pairs = 0;
  for (const { events } of read) {
    if (!events) continue;
    const stats = onsetStats(events);
    onsets += stats.onsets;
    multi += stats.multi;
    pairs += stats.pairs;
  }
  if (onsets < MIN_ONSETS) return false;
  if (multi / onsets < MIN_MULTI_RATIO) return false;
  if (pairs / multi < MIN_PAIR_SHARE) return false;

  let changed = false;
  for (const { measure, events } of read) {
    if (!events) continue;
    const plan = planMeasure(events);
    if (!plan) continue;

    // Already in the desired shape? Then leave the measure completely alone.
    // Only sounding notes are compared (filler rests don't matter).
    const planned = [
      ...plan.upper.map((e) => ({ ...e, voice: "1" })),
      ...plan.lower.map((e) => ({ ...e, voice: "2" })),
    ].filter((e) => e.midi !== null);
    const original = events.filter((e) => e.midi !== null);
    if (signature(planned) === signature(original)) continue;

    // Rebuild: upper line, <backup>, lower line - in place of the old notes.
    const oldNodes = childElements(measure).filter(
      (el) =>
        el.tagName === "note" ||
        el.tagName === "backup" ||
        el.tagName === "forward",
    );
    const last = oldNodes[oldNodes.length - 1];
    const anchor: Node | null = last.nextSibling;
    for (const node of oldNodes) measure.removeChild(node);

    const endAll = Math.max(
      ...plan.upper.map((e) => e.start + e.dur),
      ...plan.lower.map((e) => e.start + e.dur),
    );
    const upper = buildLine(doc, plan.upper, "1", endAll);
    const lower = buildLine(doc, plan.lower, "2", 0);
    for (const el of upper.elements) measure.insertBefore(el, anchor);
    const backup = doc.createElement("backup");
    const duration = doc.createElement("duration");
    duration.textContent = String(upper.end);
    backup.appendChild(duration);
    measure.insertBefore(backup, anchor);
    for (const el of lower.elements) measure.insertBefore(el, anchor);
    changed = true;
  }
  return changed;
}
