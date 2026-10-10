import { splitStackedChordsIntoVoices } from "./voiceSplit";

export type PlaybackState =
  | "stopped"
  | "playing"
  | "paused"
  | "counting-in"
  | "completed";
export type CountInBars = 0 | 1 | 2;

export interface PlaybackNote {
  startBeat: number;
  durationBeats: number;
  midi: number | null;
  measureIndex: number;
  isRest: boolean;
  /** "staff:voice" key from the MusicXML, used to isolate one voice in a part. */
  voice?: string;
}

export interface PlaybackMeasure {
  index: number;
  number: string;
  startBeat: number;
  durationBeats: number;
}

export interface PlaybackPart {
  id: string;
  name: string;
  displayName: string;
  tempo: number;
  notes: PlaybackNote[];
  measures: PlaybackMeasure[];
  beatsPerBar: number;
  beatUnitBeats: number;
  /** "part" = as written, "voice" = one voice of a part, "all" = every part together. */
  kind?: "part" | "voice" | "all";
}

export interface PlaybackScore {
  title: string;
  parts: PlaybackPart[];
  selectedPartId: string;
  tempo: number;
  notes: PlaybackNote[];
  measures: PlaybackMeasure[];
  beatsPerBar: number;
  beatUnitBeats: number;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentMeasure: number;
  currentNoteMidi: number | null;
  progress: number;
  positionBeat: number;
  durationBeats: number;
  countInBeat: number;
  countInBeatsTotal: number;
  loopCount: number;
}

function textOf(parent: Document | Element, tagName: string) {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? "";
}

