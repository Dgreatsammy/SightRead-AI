/**
 * Repeat signs (||: ... :||) and first/second endings, for PLAYBACK.
 *
 * The drawn sheet already shows the repeat signs; this makes the sound follow
 * them. The play order is worked out once, then the notes of repeated bars are
 * copied after each other, so the engine just plays a longer straight line.
 * The screen keeps using the ORIGINAL bar numbers through `order`.
 */
import type { PlaybackMeasure, PlaybackNote } from "./playback";

export interface RepeatEnding {
  start: number; // first measure of the ending
  stop: number; // last measure of the ending
  numbers: number[]; // which passes it is played on, e.g. [1] or [2] or [1, 2]
}

export interface RepeatMarks {
  /** Measures that open a repeated section (||:). */
  forward: number[];
  /** Measures that close one (:||), with how many EXTRA times to play it. */
  backward: Array<{ measure: number; times: number }>;
  endings: RepeatEnding[];
}

export const NO_REPEATS: RepeatMarks = { forward: [], backward: [], endings: [] };

export function hasRepeats(marks: RepeatMarks | undefined): boolean {
  return !!marks && (marks.forward.length > 0 || marks.backward.length > 0);
}

const MAX_EXTRA_TIMES = 8;

/** Reads repeat signs from the `<barline>` elements of every part. */
export function readRepeatMarks(parts: Element[]): RepeatMarks {
  const forward = new Set<number>();
  const backward = new Map<number, number>();
  const endings: RepeatEnding[] = [];
  const kids = (el: Element) =>
    Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);

  for (const part of parts) {
    const measures = kids(part).filter((el) => el.tagName === "measure");
    const open = new Map<string, number>(); // ending numbers -> start measure
    measures.forEach((measure, index) => {
      for (const barline of kids(measure).filter((el) => el.tagName === "barline")) {
        const repeat = kids(barline).find((el) => el.tagName === "repeat");
        if (repeat) {
          const direction = repeat.getAttribute("direction");
          if (direction === "forward") forward.add(index);
          if (direction === "backward") {
            const t = Number(repeat.getAttribute("times"));
            // "times" in MusicXML is the TOTAL number of plays; 2 means repeat once.
            const extra = Number.isFinite(t) && t >= 2 ? Math.min(MAX_EXTRA_TIMES, t - 1) : 1;
            backward.set(index, Math.max(backward.get(index) ?? 0, extra));
          }
        }
        const ending = kids(barline).find((el) => el.tagName === "ending");
        if (ending) {
          const numbers = (ending.getAttribute("number") ?? "")
            .split(/[,\s]+/)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0);
          const key = numbers.join(",");
          const type = ending.getAttribute("type");
          if (type === "start" && numbers.length) open.set(key, index);
          if ((type === "stop" || type === "discontinue") && open.has(key)) {
            const start = open.get(key)!;
            open.delete(key);
            if (!endings.some((e) => e.start === start && e.stop === index)) {
              endings.push({ start, stop: index, numbers });
            }
          }
        }
      }
    });
  }
  return {
    forward: [...forward].sort((a, b) => a - b),
    backward: [...backward.entries()]
      .map(([measure, times]) => ({ measure, times }))
      .sort((a, b) => a.measure - b.measure),
    endings: endings.sort((a, b) => a.start - b.start),
  };
}

/**
 * The order bars are played in, as original bar indices (0-based).
 * Without repeat signs this is simply 0, 1, 2, ... n-1.
 */
