/**
 * Measures how accurately a recognised score (Audiveris output) matches the
 * TRUE score for the same piece (a clean MusicXML file, for example from CPDL).
 *
 * The comparison is deliberately independent of how each file is organised:
 * a true score may keep Soprano, Alto, Tenor and Bass in four parts while the
 * recogniser puts them in two staves as stacked chords, and the recogniser may
 * split one printed bar into two measures. So notes are compared as a timeline
 * of "what pitches start together", aligned like text is aligned for a spell
 * check, not by bar number or part.
 *
 * Everything here is a number, so a change can be judged as better or worse
 * instead of argued about by ear. Lower-case words are used in the report.
 */

export interface AccuracyEvent {
  start: number; // beats from the start of the piece
  pitches: number[]; // distinct MIDI pitches starting together, highest first
  duration: number; // length of the highest (melody) note starting here, in beats
}

export interface ScoreSummary {
  parts: number;
  measures: number;
  totalBeats: number;
  keyFifths: number | null;
  timeSignature: string | null;
  firstMeasureBeats: number | null;
  events: AccuracyEvent[];
  lyricWords: string[];
  dynamics: number;
  trills: number;
}

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function kids(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((n): n is Element => n.nodeType === 1);
}
const kid = (parent: Element, tag: string) => kids(parent).find((e) => e.tagName === tag);

type RawNote = { start: number; dur: number; midi: number | null; lyric?: { text: string; syllabic: string } };

function readPart(part: Element) {
  const measures: Array<{ notes: RawNote[]; content: number; divisions: number }> = [];
  let divisions = 1;
  let timeSignature: string | null = null;
  let keyFifths: number | null = null;
  let lyricCount = 0;
  for (const measure of kids(part).filter((e) => e.tagName === "measure")) {
    for (const attributes of kids(measure).filter((e) => e.tagName === "attributes")) {
      const d = Number(kid(attributes, "divisions")?.textContent);
      if (Number.isFinite(d) && d > 0) divisions = d;
      const time = kid(attributes, "time");
      if (time && timeSignature === null) {
        const b = kid(time, "beats")?.textContent?.trim();
        const t = kid(time, "beat-type")?.textContent?.trim();
        if (b && t) timeSignature = `${b}/${t}`;
      }
      const key = kid(attributes, "key");
      if (key && keyFifths === null) {
        const f = Number(kid(key, "fifths")?.textContent);
        if (Number.isFinite(f)) keyFifths = f;
      }
    }
    let cursor = 0;
    let lastStart = 0;
    let maxCursor = 0;
    const notes: RawNote[] = [];
    for (const child of kids(measure)) {
      if (child.tagName === "backup" || child.tagName === "forward") {
        const d = Number(kid(child, "duration")?.textContent) || 0;
        cursor = child.tagName === "backup" ? Math.max(0, cursor - d) : cursor + d;
        maxCursor = Math.max(maxCursor, cursor);
        continue;
      }
      if (child.tagName !== "note" || kid(child, "grace")) continue;
      const d = Number(kid(child, "duration")?.textContent);
      if (!Number.isFinite(d) || d <= 0) continue;
      const isChord = !!kid(child, "chord");
      const start = isChord ? lastStart : cursor;
      if (!isChord) {
        lastStart = cursor;
        cursor += d;
      }
      maxCursor = Math.max(maxCursor, cursor);
      let midi: number | null = null;
      const pitch = kid(child, "pitch");
      if (pitch && !kid(child, "rest")) {
        const step = STEP[kid(pitch, "step")?.textContent ?? ""];
        const octave = Number(kid(pitch, "octave")?.textContent);
        const alter = Number(kid(pitch, "alter")?.textContent ?? 0) || 0;
        if (step !== undefined && Number.isFinite(octave)) midi = (octave + 1) * 12 + step + alter;
      }
      const note: RawNote = { start, dur: d, midi };
      const lyric = kids(child).find(
        (e) => e.tagName === "lyric" && (!e.getAttribute("number") || e.getAttribute("number") === "1"),
      );
      if (lyric) {
        const text = kid(lyric, "text")?.textContent ?? "";
        if (text.trim()) {
          note.lyric = { text, syllabic: kid(lyric, "syllabic")?.textContent?.trim() ?? "single" };
          lyricCount++;
        }
      }
      notes.push(note);
    }
    measures.push({ notes, content: maxCursor / divisions, divisions });
  }
  return { measures, timeSignature, keyFifths, lyricCount };
}