function numberOf(parent: Element, tagName: string, fallback: number) {
  const raw = textOf(parent, tagName);
  if (raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function requiredDuration(note: Element) {
  const durationText = textOf(note, "duration");
  const duration = Number(durationText);
  if (!durationText || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(
      `The score contains a note with an invalid duration: ${note.outerHTML}`,
    );
  }
  return duration;
}

function pitchToMidi(note: Element) {
  const pitch = note.getElementsByTagName("pitch")[0];
  if (!pitch) return null;
  const step = textOf(pitch, "step").toUpperCase();
  const octave = Number(textOf(pitch, "octave"));
  const alter = Number(textOf(pitch, "alter") || "0");
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  if (
    !(step in semitones) ||
    !Number.isFinite(octave) ||
    !Number.isFinite(alter)
  )
    return null;
  return (octave + 1) * 12 + semitones[step] + alter;
}

function readTempo(measure: Element, fallback: number) {
  const sound = measure.getElementsByTagName("sound")[0];
  const soundTempo = sound ? Number(sound.getAttribute("tempo")) : NaN;
  if (Number.isFinite(soundTempo) && soundTempo > 0) return soundTempo;

  const perMinute = measure.getElementsByTagName("per-minute")[0];
  const metronomeTempo = perMinute ? Number(perMinute.textContent) : NaN;
  return Number.isFinite(metronomeTempo) && metronomeTempo > 0
    ? metronomeTempo
    : fallback;
}

export function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function beatsToSeconds(beats: number, tempo: number, speed = 1) {
  return (beats * 60) / (tempo * speed);
}

/**
 * How much music each measure actually contains, versus how long a full bar
 * is. Recorded per parsed part so measure lengths can be resolved across ALL
 * parts together (they must stay in step with one another).
 */
interface MeasureProbe {
  content: number[];
  bar: number[];
}
const measureProbes = new WeakMap<PlaybackPart, MeasureProbe>();

function approxEqual(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

/**
 * Decides how long each measure lasts in playback.
 *
 * A measure normally lasts a full bar, even if OMR dropped a note, so a
 * misread rhythm doesn't shift everything after it. Only genuinely short
 * measures are kept at their real length, because padding them is what
 * creates silent holds with no visible rest:
 *   - a pickup (anacrusis): a short FIRST measure followed by more music
 *   - a bar split across a line break, written as two short measures whose
 *     lengths add up to one bar or less (any missing beat becomes a single
 *     short silence instead of two long pauses)
 *   - a short LAST measure that completes the pickup
 * Lengths are taken as the longest content among all parts, so parts that
 * disagree about a measure still start every measure together.
 */
function resolveMeasureDurations(probes: MeasureProbe[]): number[] {
  const count = Math.max(0, ...probes.map((probe) => probe.content.length));
  const shared = Array.from({ length: count }, (_, index) =>
    Math.max(0, ...probes.map((probe) => probe.content[index] ?? 0)),
  );
  const bar = Array.from(
    { length: count },
    (_, index) => probes.find((probe) => probe.bar[index] !== undefined)?.bar[index] ?? 4,
  );
  const isShort = (index: number) =>
    index >= 0 &&
    index < count &&
    shared[index] > 0 &&
    shared[index] < bar[index] - 0.01;

  const result: number[] = new Array(count);
  let index = 0;
  while (index < count) {
    const content = shared[index];
    if (isShort(index) && index === 0 && count > 1) {
      // Pickup bar: keep its real length.
      result[index] = content;
      index += 1;
    } else if (
      isShort(index) &&
      isShort(index + 1) &&
      content + shared[index + 1] <= bar[index] + 0.01
    ) {
      // One bar written as two short measures (e.g. across a line break).
      // If a beat or two is missing (an unread rest), it is lost once, as a
      // short silence at the end, rather than as two long pauses.
      result[index] = content;
      result[index + 1] = bar[index] - content;
      index += 2;
    } else if (
      isShort(index) &&
      index === count - 1 &&
      isShort(0) &&
      approxEqual(shared[0] + content, bar[0])
    ) {
      // Short closing bar that completes the pickup.
      result[index] = content;
      index += 1;
    } else {
      result[index] = Math.max(bar[index], content, 0.25);
      index += 1;
    }
  }
  return result;
}

function parsePart(
  part: Element,
  id: string,
  displayName: string,
  durationOverrides?: number[],
): PlaybackPart {
  const measureElements = Array.from(part.getElementsByTagName("measure"));
  if (measureElements.length === 0) {
    throw new Error(
      `The MusicXML part "${displayName}" does not contain any measures.`,
    );
  }

  let divisions = 1;
  let beatsPerMeasure = 4;
  let beatType = 4;
  let tempo = 76;
  let absoluteMeasureStart = 0;
  let firstBeatsPerBar = 4;
  let firstBeatUnitBeats = 1;
  const notes: PlaybackNote[] = [];
  const measures: PlaybackMeasure[] = [];
  const probe: MeasureProbe = { content: [], bar: [] };

  measureElements.forEach((measureElement, measureIndex) => {
    const attributes = measureElement.getElementsByTagName("attributes")[0];
    if (attributes) {
      const parsedDivisions = numberOf(attributes, "divisions", divisions);
      if (!Number.isFinite(parsedDivisions) || parsedDivisions <= 0) {
        throw new Error(
          `The MusicXML part "${displayName}" contains invalid rhythmic divisions.`,
        );
      }
      divisions = parsedDivisions;
      const time = attributes.getElementsByTagName("time")[0];
      if (time) {
        beatsPerMeasure = Math.max(1, numberOf(time, "beats", beatsPerMeasure));
        beatType = Math.max(1, numberOf(time, "beat-type", beatType));
      }
    }
    if (measureIndex === 0) {
      firstBeatsPerBar = beatsPerMeasure;
      firstBeatUnitBeats = 4 / beatType;
    }
    tempo = readTempo(measureElement, tempo);

    let cursor = 0;
    let maxCursor = 0;
    let lastNoteStart = 0;
    const localNotes: Array<{
      start: number;
      duration: number;
      midi: number | null;
      isRest: boolean;
      voice: string;
    }> = [];

    Array.from(measureElement.children).forEach((child) => {
      const tagName = child.tagName.toLowerCase();
      if (tagName === "backup" || tagName === "forward") {
        const durationText = textOf(child, "duration");
        const duration = Number(durationText);
        if (!durationText || !Number.isFinite(duration) || duration < 0) {
          throw new Error(
            `The MusicXML part "${displayName}" contains an invalid backup or forward duration.`,
          );
        }
        if (tagName === "backup") {
          cursor = Math.max(0, cursor - duration);
        } else {
          cursor += duration;
          maxCursor = Math.max(maxCursor, cursor);
        }
        return;
      }
      if (tagName !== "note") return;

      const isGrace = child.getElementsByTagName("grace").length > 0;
      if (isGrace) return;

      const duration = requiredDuration(child);
      const isChord = child.getElementsByTagName("chord").length > 0;
      const start = isChord ? lastNoteStart : cursor;
      const isRest = child.getElementsByTagName("rest").length > 0;
      const isUnpitched = child.getElementsByTagName("unpitched").length > 0;

      if (isUnpitched) {
        if (!isChord) {
          lastNoteStart = cursor;
          cursor += duration;
        }
        maxCursor = Math.max(maxCursor, cursor);
        return;
      }

      const voiceKey = `${textOf(child, "staff") || "1"}:${textOf(child, "voice") || "1"}`;
      const midi = isRest ? null : pitchToMidi(child);
      if (!isRest && midi === null) {
        throw new Error(
          `The MusicXML part "${displayName}" contains a note without a valid pitch: ${child.outerHTML}`,
        );
      }
      localNotes.push({ start, duration, midi, isRest, voice: voiceKey });
      if (!isChord) {
        lastNoteStart = cursor;
        cursor += duration;
      }
      maxCursor = Math.max(maxCursor, cursor);
    });

    const expectedDuration = (beatsPerMeasure * 4) / beatType;
    probe.content.push(maxCursor / divisions);
    probe.bar.push(expectedDuration);
    const durationBeats =
      durationOverrides?.[measureIndex] ??
      Math.max(expectedDuration, maxCursor / divisions, 0.25);
    measures.push({
      index: measureIndex,
      number: measureElement.getAttribute("number") || String(measureIndex + 1),
      startBeat: absoluteMeasureStart,
      durationBeats,
    });
    localNotes.forEach((note) => {
      notes.push({
        startBeat: absoluteMeasureStart + note.start / divisions,
        durationBeats: note.duration / divisions,
        midi: note.midi,
        measureIndex,
        isRest: note.isRest,
        voice: note.voice,
      });
    });
    absoluteMeasureStart += durationBeats;
  });

  notes.sort((left, right) => left.startBeat - right.startBeat);
  const parsed: PlaybackPart = {
    id,
    name: displayName,
    displayName,
    tempo,
    notes,
    measures,
    beatsPerBar: firstBeatsPerBar,
    beatUnitBeats: firstBeatUnitBeats,
    kind: "part",
  };
  measureProbes.set(parsed, probe);
  return parsed;
}

const SATB_LABELS = ["Soprano", "Alto", "Tenor", "Bass"];

function pitchedNotes(notes: PlaybackNote[]) {
  return notes.filter((note) => note.midi !== null);
}

function meanPitch(notes: PlaybackNote[]) {
  const pitched = pitchedNotes(notes);
  if (pitched.length === 0) return 0;
  return pitched.reduce((sum, note) => sum + (note.midi ?? 0), 0) / pitched.length;
}

/**
 * Splits one MusicXML part into its individual voices (e.g. soprano and alto
 * sharing a staff). Voices are returned highest-pitched first. Tiny fragments
 * (typically OMR noise) are ignored. Returns [] when the part has fewer than
 * two real voices, meaning there is nothing to split.
 */
function splitPartVoices(part: PlaybackPart): PlaybackPart[] {
  const byVoice = new Map<string, PlaybackNote[]>();
  part.notes.forEach((note) => {
    const key = note.voice ?? "1:1";
    const list = byVoice.get(key);
    if (list) list.push(note);
    else byVoice.set(key, [note]);
  });

  const counts = Array.from(byVoice.values()).map(
    (notes) => pitchedNotes(notes).length,
  );
  const largest = Math.max(0, ...counts);
  const threshold = Math.max(2, Math.ceil(largest * 0.25));
  const significant = Array.from(byVoice.entries())
    .filter(([, notes]) => pitchedNotes(notes).length >= threshold)
    .sort((a, b) => meanPitch(b[1]) - meanPitch(a[1]));

  if (significant.length < 2) return [];
  return significant.map(([key, notes]) => ({
    ...part,
    id: `${part.id}::voice:${key}`,
    name: part.name,
    displayName: part.displayName,
    notes,
    kind: "voice" as const,
  }));
}

function positionLabel(index: number, total: number) {
  if (total === 2) return index === 0 ? "upper voice" : "lower voice";
  if (total === 3) return ["upper voice", "middle voice", "lower voice"][index];
  return `voice ${index + 1}`;
}

/**
 * Turns the parts found in a score into the list a singer can choose from:
 * each part as written, plus each individual voice inside multi-voice parts
 * (labelled Soprano/Alto/Tenor/Bass when the score has exactly four lines),
 * plus an "all voices" option.
 */
export function expandPracticeTracks(parts: PlaybackPart[]): PlaybackPart[] {
  const split = parts.map((part) => splitPartVoices(part));
  const leaves = parts.flatMap((part, index) =>
    split[index].length > 0 ? split[index] : [part],
  );

  const satbByLeafId = new Map<string, string>();
  if (leaves.length === 4) {
    [...leaves]
      .sort((a, b) => meanPitch(b.notes) - meanPitch(a.notes))
      .forEach((leaf, rank) => satbByLeafId.set(leaf.id, SATB_LABELS[rank]));
  }

  const result: PlaybackPart[] = [];
  parts.forEach((part, index) => {
    const voices = split[index];
    if (voices.length === 0) {
      result.push(part);
      return;
    }
    const labelled = voices.map((voice, voiceIndex) => ({
      ...voice,
      displayName:
        satbByLeafId.get(voice.id) ??
        `${part.displayName} · ${positionLabel(voiceIndex, voices.length)}`,
    }));
    const allLabel = satbByLeafId.size
      ? labelled.map((voice) => voice.displayName).join(" + ")
      : part.displayName;
    result.push({
      ...part,
      displayName: `${allLabel} (together)`,
    });
    result.push(...labelled);
  });

  if (leaves.length >= 2) {
    const longest = parts.reduce((best, part) =>
      part.measures.length > best.measures.length ? part : best,
    );
    result.push({
      ...longest,
      id: "__all__",
      name: "All voices",
      displayName: "All voices — full score",
      notes: parts
        .flatMap((part) => part.notes)
        .sort((left, right) => left.startBeat - right.startBeat),
      kind: "all",
    });
  }
  return result;
}

export function selectPlaybackPart(
  score: PlaybackScore,
  partId: string,
): PlaybackScore {
  const selectedPart = score.parts.find((part) => part.id === partId);
  if (!selectedPart) {
    throw new Error(`The requested practice part "${partId}" was not found.`);
  }
  return {
    title: score.title,
    parts: score.parts,
    selectedPartId: selectedPart.id,
    tempo: selectedPart.tempo,
    notes: selectedPart.notes,
    measures: selectedPart.measures,
    beatsPerBar: selectedPart.beatsPerBar,
    beatUnitBeats: selectedPart.beatUnitBeats,
  };
}

export function parseMusicXml(source: string): PlaybackScore {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The MusicXML document could not be parsed.");
  }

  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== "score-partwise") {
    throw new Error(
      "Only partwise MusicXML scores are supported for practice playback.",
    );
  }

  const parts = Array.from(document.getElementsByTagName("part"));
  if (parts.length === 0) {
    throw new Error("The MusicXML score does not contain a part.");
  }

  // Playback-only: split chord-stacked staves (S+A, T+B written as chords)
  // into separate voices on this parsed copy. The drawn score uses the
  // original source string and is never affected.
  splitStackedChordsIntoVoices(document);

  const title =
    textOf(document, "work-title") ||
    textOf(document, "movement-title") ||
    "Imported score";

  const scorePartDefinitions = Array.from(
    document.getElementsByTagName("score-part"),
  );
  const definitionById = new Map(
    scorePartDefinitions
      .map(
        (definition) =>
          [definition.getAttribute("id")?.trim() ?? "", definition] as const,
      )
      .filter(([id]) => id.length > 0),
  );
  const partArgs = parts.map((part, index) => {
    const partId =
      part.getAttribute("id")?.trim() ||
      scorePartDefinitions[index]?.getAttribute("id")?.trim() ||
      `P${index + 1}`;
    const definition =
      definitionById.get(partId) ?? scorePartDefinitions[index];
    const partName = definition ? textOf(definition, "part-name") : "";
    const displayName = partName || `Part ${index + 1}`;
    return { part, partId, displayName };
  });
  let parsedParts = partArgs.map(({ part, partId, displayName }) =>
    parsePart(part, partId, displayName),
  );
  // Second pass only when a pickup / split bar needs its real length.
  const resolved = resolveMeasureDurations(
    parsedParts.map((parsed) => measureProbes.get(parsed)!),
  );
  const needsRelayout = parsedParts.some((parsed) =>
    parsed.measures.some(
      (measure, index) => !approxEqual(measure.durationBeats, resolved[index]),
    ),
  );
  if (needsRelayout) {
    parsedParts = partArgs.map(({ part, partId, displayName }) =>
      parsePart(part, partId, displayName, resolved),
    );
  }
  const practiceTracks = expandPracticeTracks(parsedParts);
  const firstPart = practiceTracks[0];
  return {
    title,
    parts: practiceTracks,
    selectedPartId: firstPart.id,
    tempo: firstPart.tempo,
    notes: firstPart.notes,
    measures: firstPart.measures,
    beatsPerBar: firstPart.beatsPerBar,
    beatUnitBeats: firstPart.beatUnitBeats,
  };
}

type ActiveVoice = {
  oscillators: OscillatorNode[];
  gain: GainNode;
};

/**
 * Tuning for the engine. The defaults suit a phone:
 *  - lookaheadSeconds: notes and clicks are handed to the audio clock this far
 *    BEFORE they are due, so a busy moment on the main thread (drawing the
 *    score, a slow CPU, battery saver) cannot make them start late.
 *  - reportIntervalMs: at most one on-screen progress update per interval
 *    (0 = update on every audio tick). State changes are always reported
 *    immediately.
 */
export interface PlaybackEngineOptions {
  lookaheadSeconds?: number;
  reportIntervalMs?: number;
}

export const DEFAULT_LOOKAHEAD_SECONDS = 0.15;

export class MusicalPlaybackEngine {
  private readonly onProgress: (snapshot: PlaybackSnapshot) => void;
  private readonly clock: () => number;
  private readonly lookaheadSeconds: number;
  private readonly reportIntervalMs: number;
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private score: PlaybackScore | null = null;
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private timer: number | null = null;
  private activeVoices = new Set<ActiveVoice>();
  private voiceCleanupTimers = new Set<number>();
  private tempo = 76;
  private playbackSpeed = 1;
  private countInBars: CountInBars = 0;
  private metronome = false;
  private volume = 0.65;
  private muted = false;
  private loop = false;
  private rangeStart = 0;
  private rangeEnd = 0;
  private positionBeat = 0;
  private lastWallTime = 0;
  private nextNoteIndex = 0;
  private nextMetronomeBeat = 0;
  private state: PlaybackState = "stopped";
  private awaitingCountIn = true;
  private countInElapsedBeats = 0;
  private countInTotalBeats = 0;
  private nextCountInBeat = 0;
  private loopCount = 0;

  constructor(
    onProgress: (snapshot: PlaybackSnapshot) => void,
    clock: () => number = () => performance.now(),
    options: PlaybackEngineOptions = {},
  ) {
    this.onProgress = onProgress;
    this.clock = clock;
    this.lookaheadSeconds = Math.max(
      0,
      options.lookaheadSeconds ?? DEFAULT_LOOKAHEAD_SECONDS,
    );
    this.reportIntervalMs = Math.max(0, options.reportIntervalMs ?? 0);
  }

  setScore(score: PlaybackScore) {
    this.stop();
    this.score = score;
    this.tempo = score.tempo;
    this.rangeStart = 0;
    this.rangeEnd = Math.max(0, score.measures.length - 1);
    this.positionBeat = score.measures[0]?.startBeat ?? 0;
    this.nextNoteIndex = 0;
    this.nextMetronomeBeat = this.positionBeat;
    this.loopCount = 0;
    this.report();
  }

  setTempo(tempo: number) {
    this.tick();
    this.tempo = Math.max(40, Math.min(160, tempo));
    this.lastWallTime = this.clock();
    this.report();
  }

  setPlaybackSpeed(speed: number) {
    this.tick();
    this.playbackSpeed = Math.max(0.25, Math.min(1, speed));
    this.lastWallTime = this.clock();
    this.report();
  }

  setCountInBars(countInBars: CountInBars) {
    this.countInBars = countInBars;
    if (this.state === "counting-in" && countInBars === 0) {
      this.countInElapsedBeats = 0;
      this.countInTotalBeats = 0;
      this.awaitingCountIn = false;
      this.state = "playing";
      this.lastWallTime = this.clock();
    }
    this.report();
  }

  setMetronome(metronome: boolean) {
    this.metronome = metronome;
    this.report();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.updateMasterGain();
    this.report();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.updateMasterGain();
    this.report();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
    if (!loop) this.loopCount = 0;
    this.report();
  }

  setRange(startMeasure: number, endMeasure: number) {
    if (!this.score) return;
    const wasPlaying = this.state === "playing" || this.state === "counting-in";
    this.rangeStart = Math.max(
      0,
      Math.min(startMeasure, this.score.measures.length - 1),
    );
    this.rangeEnd = Math.max(
      this.rangeStart,
      Math.min(endMeasure, this.score.measures.length - 1),
    );
    this.positionBeat = this.rangeStartBeat();
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.nextMetronomeBeat = this.positionBeat;
    this.loopCount = 0;
    this.armCountIn();
    this.stopVoices();
    if (wasPlaying) {
      this.state = "stopped";
      this.clearTimer();
    }
    this.report();
  }

  seekMeasure(measureIndex: number) {
    if (!this.score) return;
    const nextMeasure = Math.max(
      0,
      Math.min(measureIndex, this.score.measures.length - 1),
    );
    this.positionBeat = this.score.measures[nextMeasure]?.startBeat ?? 0;
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.nextMetronomeBeat = this.positionBeat;
    this.loopCount = 0;
    this.armCountIn();
    this.stopVoices();
    this.report();
  }

  play() {
    if (!this.score) return;
    if (this.positionBeat >= this.rangeEndBeat()) {
      this.positionBeat = this.rangeStartBeat();
      this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
      this.nextMetronomeBeat = this.positionBeat;
      this.armCountIn();
    }
    const context = this.ensureContext();
    if (!context) return;
    void context.resume();
    if (this.awaitingCountIn && this.countInBars > 0) this.startCountIn();
    this.state = this.isCountingIn() ? "counting-in" : "playing";
    this.lastWallTime = this.clock();
    if (this.timer === null)
      this.timer = window.setInterval(() => this.tick(), 20);
    this.report();
  }

  pause() {
    if (this.state !== "playing" && this.state !== "counting-in") return;
    this.tick();
    this.clearTimer();
    this.stopVoices();
    if (this.state === "playing")
      this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.state = "paused";
    this.report();
  }

  stop() {
    this.clearTimer();
    this.stopVoices();
    this.state = "stopped";
    if (this.score) {
      this.positionBeat = this.rangeStartBeat();
      this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
      this.nextMetronomeBeat = this.positionBeat;
    }
    this.loopCount = 0;
    this.armCountIn();
    this.report();
  }

  reset() {
    this.stop();
    this.rangeStart = 0;
    if (this.score) this.rangeEnd = Math.max(0, this.score.measures.length - 1);
    this.positionBeat = this.score?.measures[0]?.startBeat ?? 0;
    this.nextNoteIndex = 0;
    this.nextMetronomeBeat = this.positionBeat;
    this.report();
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
  }

  private tick() {
    if (
      !this.score ||
      (this.state !== "playing" && this.state !== "counting-in")
    )
      return;
    const now = this.clock();
    const deltaBeats =
      Math.max(0, (now - this.lastWallTime) / 1000) *
      (this.tempo / 60) *
      this.playbackSpeed;
    this.lastWallTime = now;

    const lookaheadBeats = this.lookaheadBeats();

    if (this.state === "counting-in") {
      this.countInElapsedBeats += deltaBeats;
      while (
        this.nextCountInBeat * this.score.beatUnitBeats <
          this.countInTotalBeats - 0.0001 &&
        this.nextCountInBeat * this.score.beatUnitBeats <=
          this.countInElapsedBeats + lookaheadBeats + 0.0001
      ) {
        this.playMetronomeClick(
          this.nextCountInBeat % this.score.beatsPerBar === 0,
          this.delayFor(
            this.nextCountInBeat * this.score.beatUnitBeats -
              this.countInElapsedBeats,
          ),
        );
        this.nextCountInBeat += 1;
      }
      if (this.countInElapsedBeats >= this.countInTotalBeats) {
        this.finishCountIn();
      } else {
        this.reportThrottled();
        return;
      }
    }

    const rangeEndBeat = this.rangeEndBeat();
    this.positionBeat += deltaBeats;
    this.schedulePlaybackMetronome(rangeEndBeat);

    const playbackPosition = Math.min(this.positionBeat, rangeEndBeat);
    while (this.nextNoteIndex < this.score.notes.length) {
      const note = this.score.notes[this.nextNoteIndex];
      if (note.startBeat >= rangeEndBeat) break;
      if (note.startBeat > playbackPosition + lookaheadBeats) break;
      if (note.startBeat >= this.rangeStartBeat())
        this.playNote(note, this.delayFor(note.startBeat - this.positionBeat));
      this.nextNoteIndex += 1;
    }

    if (this.positionBeat >= rangeEndBeat) {
      if (this.loop) {
        this.positionBeat = this.rangeStartBeat();
        this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
        this.nextMetronomeBeat = this.positionBeat;
        this.loopCount += 1;
        this.stopVoices();
        this.report(); // a loop restart is a state change: show it at once
      } else {
        this.positionBeat = rangeEndBeat;
        this.clearTimer();
        this.stopVoices();
        this.state = "completed";
        this.awaitingCountIn = true;
        this.report();
        return;
      }
    }
    this.reportThrottled();
  }

  /** Beats that fit inside the lookahead window at the current speed. */
  private lookaheadBeats() {
    return this.lookaheadSeconds * (this.tempo / 60) * this.playbackSpeed;
  }

  /** Seconds from now until something `beatsAhead` beats away is due (never negative). */
  private delayFor(beatsAhead: number) {
    if (beatsAhead <= 0) return 0;
    return beatsToSeconds(beatsAhead, this.tempo, this.playbackSpeed);
  }

  private playNote(note: PlaybackNote, delay = 0) {
    if (note.isRest || note.midi === null || !this.context) return;
    const frequency = midiToFrequency(note.midi);
    // Scheduled on the audio clock: `now` is the moment the note must start.
    const now = this.context.currentTime + delay;
    const elapsedBeats = Math.max(0, this.positionBeat - note.startBeat);
    const remainingBeats = Math.max(0.06, note.durationBeats - elapsedBeats);
    const duration = Math.max(
      0.06,
      beatsToSeconds(remainingBeats, this.tempo, this.playbackSpeed),
    );
    const release = Math.min(0.18, duration * 0.4);
    const gain = this.context.createGain();
    const fundamental = this.context.createOscillator();
    const overtone = this.context.createOscillator();
    fundamental.type = "triangle";
    overtone.type = "sine";
    fundamental.frequency.setValueAtTime(frequency, now);
    overtone.frequency.setValueAtTime(frequency * 2, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(
      0.055,
      now + Math.min(0.12, duration * 0.35),
    );
    gain.gain.setValueAtTime(
      0.055,
      Math.max(now + 0.02, now + duration - release),
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    fundamental.connect(gain);
    overtone.connect(gain);
    gain.connect(this.ensureMasterGain());
    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + duration + 0.02);
    overtone.stop(now + duration + 0.02);
    const voice = { oscillators: [fundamental, overtone], gain };
    this.activeVoices.add(voice);
    let cleanupTimer = 0;
    cleanupTimer = window.setTimeout(
      () => {
        this.voiceCleanupTimers.delete(cleanupTimer);
        this.activeVoices.delete(voice);
      },
      (delay + duration + 0.05) * 1000,
    );
    this.voiceCleanupTimers.add(cleanupTimer);
  }

  private playMetronomeClick(strong: boolean, delay = 0) {
    if (!this.context || (!this.metronome && !this.isCountingIn())) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(strong ? 1320 : 880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(strong ? 0.12 : 0.065, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain);
    gain.connect(this.ensureMasterGain());
    oscillator.start(now);
    oscillator.stop(now + 0.065);
    // Tracked like a note so pause/stop also cancels a click scheduled ahead.
    const voice = { oscillators: [oscillator], gain };
    this.activeVoices.add(voice);
    let cleanupTimer = 0;
    cleanupTimer = window.setTimeout(
      () => {
        this.voiceCleanupTimers.delete(cleanupTimer);
        this.activeVoices.delete(voice);
      },
      (delay + 0.065 + 0.05) * 1000,
    );
    this.voiceCleanupTimers.add(cleanupTimer);
  }

  private schedulePlaybackMetronome(rangeEndBeat: number) {
    if (!this.score) return;
    const unit = this.score.beatUnitBeats;
    const lookaheadBeats = this.lookaheadBeats();
    while (
      this.nextMetronomeBeat <= this.positionBeat + lookaheadBeats + 0.0001 &&
      this.nextMetronomeBeat < rangeEndBeat
    ) {
      const measure = this.measureAt(this.nextMetronomeBeat);
      const beatInMeasure = measure
        ? Math.round((this.nextMetronomeBeat - measure.startBeat) / unit)
        : 0;
      this.playMetronomeClick(
        beatInMeasure === 0,
        this.delayFor(this.nextMetronomeBeat - this.positionBeat),
      );
      this.nextMetronomeBeat += unit;
    }
  }

  private ensureContext() {
    if (this.context) return this.context;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
    this.updateMasterGain();
    return this.context;
  }

  private ensureMasterGain() {
    if (!this.masterGain && !this.ensureContext()) {
      throw new Error("Web Audio is not available in this browser.");
    }
    return this.masterGain!;
  }

  private updateMasterGain() {
    if (!this.masterGain || !this.context) return;
    this.masterGain.gain.setTargetAtTime(
      this.muted ? 0 : this.volume,
      this.context.currentTime,
      0.01,
    );
  }

  private startCountIn() {
    if (!this.score || this.countInBars === 0) {
      this.awaitingCountIn = false;
      this.countInTotalBeats = 0;
      return;
    }
    this.countInTotalBeats =
      this.countInBars * this.score.beatsPerBar * this.score.beatUnitBeats;
    this.countInElapsedBeats = 0;
    this.nextCountInBeat = 0;
    this.awaitingCountIn = false;
    this.state = "counting-in";
  }

  private finishCountIn() {
    this.countInTotalBeats = 0;
    this.countInElapsedBeats = 0;
    this.positionBeat = this.rangeStartBeat();
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.nextMetronomeBeat = this.positionBeat;
    this.state = "playing";
  }

  private armCountIn() {
    this.awaitingCountIn = true;
    this.countInElapsedBeats = 0;
    this.countInTotalBeats = 0;
    this.nextCountInBeat = 0;
  }

  private isCountingIn() {
    return (
      this.countInTotalBeats > 0 &&
      this.countInElapsedBeats < this.countInTotalBeats
    );
  }

  private stopVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.voiceCleanupTimers.forEach((cleanupTimer) =>
      window.clearTimeout(cleanupTimer),
    );
    this.voiceCleanupTimers.clear();
    this.activeVoices.forEach((voice) => {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(0.0001, now);
      voice.oscillators.forEach((oscillator) => {
        try {
          oscillator.stop(now + 0.025);
        } catch {
          // An oscillator that has already ended does not need stopping.
        }
      });
    });
    this.activeVoices.clear();
  }

  private clearTimer() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private rangeStartBeat() {
    return this.score?.measures[this.rangeStart]?.startBeat ?? 0;
  }

  private rangeEndBeat() {
    if (!this.score) return 0;
    const measure = this.score.measures[this.rangeEnd];
    return measure ? measure.startBeat + measure.durationBeats : 0;
  }

  private findNoteIndex(positionBeat: number) {
    if (!this.score) return 0;
    const index = this.score.notes.findIndex(
      (note) => note.startBeat + note.durationBeats > positionBeat + 0.0001,
    );
    return index < 0 ? this.score.notes.length : index;
  }

  private measureAt(positionBeat: number) {
    if (!this.score) return null;
    let current = this.score.measures[0] ?? null;
    this.score.measures.forEach((measure) => {
      if (measure.startBeat <= positionBeat) current = measure;
    });
    return current;
  }

  /** Progress updates for the screen, limited to reportIntervalMs. */
  private reportThrottled() {
    if (this.reportIntervalMs <= 0) {
      this.report();
      return;
    }
    if (this.clock() - this.lastReportAt >= this.reportIntervalMs) this.report();
  }

  private report() {
    this.lastReportAt = this.clock();
    const durationBeats = Math.max(
      0,
      this.rangeEndBeat() - this.rangeStartBeat(),
    );
    const foundMeasureIndex =
      this.score?.measures.findIndex(
        (measure, index) =>
          this.positionBeat >= measure.startBeat &&
          (index === this.score!.measures.length - 1 ||
            this.positionBeat < this.score!.measures[index + 1].startBeat),
      ) ?? 0;
    const measureIndex =
      this.positionBeat >= this.rangeEndBeat()
        ? this.rangeEnd
        : foundMeasureIndex < 0
          ? Math.max(0, (this.score?.measures.length ?? 1) - 1)
          : foundMeasureIndex;
    const activeNote = this.score?.notes.find(
      (note) =>
        !note.isRest &&
        note.midi !== null &&
        this.positionBeat >= note.startBeat &&
        this.positionBeat < note.startBeat + note.durationBeats,
    );
    const progress =
      durationBeats === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (this.positionBeat - this.rangeStartBeat()) / durationBeats,
            ),
          );
    this.onProgress({
      state: this.state,
      currentMeasure: Math.max(0, measureIndex),
      currentNoteMidi: activeNote?.midi ?? null,
      progress,
      positionBeat: this.positionBeat,
      durationBeats,
      countInBeat: this.isCountingIn()
        ? Math.min(
            this.nextCountInBeat,
            Math.ceil(
              this.countInTotalBeats / (this.score?.beatUnitBeats ?? 1),
            ),
          )
        : 0,
      countInBeatsTotal: this.isCountingIn()
        ? Math.ceil(this.countInTotalBeats / (this.score?.beatUnitBeats ?? 1))
        : 0,
      loopCount: this.loopCount,
    });
  }
}
