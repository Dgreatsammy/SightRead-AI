export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'counting-in';
export type CountInBars = 0 | 1 | 2;

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
  return parent.getElementsByTagName(tagName)[0]?.textContent?.trim() ?? '';
}

function numberOf(parent: Element, tagName: string, fallback: number) {
  const value = Number(textOf(parent, tagName));
  return Number.isFinite(value) ? value : fallback;
}

function requiredDuration(note: Element) {
  const durationText = textOf(note, 'duration');
  const duration = Number(durationText);
  if (!durationText || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('The score contains a note with an invalid duration.');
  }
  return duration;
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

export function midiToFrequency(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function beatsToSeconds(beats: number, tempo: number, speed = 1) {
  return (beats * 60) / (tempo * speed);
}

export function parseMusicXml(source: string): PlaybackScore {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('The MusicXML document could not be parsed.');
  }

  const root = document.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'score-partwise') {
    throw new Error('Only partwise MusicXML scores are supported for practice playback.');
  }

  const parts = Array.from(document.getElementsByTagName('part'));
  if (parts.length === 0) {
    throw new Error('The MusicXML score does not contain a part.');
  }
  if (parts.length > 1) {
    throw new Error('This score contains multiple parts. Practice playback currently supports one part at a time.');
  }

  const part = parts[0];
  const measureElements = Array.from(part.getElementsByTagName('measure'));
  if (measureElements.length === 0) {
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
  let firstBeatsPerBar = 4;
  let firstBeatUnitBeats = 1;
  const notes: PlaybackNote[] = [];
  const measures: PlaybackMeasure[] = [];

  measureElements.forEach((measureElement, measureIndex) => {
    const attributes = measureElement.getElementsByTagName('attributes')[0];
    if (attributes) {
      const parsedDivisions = numberOf(attributes, 'divisions', divisions);
      if (!Number.isFinite(parsedDivisions) || parsedDivisions <= 0) {
        throw new Error('The score contains invalid rhythmic divisions.');
      }
      divisions = parsedDivisions;
      const time = attributes.getElementsByTagName('time')[0];
      if (time) {
        beatsPerMeasure = Math.max(1, numberOf(time, 'beats', beatsPerMeasure));
        beatType = Math.max(1, numberOf(time, 'beat-type', beatType));
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
    const localNotes: Array<{ start: number; duration: number; midi: number | null; isRest: boolean }> = [];

    Array.from(measureElement.children).forEach((child) => {
      const tagName = child.tagName.toLowerCase();
      if (tagName === 'backup' || tagName === 'forward') {
        const durationText = textOf(child, 'duration');
        const duration = Number(durationText);
        if (!durationText || !Number.isFinite(duration) || duration < 0) {
          throw new Error('The score contains an invalid backup or forward duration.');
        }
        if (tagName === 'backup') {
          cursor = Math.max(0, cursor - duration);
        } else {
          cursor += duration;
          maxCursor = Math.max(maxCursor, cursor);
        }
        return;
      }
      if (tagName !== 'note') return;

      const duration = requiredDuration(child);
      const isChord = child.getElementsByTagName('chord').length > 0;
      const start = isChord ? lastNoteStart : cursor;
      const isRest = child.getElementsByTagName('rest').length > 0;
      const midi = isRest ? null : pitchToMidi(child);
      if (!isRest && midi === null) {
        throw new Error('The score contains a note without a valid pitch. Unsupported notes were not played.');
      }
      localNotes.push({ start, duration, midi, isRest });
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
  return {
    title,
    tempo,
    notes,
    measures,
    beatsPerBar: firstBeatsPerBar,
    beatUnitBeats: firstBeatUnitBeats,
  };
}

type ActiveVoice = {
  oscillators: OscillatorNode[];
  gain: GainNode;
};

export class MusicalPlaybackEngine {
  private readonly onProgress: (snapshot: PlaybackSnapshot) => void;
  private readonly clock: () => number;
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
  private state: PlaybackState = 'stopped';
  private awaitingCountIn = true;
  private countInElapsedBeats = 0;
  private countInTotalBeats = 0;
  private nextCountInBeat = 0;
  private loopCount = 0;

  constructor(onProgress: (snapshot: PlaybackSnapshot) => void, clock: () => number = () => performance.now()) {
    this.onProgress = onProgress;
    this.clock = clock;
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
    if (this.state === 'counting-in' && countInBars === 0) {
      this.countInElapsedBeats = 0;
      this.countInTotalBeats = 0;
      this.awaitingCountIn = false;
      this.state = 'playing';
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
    const wasPlaying = this.state === 'playing' || this.state === 'counting-in';
    this.rangeStart = Math.max(0, Math.min(startMeasure, this.score.measures.length - 1));
    this.rangeEnd = Math.max(this.rangeStart, Math.min(endMeasure, this.score.measures.length - 1));
    this.positionBeat = this.rangeStartBeat();
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.nextMetronomeBeat = this.positionBeat;
    this.loopCount = 0;
    this.armCountIn();
    this.stopVoices();
    if (wasPlaying) {
      this.state = 'stopped';
      this.clearTimer();
    }
    this.report();
  }

  seekMeasure(measureIndex: number) {
    if (!this.score) return;
    const nextMeasure = Math.max(0, Math.min(measureIndex, this.score.measures.length - 1));
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
    this.state = this.isCountingIn() ? 'counting-in' : 'playing';
    this.lastWallTime = this.clock();
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), 20);
    this.report();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'counting-in') return;
    this.tick();
    this.clearTimer();
    this.stopVoices();
    if (this.state === 'playing') this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
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
    if (!this.score || (this.state !== 'playing' && this.state !== 'counting-in')) return;
    const now = this.clock();
    const deltaBeats = Math.max(0, (now - this.lastWallTime) / 1000) * (this.tempo / 60) * this.playbackSpeed;
    this.lastWallTime = now;

    if (this.state === 'counting-in') {
      this.countInElapsedBeats += deltaBeats;
      while (
        this.nextCountInBeat * this.score.beatUnitBeats < this.countInTotalBeats - 0.0001 &&
        this.nextCountInBeat * this.score.beatUnitBeats <= this.countInElapsedBeats + 0.0001
      ) {
        this.playMetronomeClick(this.nextCountInBeat % this.score.beatsPerBar === 0);
        this.nextCountInBeat += 1;
      }
      if (this.countInElapsedBeats >= this.countInTotalBeats) {
        this.finishCountIn();
      } else {
        this.report();
        return;
      }
    }

    const rangeEndBeat = this.rangeEndBeat();
    this.positionBeat += deltaBeats;
    this.schedulePlaybackMetronome(rangeEndBeat);

    if (this.positionBeat >= rangeEndBeat) {
      if (this.loop) {
        this.positionBeat = this.rangeStartBeat();
        this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
        this.nextMetronomeBeat = this.positionBeat;
        this.loopCount += 1;
        this.stopVoices();
      } else {
        this.positionBeat = rangeEndBeat;
        this.clearTimer();
        this.stopVoices();
        this.state = 'stopped';
        this.awaitingCountIn = true;
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
    const frequency = midiToFrequency(note.midi);
    const now = this.context.currentTime;
    const elapsedBeats = Math.max(0, this.positionBeat - note.startBeat);
    const remainingBeats = Math.max(0.06, note.durationBeats - elapsedBeats);
    const duration = Math.max(0.06, beatsToSeconds(remainingBeats, this.tempo, this.playbackSpeed));
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
    gain.connect(this.ensureMasterGain());
    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + duration + 0.02);
    overtone.stop(now + duration + 0.02);
    const voice = { oscillators: [fundamental, overtone], gain };
    this.activeVoices.add(voice);
    let cleanupTimer = 0;
    cleanupTimer = window.setTimeout(() => {
      this.voiceCleanupTimers.delete(cleanupTimer);
      this.activeVoices.delete(voice);
    }, (duration + 0.05) * 1000);
    this.voiceCleanupTimers.add(cleanupTimer);
  }

  private playMetronomeClick(strong: boolean) {
    if (!this.context || (!this.metronome && !this.isCountingIn())) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(strong ? 1320 : 880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(strong ? 0.12 : 0.065, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain);
    gain.connect(this.ensureMasterGain());
    oscillator.start(now);
    oscillator.stop(now + 0.065);
  }

  private schedulePlaybackMetronome(rangeEndBeat: number) {
    if (!this.score) return;
    const unit = this.score.beatUnitBeats;
    while (this.nextMetronomeBeat <= this.positionBeat + 0.0001 && this.nextMetronomeBeat < rangeEndBeat) {
      const measure = this.measureAt(this.nextMetronomeBeat);
      const beatInMeasure = measure ? Math.round((this.nextMetronomeBeat - measure.startBeat) / unit) : 0;
      this.playMetronomeClick(beatInMeasure === 0);
      this.nextMetronomeBeat += unit;
    }
  }

  private ensureContext() {
    if (this.context) return this.context;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);
    this.updateMasterGain();
    return this.context;
  }

  private ensureMasterGain() {
    if (!this.masterGain && !this.ensureContext()) {
      throw new Error('Web Audio is not available in this browser.');
    }
    return this.masterGain!;
  }

  private updateMasterGain() {
    if (!this.masterGain || !this.context) return;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.01);
  }

  private startCountIn() {
    if (!this.score || this.countInBars === 0) {
      this.awaitingCountIn = false;
      this.countInTotalBeats = 0;
      return;
    }
    this.countInTotalBeats = this.countInBars * this.score.beatsPerBar * this.score.beatUnitBeats;
    this.countInElapsedBeats = 0;
    this.nextCountInBeat = 0;
    this.awaitingCountIn = false;
    this.state = 'counting-in';
  }

  private finishCountIn() {
    this.countInTotalBeats = 0;
    this.countInElapsedBeats = 0;
    this.positionBeat = this.rangeStartBeat();
    this.nextNoteIndex = this.findNoteIndex(this.positionBeat);
    this.nextMetronomeBeat = this.positionBeat;
    this.state = 'playing';
  }

  private armCountIn() {
    this.awaitingCountIn = true;
    this.countInElapsedBeats = 0;
    this.countInTotalBeats = 0;
    this.nextCountInBeat = 0;
  }

  private isCountingIn() {
    return this.countInTotalBeats > 0 && this.countInElapsedBeats < this.countInTotalBeats;
  }

  private stopVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.voiceCleanupTimers.forEach((cleanupTimer) => window.clearTimeout(cleanupTimer));
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
    const index = this.score.notes.findIndex((note) => note.startBeat + note.durationBeats > positionBeat + 0.0001);
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
    const activeNote = this.score?.notes.find(
      (note) =>
        !note.isRest &&
        note.midi !== null &&
        this.positionBeat >= note.startBeat &&
        this.positionBeat < note.startBeat + note.durationBeats,
    );
    const progress = durationBeats === 0 ? 0 : Math.max(0, Math.min(1, (this.positionBeat - this.rangeStartBeat()) / durationBeats));
    this.onProgress({
      state: this.state,
      currentMeasure: Math.max(0, measureIndex),
      currentNoteMidi: activeNote?.midi ?? null,
      progress,
      positionBeat: this.positionBeat,
      durationBeats,
      countInBeat: this.isCountingIn() ? Math.min(this.nextCountInBeat, Math.ceil(this.countInTotalBeats / (this.score?.beatUnitBeats ?? 1))) : 0,
      countInBeatsTotal: this.isCountingIn() ? Math.ceil(this.countInTotalBeats / (this.score?.beatUnitBeats ?? 1)) : 0,
      loopCount: this.loopCount,
    });
  }
}