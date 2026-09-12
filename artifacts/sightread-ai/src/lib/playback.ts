export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface PlaybackNote {
  startBeat: number;
  durationBeats: number;
  midi: number | null;
  measureIndex: number;
  isRest: boolean;
}

export interface PlaybackMeasure {
  index: number;
  number: string;
  startBeat: number;
  durationBeats: number;
}

export interface PlaybackScore {
  title: string;
  tempo: number;
  notes: PlaybackNote[];
  measures: PlaybackMeasure[];
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentMeasure: number;
  progress: number;
  positionBeat: number;
  durationBeats: number;
}

function textOf(parent: Document | Element, tagName: string) {
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? '';
}

function numberOf(parent: Element, tagName: string, fallback: number) {
  const value = Number(textOf(parent, tagName));
  return Number.isFinite(value) ? value : fallback;
}

function pitchToMidi(note: Element) {
  const pitch = note.getElementsByTagName('pitch')[0];
  if (!pitch) return null;
  const step = textOf(pitch, 'step').toUpperCase();
  const octave = Number(textOf(pitch, 'octave'));
  const alter = Number(textOf(pitch, 'alter') || '0');
  const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  if (!(step in semitones) || !Number.isFinite(octave) || !Number.isFinite(alter)) return null;
  return (octave + 1) * 12 + semitones[step] + alter;
}

function readTempo(measure: Element, fallback: number) {
  const sound = measure.getElementsByTagName('sound')[0];
  const soundTempo = sound ? Number(sound.getAttribute('tempo')) : NaN;
  if (Number.isFinite(soundTempo) && soundTempo > 0) return soundTempo;

  const perMinute = measure.getElementsByTagName('per-minute')[0];
  const metronomeTempo = perMinute ? Number(perMinute.textContent) : NaN;
  return Number.isFinite(metronomeTempo) && metronomeTempo > 0 ? metronomeTempo : fallback;
}

export function parseMusicXml(source: string): PlaybackScore {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('The MusicXML document could not be parsed.');
  }

  const root = document.documentElement;
  if (!root || !/score-(partwise|timewise)/i.test(root.tagName)) {
    throw new Error('The file does not contain a supported MusicXML score.');
  }

  const part = document.getElementsByTagName('part')[0];
  const measureElements = part ? Array.from(part.getElementsByTagName('measure')) : [];
  if (!part || measureElements.length === 0) {
    throw new Error('The MusicXML score does not contain any measures.');
  }

  const title =
    textOf(document, 'work-title') ||
    textOf(document, 'movement-title') ||
    'Imported score';
  let divisions = 1;
  let beatsPerMeasure = 4;
  let beatType = 4;
  let tempo = 76;
  let absoluteMeasureStart = 0;
  const notes: PlaybackNote[] = [];
  const measures: PlaybackMeasure[] = [];

  measureElements.forEach((measureElement, measureIndex) => {
    const attributes = measureElement.getElementsByTagName('attributes')[0];
    if (attributes) {
      divisions = Math.max(1, numberOf(attributes, 'divisions', divisions));
      const time = attributes.getElementsByTagName('time')[0];
      if (time) {
        beatsPerMeasure = Math.max(1, numberOf(time, 'beats', beatsPerMeasure));
        beatType = Math.max(1, numberOf(time, 'beat-type', beatType));
      }
    }
    tempo = readTempo(measureElement, tempo);

    let cursor = 0;
    let maxCursor = 0;
    let lastNoteStart = 0;
    const localNotes: Array<{ start: number; duration: number; midi: number | null; isRest: boolean }> = [];

    Array.from(measureElement.children).forEach((child) => {
      const tagName = child.tagName.toLowerCase();
      if (tagName === 'backup' || tagName === 'forward') {
        const duration = Math.max(0, numberOf(child, 'duration', 0));
        if (tagName === 'backup') {
          cursor = Math.max(0, cursor - duration);
        } else {
          cursor += duration;
          maxCursor = Math.max(maxCursor, cursor);
        }
        return;
      }
      if (tagName !== 'note') return;

      const duration = Math.max(0, numberOf(child, 'duration', 0));
      const isChord = child.getElementsByTagName('chord').length > 0;
      const start = isChord ? lastNoteStart : cursor;
      const isRest = child.getElementsByTagName('rest').length > 0;
      if (duration > 0) {
        localNotes.push({ start, duration, midi: isRest ? null : pitchToMidi(child), isRest });
      }
      if (!isChord) {
        lastNoteStart = cursor;
        cursor += duration;
      }
      maxCursor = Math.max(maxCursor, cursor);
    });

    const expectedDuration = (beatsPerMeasure * 4) / beatType;
    const durationBeats = Math.max(expectedDuration, maxCursor / divisions, 0.25);
    measures.push({
      index: measureIndex,
      number: measureElement.getAttribute('number') || String(measureIndex + 1),
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
      });
    });
    absoluteMeasureStart += durationBeats;
  });

  if (!notes.some((note) => !note.isRest && note.midi !== null)) {
    throw new Error('The MusicXML score does not contain any playable notes.');
  }

  notes.sort((left, right) => left.startBeat - right.startBeat);
  return { title, tempo, notes, measures };
}