/** Folds accents and drops punctuation so "blessèd," and "blessed" compare equal. */
export function normaliseWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function summariseScore(xml: string): ScoreSummary {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parts = Array.from(doc.getElementsByTagName("part")).map(readPart);
  const measureCount = Math.max(0, ...parts.map((p) => p.measures.length));
  const lengths = Array.from({ length: measureCount }, (_, i) =>
    Math.max(0, ...parts.map((p) => p.measures[i]?.content ?? 0)),
  );
  const offsets: number[] = [];
  let running = 0;
  for (const len of lengths) {
    offsets.push(running);
    running += len;
  }

  const byStart = new Map<number, Map<number, number>>(); // start -> pitch -> length
  for (const part of parts) {
    part.measures.forEach((m, i) => {
      for (const n of m.notes) {
        if (n.midi === null) continue;
        const start = Math.round((offsets[i] + n.start / m.divisions) * 1000) / 1000;
        const dur = n.dur / m.divisions;
        const slot = byStart.get(start) ?? new Map<number, number>();
        slot.set(n.midi, Math.max(slot.get(n.midi) ?? 0, dur));
        byStart.set(start, slot);
      }
    });
  }
  const events: AccuracyEvent[] = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, slot]) => {
      const pitches = [...slot.keys()].sort((a, b) => b - a);
      return { start, pitches, duration: slot.get(pitches[0]) ?? 0 };
    });

  // Lyrics: from the part that carries the most verse-1 syllables.
  const lyricPart = [...parts].sort((a, b) => b.lyricCount - a.lyricCount)[0];
  const words: string[] = [];
  if (lyricPart && lyricPart.lyricCount > 0) {
    let current = "";
    for (const m of lyricPart.measures) {
      for (const n of m.notes) {
        if (!n.lyric) continue;
        current += n.lyric.text;
        if (n.lyric.syllabic === "single" || n.lyric.syllabic === "end") {
          const word = normaliseWord(current);
          if (word) words.push(word);
          current = "";
        }
      }
    }
    const tail = normaliseWord(current);
    if (tail) words.push(tail);
  }

  const first = parts[0];
  return {
    parts: parts.length,
    measures: measureCount,
    totalBeats: Math.round(running * 1000) / 1000,
    keyFifths: parts.map((p) => p.keyFifths).find((k) => k !== null) ?? null,
    timeSignature: parts.map((p) => p.timeSignature).find((t) => t !== null) ?? null,
    firstMeasureBeats: first?.measures[0] ? first.measures[0].content : null,
    events,
    lyricWords: words,
    dynamics: doc.getElementsByTagName("dynamics").length,
    trills: doc.getElementsByTagName("trill-mark").length,
  };
}

/** Plain edit-distance alignment. Returns total cost and the matched index pairs. */
export function align<T>(
  truth: T[],
  recognised: T[],
  substitutionCost: (a: T, b: T) => number,
): { cost: number; pairs: Array<[number, number, number]>; missed: number[]; extra: number[] } {
  const n = truth.length;
  const m = recognised.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i;
  for (let j = 1; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + substitutionCost(truth[i - 1], recognised[j - 1]),
      );
    }
  }
  const pairs: Array<[number, number, number]> = [];
  const missed: number[] = [];
  const extra: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const c = substitutionCost(truth[i - 1], recognised[j - 1]);
      if (Math.abs(dp[i][j] - (dp[i - 1][j - 1] + c)) < 1e-9) {
        pairs.push([i - 1, j - 1, c]);
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + 1)) < 1e-9) {
      missed.push(i - 1);
      i--;
    } else {
      extra.push(j - 1);
      j--;
    }
  }
  pairs.reverse();
  missed.reverse();
  extra.reverse();
  return { cost: dp[n][m], pairs, missed, extra };
}

const jaccardCost = (a: AccuracyEvent, b: AccuracyEvent) => {
  const sa = new Set(a.pitches);
  const inter = b.pitches.filter((p) => sa.has(p)).length;
  const union = sa.size + b.pitches.length - inter;
  return union === 0 ? 0 : 1 - inter / union;
};

const pct = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;

export interface AccuracyReport {
  chordAccuracy: number; // % of true note-groups found with the right pitches
  melodyAccuracy: number; // top line, % pitches right in order
  bassAccuracy: number; // bottom line, % pitches right in order
  rhythmAccuracy: number; // % of matched note-groups whose melody note has the right length
  missedGroups: number;
  extraGroups: number;
  trueGroups: number;
  lyricWordAccuracy: number | null;
  lyricMistakes: Array<{ truth: string; recognised: string }>;
  structure: {
    key: { truth: number | null; recognised: number | null; ok: boolean };
    timeSignature: { truth: string | null; recognised: string | null; ok: boolean };
    measures: { truth: number; recognised: number };
    totalBeats: { truth: number; recognised: number };
    firstMeasureBeats: { truth: number | null; recognised: number | null };
  };
  inventedDynamics: number;
  inventedTrills: number;
}