export function buildPlayOrder(measureCount: number, marks: RepeatMarks | undefined): number[] {
  const straight = Array.from({ length: measureCount }, (_, i) => i);
  if (!marks || !hasRepeats(marks) || measureCount === 0) return straight;

  const forward = new Set(marks.forward);
  const backward = new Map(marks.backward.map((b) => [b.measure, b.times]));
  const endingAt = new Map(marks.endings.map((e) => [e.start, e]));
  const limit = measureCount * (MAX_EXTRA_TIMES + 2) + 16;

  const order: number[] = [];
  const done = new Map<number, number>(); // closing bar -> extra plays already done
  // After a repeated section ends, the bars that follow (a second ending) need to
  // know which pass just finished.
  let carry = null as { at: number; pass: number } | null;
  let sectionStart = 0;
  let i = 0;
  while (i < measureCount && order.length < limit) {
    const ending = endingAt.get(i);
    if (ending) {
      const closing = firstClosingAtOrAfter(i, backward);
      const pass: number =
        carry && carry.at === i
          ? carry.pass
          : (closing === null ? 0 : (done.get(closing) ?? 0)) + 1;
      if (!ending.numbers.includes(pass)) {
        // Not played on this pass: skip it. The repeat is over, so the next
        // ending belongs to the same pass.
        if (closing !== null) {
          done.delete(closing);
          sectionStart = closing + 1;
        }
        carry = { at: ending.stop + 1, pass };
        i = ending.stop + 1;
        continue;
      }
    }
    if (forward.has(i)) sectionStart = i;
    order.push(i);
    const extra = backward.get(i);
    if (extra !== undefined) {
      const already = done.get(i) ?? 0;
      if (already < extra) {
        done.set(i, already + 1);
        i = sectionStart;
        continue;
      }
      done.delete(i);
      sectionStart = i + 1;
      carry = { at: i + 1, pass: already + 1 };
    }
    i++;
  }
  return order;
}

function firstClosingAtOrAfter(from: number, backward: Map<number, number>): number | null {
  let best: number | null = null;
  for (const measure of backward.keys()) {
    if (measure >= from && (best === null || measure < best)) best = measure;
  }
  return best;
}

export interface UnrolledTimeline {
  notes: PlaybackNote[];
  measures: PlaybackMeasure[];
  /** For each played bar, the original bar index it came from. */
  order: number[];
}

/** Copies notes and bars so that repeated sections appear one after the other. */
export function unrollForRepeats(
  notes: PlaybackNote[],
  measures: PlaybackMeasure[],
  order: number[],
): UnrolledTimeline {
  const straight = order.length === measures.length && order.every((m, i) => m === i);
  if (straight) return { notes, measures, order };

  const byMeasure = new Map<number, PlaybackNote[]>();
  for (const note of notes) {
    const list = byMeasure.get(note.measureIndex);
    if (list) list.push(note);
    else byMeasure.set(note.measureIndex, [note]);
  }
  const outMeasures: PlaybackMeasure[] = [];
  const outNotes: PlaybackNote[] = [];
  let cursor = measures[0]?.startBeat ?? 0;
  order.forEach((original, played) => {
    const source = measures[original];
    if (!source) return;
    outMeasures.push({ ...source, index: played, startBeat: cursor });
    for (const note of byMeasure.get(original) ?? []) {
      outNotes.push({
        ...note,
        startBeat: cursor + (note.startBeat - source.startBeat),
        measureIndex: played,
      });
    }
    cursor += source.durationBeats;
  });
  return { notes: outNotes, measures: outMeasures, order };
}

/**
 * Turns a range of ORIGINAL bars (what the person chose) into the matching range
 * of played bars: from the first time the first bar is played to the last time
 * the last bar is played, so a loop covers any repeats inside it.
 */
export function toPlayedRange(
  order: number[],
  originalStart: number,
  originalEnd: number,
): [number, number] {
  let first = order.indexOf(originalStart);
  let last = order.lastIndexOf(originalEnd);
  if (first < 0) first = 0;
  if (last < 0) last = Math.max(0, order.length - 1);
  if (last < first) last = first;
  return [first, last];
}

/** The played-bar index to jump to for an original bar (its first play). */
export function toPlayedMeasure(order: number[], originalIndex: number): number {
  const found = order.indexOf(originalIndex);
  return found >= 0 ? found : 0;
}