type ActiveVoice = {
  oscillators: OscillatorNode[];
  gain: GainNode;
};

export class MusicalPlaybackEngine {
  private readonly onProgress: (snapshot: PlaybackSnapshot) => void;
  private score: PlaybackScore | null = null;
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private activeVoices = new Set<ActiveVoice>();
  private tempo = 76;
  private loop = false;
  private rangeStart = 0;
  private rangeEnd = 0;
  private positionBeat = 0;
  private lastWallTime = 0;
  private nextNoteIndex = 0;
  private state: PlaybackState = 'stopped';

  constructor(onProgress: (snapshot: PlaybackSnapshot) => void) {
    this.onProgress = onProgress;
  }

  setScore(score: PlaybackScore) {
    this.stop();
    this.score = score;
    this.tempo = score.tempo;
    this.rangeStart = 0;
    this.rangeEnd = Math.max(0, score.measures.length - 1);
    this.positionBeat = score.measures[0]?.startBeat ?? 0;
    this.nextNoteIndex = 0;
    this.report();
  }

  setTempo(tempo: number) {
    this.tick();
    this.tempo = Math.max(40, Math.min(160, tempo));
    this.lastWallTime = performance.now();
    this.report();
  }

  setLoop(loop: boolean) {
    this.loop = loop;
  }

  setRange(startMeasure: number, endMeasure: number) {
    if (!this.score) return;
    this.rangeStart = Math.max(0, Math.min(startMeasure, this.score.measures.length - 1));
    this.rangeEnd = Math.max(this.rangeStart, Math.min(endMeasure, this.score.measures.length - 1));
    const rangeStartBeat = this.score.measures[this.rangeStart]?.startBeat ?? 0;
    const rangeEndBeat = this.rangeEndBeat();
    if (this.positionBeat < rangeStartBeat || this.positionBeat >= rangeEndBeat) {
      this.positionBeat = rangeStartBeat;
    }
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.report();
  }

  seekMeasure(measureIndex: number) {
    if (!this.score) return;
    const nextMeasure = Math.max(0, Math.min(measureIndex, this.score.measures.length - 1));
    this.positionBeat = this.score.measures[nextMeasure]?.startBeat ?? 0;
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.report();
  }