export function compareScores(truthXml: string, recognisedXml: string): AccuracyReport {
  const truth = summariseScore(truthXml);
  const rec = summariseScore(recognisedXml);

  const whole = align(truth.events, rec.events, jaccardCost);
  const chordHits = whole.pairs.reduce((sum, [, , cost]) => sum + (1 - cost), 0);
  const chordAccuracy = truth.events.length ? chordHits / truth.events.length : 1;
  const rhythmMatches = whole.pairs.filter(
    ([i, j, cost]) => cost < 0.5 && Math.abs(truth.events[i].duration - rec.events[j].duration) < 0.01,
  ).length;
  const rhythmEligible = whole.pairs.filter(([, , cost]) => cost < 0.5).length;

  const topCost = (a: number, b: number) => (a === b ? 0 : 1);
  const melody = align(
    truth.events.map((e) => e.pitches[0]),
    rec.events.map((e) => e.pitches[0]),
    topCost,
  );
  const bass = align(
    truth.events.map((e) => e.pitches[e.pitches.length - 1]),
    rec.events.map((e) => e.pitches[e.pitches.length - 1]),
    topCost,
  );

  const wordCost = (a: string, b: string) => (a === b ? 0 : 1);
  const words = align(truth.lyricWords, rec.lyricWords, wordCost);
  const lyricMistakes: Array<{ truth: string; recognised: string }> = [];
  for (const [i, j, cost] of words.pairs) {
    if (cost > 0 && lyricMistakes.length < 12) {
      lyricMistakes.push({ truth: truth.lyricWords[i], recognised: rec.lyricWords[j] });
    }
  }
  for (const i of words.missed) {
    if (lyricMistakes.length < 12) lyricMistakes.push({ truth: truth.lyricWords[i], recognised: "(missing)" });
  }

  return {
    chordAccuracy: pct(chordAccuracy),
    melodyAccuracy: pct(truth.events.length ? 1 - melody.cost / truth.events.length : 1),
    bassAccuracy: pct(truth.events.length ? 1 - bass.cost / truth.events.length : 1),
    rhythmAccuracy: pct(rhythmEligible ? rhythmMatches / rhythmEligible : 1),
    missedGroups: whole.missed.length,
    extraGroups: whole.extra.length,
    trueGroups: truth.events.length,
    lyricWordAccuracy: truth.lyricWords.length
      ? pct(1 - words.cost / truth.lyricWords.length)
      : null,
    lyricMistakes,
    structure: {
      key: {
        truth: truth.keyFifths,
        recognised: rec.keyFifths,
        ok: truth.keyFifths === rec.keyFifths,
      },
      timeSignature: {
        truth: truth.timeSignature,
        recognised: rec.timeSignature,
        ok: truth.timeSignature === rec.timeSignature,
      },
      measures: { truth: truth.measures, recognised: rec.measures },
      totalBeats: { truth: truth.totalBeats, recognised: rec.totalBeats },
      firstMeasureBeats: { truth: truth.firstMeasureBeats, recognised: rec.firstMeasureBeats },
    },
    inventedDynamics: Math.max(0, rec.dynamics - truth.dynamics),
    inventedTrills: Math.max(0, rec.trills - truth.trills),
  };
}

/** A short plain-text summary, one block per piece. */
export function formatAccuracyReport(name: string, r: AccuracyReport): string {
  const lines = [
    `## ${name}`,
    `Notes (all voices together): ${r.chordAccuracy}% right  (${r.missedGroups} missed, ${r.extraGroups} extra, of ${r.trueGroups})`,
    `Melody (top line):  ${r.melodyAccuracy}% right`,
    `Bass (bottom line): ${r.bassAccuracy}% right`,
    `Rhythm (melody note lengths): ${r.rhythmAccuracy}% right`,
    r.lyricWordAccuracy === null
      ? "Words: no words in the true score"
      : `Words: ${r.lyricWordAccuracy}% of words right`,
    `Key: true ${r.structure.key.truth} / read ${r.structure.key.recognised} ${r.structure.key.ok ? "(ok)" : "(WRONG)"}`,
    `Time signature: true ${r.structure.timeSignature.truth} / read ${r.structure.timeSignature.recognised} ${r.structure.timeSignature.ok ? "(ok)" : "(WRONG)"}`,
    `Bars: true ${r.structure.measures.truth} / read ${r.structure.measures.recognised};  length in beats: true ${r.structure.totalBeats.truth} / read ${r.structure.totalBeats.recognised}`,
    `Invented marks: ${r.inventedDynamics} dynamics, ${r.inventedTrills} trills`,
  ];
  if (r.lyricMistakes.length) {
    lines.push(
      "Word mistakes: " + r.lyricMistakes.map((m) => `${m.truth} -> ${m.recognised}`).join(", "),
    );
  }
  return lines.join("\n");
}