  play() {
    if (!this.score) return;
    if (this.positionBeat >= this.rangeEndBeat()) {
      this.positionBeat = this.rangeStartBeat();
      this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    }
    const context = this.ensureContext();
    if (!context) return;
    void context.resume();
    this.state = 'playing';
    this.lastWallTime = performance.now();
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 20);
    this.report();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.tick();
    this.clearTimer();
    this.stopVoices();
    this.state = 'paused';
    this.report();
  }

  stop() {
    this.clearTimer();
    this.stopVoices();
    this.state = 'stopped';
    if (this.score) {
      this.positionBeat = this.rangeStartBeat();
      this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    }
    this.report();
  }

  reset() {
    this.stop();
    this.rangeStart = 0;
    if (this.score) this.rangeEnd = Math.max(0, this.score.measures.length - 1);
    this.positionBeat = this.score?.measures[0]?.startBeat ?? 0;
    this.nextNoteIndex = 0;
    this.report();
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  private tick() {
    if (!this.score || this.state !== 'playing') return;
    const now = performance.now();
    this.positionBeat += ((now - this.lastWallTime) / 1000) * (this.tempo / 60);
    this.lastWallTime = now;
    const rangeEndBeat = this.rangeEndBeat();

    if (this.positionBeat >= rangeEndBeat) {
      if (this.loop) {
        this.positionBeat = this.rangeStartBeat();
        this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
        this.stopVoices();
      } else {
        this.positionBeat = rangeEndBeat;
        this.clearTimer();
        this.stopVoices();
        this.state = 'stopped';
        this.report();
        return;
      }
    }

    while (this.nextNoteIndex < this.score.notes.length) {
      const note = this.score.notes[this.nextNoteIndex];
      if (note.startBeat >= rangeEndBeat) break;
      if (note.startBeat > this.positionBeat) break;
      if (note.startBeat >= this.rangeStartBeat()) this.playNote(note);
      this.nextNoteIndex += 1;
    }
    this.report();
  }

  private playNote(note: PlaybackNote) {
    if (note.isRest || note.midi === null || !this.context) return;
    const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
    const now = this.context.currentTime;
    const duration = Math.max(0.06, (note.durationBeats * 60) / this.tempo);
    const release = Math.min(0.18, duration * 0.4);
    const gain = this.context.createGain();
    const fundamental = this.context.createOscillator();
    const overtone = this.context.createOscillator();
    fundamental.type = 'triangle';
    overtone.type = 'sine';
    fundamental.frequency.setValueAtTime(frequency, now);
    overtone.frequency.setValueAtTime(frequency * 2, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.055, now + Math.min(0.12, duration * 0.35));
    gain.gain.setValueAtTime(0.055, Math.max(now + 0.02, now + duration - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    fundamental.connect(gain);
    overtone.connect(gain);
    gain.connect(this.context.destination);
    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + duration + 0.02);
    overtone.stop(now + duration + 0.02);
    const voice = { oscillators: [fundamental, overtone], gain };
    this.activeVoices.add(voice);
    window.setTimeout(() => this.activeVoices.delete(voice), (duration + 0.05) * 1000);
  }

  private ensureContext() {
    if (this.context) return this.context;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    return this.context;
  }

  private stopVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
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
    const index = this.score.notes.findIndex((note) => note.startBeat >= positionBeat - 0.0001);
    return index < 0 ? this.score.notes.length : index;
  }

  private report() {
    const durationBeats = Math.max(0, this.rangeEndBeat() - this.rangeStartBeat());
    const foundMeasureIndex =
      this.score?.measures.findIndex(
        (measure, index) =>
          this.positionBeat >= measure.startBeat &&
          (index === this.score!.measures.length - 1 || this.positionBeat < this.score!.measures[index + 1].startBeat),
      ) ?? 0;
    const measureIndex =
      this.positionBeat >= this.rangeEndBeat()
        ? this.rangeEnd
        : foundMeasureIndex < 0
          ? Math.max(0, (this.score?.measures.length ?? 1) - 1)
          : foundMeasureIndex;
    const progress = durationBeats === 0 ? 0 : Math.max(0, Math.min(1, (this.positionBeat - this.rangeStartBeat()) / durationBeats));
    this.onProgress({
      state: this.state,
      currentMeasure: Math.max(0, measureIndex),
      progress,
      positionBeat: this.positionBeat,
      durationBeats,
    });
  }
}