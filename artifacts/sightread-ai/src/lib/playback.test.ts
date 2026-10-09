import { DOMParser } from "@xmldom/xmldom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beatsToSeconds,
  midiToFrequency,
  MusicalPlaybackEngine,
  parseMusicXml,
  type PlaybackSnapshot,
} from "./playback";

type NoteOptions = {
  step?: string;
  octave?: number;
  alter?: number;
  duration?: number;
  rest?: boolean;
  chord?: boolean;
};

function note({
  step = "C",
  octave = 4,
  alter,
  duration = 1,
  rest = false,
  chord = false,
}: NoteOptions = {}) {
  if (rest)
    return `<note>${chord ? "<chord/>" : ""}<rest/><duration>${duration}</duration><type>quarter</type></note>`;
  return `<note>${chord ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${octave}</octave>${alter === undefined ? "" : `<alter>${alter}</alter>`}</pitch><duration>${duration}</duration><type>quarter</type></note>`;
}

function measure(number: number, body: string, attributes = "") {
  return `<measure number="${number}">${attributes}${body}</measure>`;
}

function scoreXml(measures: string, extraParts = "") {
  return `<score-partwise version="3.1"><work><work-title>Test Study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part>${extraParts ? '<score-part id="P2"><part-name>Second</part-name></score-part>' : ""}</part-list><part id="P1">${measures}</part>${extraParts}</score-partwise>`;
}

const fourFour =
  "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
const oneFour =
  "<attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>";

class FakeParam {
  value = 0;
  events: Array<{ method: string; value: number; time: number }> = [];

  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ method: "setValueAtTime", value, time });
  }

  setTargetAtTime(value: number, time: number, constant: number) {
    this.value = value;
    this.events.push({
      method: "setTargetAtTime",
      value,
      time: time + constant,
    });
  }

  exponentialRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.events.push({ method: "exponentialRampToValueAtTime", value, time });
  }

  cancelScheduledValues(time: number) {
    this.events.push({ method: "cancelScheduledValues", value: 0, time });
  }
}

class FakeOscillator {
  type = "sine";
  frequency = new FakeParam();
  started = false;
  stopped = false;
  startTime = 0;
  stopTime = 0;

  connect() {
    return this;
  }

  start(time: number) {
    this.started = true;
    this.startTime = time;
  }

  stop(time: number) {
    this.stopped = true;
    this.stopTime = time;
  }
}

class FakeGain {
  gain = new FakeParam();

  connect() {
    return this;
  }
}

class FakeAudioContext {
  static latest: FakeAudioContext | null = null;
  destination = {};
  oscillators: FakeOscillator[] = [];
  masterGain: FakeGain | null = null;
  state = "suspended";

  constructor() {
    FakeAudioContext.latest = this;
  }

  get currentTime() {
    return currentClock / 1000;
  }

  createGain() {
    const gain = new FakeGain();
    if (!this.masterGain) this.masterGain = gain;
    return gain;
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.state = "closed";
  }
}

let currentClock = 0;

async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) {
    currentClock += Math.min(20, ms - elapsed);
    await vi.advanceTimersByTimeAsync(Math.min(20, ms - elapsed));
  }
}

function createEngine(
  score = parseMusicXml(
    scoreXml(
      `${measure(1, note({ duration: 1 }), oneFour)}${measure(2, note({ step: "D", duration: 1 }), oneFour)}`,
    ),
  ),
) {
  const snapshots: PlaybackSnapshot[] = [];
  const engine = new MusicalPlaybackEngine(
    (snapshot) => snapshots.push(snapshot),
    () => currentClock,
  );
  engine.setScore(score);
  return { engine, snapshots };
}

beforeEach(() => {
  currentClock = 0;
  vi.useFakeTimers();
  vi.stubGlobal("DOMParser", DOMParser);
  vi.stubGlobal("window", {
    AudioContext: FakeAudioContext,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeAudioContext.latest = null;
});

describe("MusicXML parser", () => {
  it("parses a valid single-part score and extracts title, tempo, and measures", () => {
    const source = scoreXml(
      `${measure(7, `<direction><sound tempo="92"/></direction>${note()}`, fourFour)}`,
    );
    const parsed = parseMusicXml(source);
    expect(parsed.title).toBe("Test Study");
    expect(parsed.tempo).toBe(92);
    expect(parsed.measures).toHaveLength(1);
    expect(parsed.measures[0]).toMatchObject({
      number: "7",
      startBeat: 0,
      durationBeats: 4,
    });
  });

  it("parses pitches, octaves, sharps, flats, and note durations", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(
          1,
          `${note({ step: "C", octave: 3, duration: 1 })}${note({ step: "F", octave: 4, alter: 1, duration: 2 })}${note({ step: "B", octave: 3, alter: -1, duration: 4 })}${note({ step: "E", octave: 5, duration: 8 })}`,
          fourFour,
        ),
      ),
    );
    expect(parsed.notes.map((item) => item.midi)).toEqual([48, 66, 58, 76]);
    expect(parsed.notes.map((item) => item.durationBeats)).toEqual([
      1, 2, 4, 8,
    ]);
  });

  it("converts different divisions into quarter-note beats", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(
          1,
          `${note({ duration: 2 })}${note({ duration: 4 })}`,
          "<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>",
        ),
      ),
    );
    expect(parsed.notes.map((item) => item.durationBeats)).toEqual([1, 2]);
    expect(parsed.measures[0].durationBeats).toBe(4);
  });

  it("handles quarter, half, whole, and eighth note values", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(
          1,
          `${note({ duration: 1 })}${note({ duration: 2 })}${note({ duration: 4 })}${note({ duration: 0.5 })}`,
          "<attributes><divisions>1</divisions><time><beats>8</beats><beat-type>4</beat-type></time></attributes>",
        ),
      ),
    );
    expect(parsed.notes.map((item) => item.durationBeats)).toEqual([
      1, 2, 4, 0.5,
    ]);
  });

  it("preserves rests as silent notes", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(
          1,
          `${note({ rest: true, duration: 1 })}${note({ duration: 1 })}`,
          fourFour,
        ),
      ),
    );
    expect(parsed.notes[0]).toMatchObject({
      isRest: true,
      midi: null,
      durationBeats: 1,
    });
    expect(parsed.notes[1]).toMatchObject({
      isRest: false,
      midi: 60,
      startBeat: 1,
    });
  });

  it("handles chords, backup elements, and forward elements", () => {
    const body = `${note({ duration: 1 })}${note({ step: "E", duration: 1, chord: true })}<backup><duration>1</duration></backup><forward><duration>1</duration></forward>${note({ rest: true, duration: 1 })}`;
    const parsed = parseMusicXml(scoreXml(measure(1, body, fourFour)));
    expect(
      parsed.notes.map((item) => [item.midi, item.startBeat, item.isRest]),
    ).toEqual([
      [60, 0, false],
      [64, 0, false],
      [null, 1, true],
    ]);
  });

  it("rejects empty scores, invalid XML, missing pitch, and invalid duration", () => {
    expect(() => parseMusicXml(scoreXml(""))).toThrow(/measures|playable/i);
    expect(() => parseMusicXml("<score-partwise><part>")).toThrow();
    expect(() =>
      parseMusicXml(
        scoreXml(measure(1, "<note><duration>1</duration></note>", fourFour)),
      ),
    ).toThrow(/pitch/i);
    expect(() =>
      parseMusicXml(scoreXml(measure(1, note({ duration: 0 }), fourFour))),
    ).toThrow(/duration/i);
  });

  it("accepts multiple-part scores, exposes all parts, and adds an all-voices track", () => {
    const secondPart = `<part id="P2">${measure(1, note(), fourFour)}</part>`;
    const score = parseMusicXml(
      scoreXml(measure(1, note(), fourFour), secondPart),
    );
    // Each original part, plus one "All voices — full score" combined track.
    expect(score.parts).toHaveLength(3);
    expect(score.selectedPartId).toBe("P1");
    expect(score.parts.map((part) => part.id)).toEqual([
      "P1",
      "P2",
      "__all__",
    ]);
    const all = score.parts.find((part) => part.id === "__all__");
    expect(all?.notes).toHaveLength(2);
  });

  it("does not split a part that only ever has one voice", () => {
    const score = parseMusicXml(scoreXml(measure(1, note(), fourFour)));
    // A single, unsplit part gets no SATB/voice tracks added.
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0].id).toBe("P1");
  });

  it("splits a two-voice-per-staff part (e.g. soprano+alto sharing a staff)", () => {
    const upperVoice = note({ step: "G", octave: 5 });
    const lowerVoice = `<note><voice>2</voice><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`;
    const body = `${upperVoice}${lowerVoice}${note({ step: "G", octave: 5 })}${`<note><voice>2</voice><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`}`;
    const score = parseMusicXml(scoreXml(measure(1, body, fourFour)));

    const names = score.parts.map((part) => part.displayName);
    expect(names).toContain("Piano (together)");
    expect(names.some((name) => name.includes("upper voice"))).toBe(true);
    expect(names.some((name) => name.includes("lower voice"))).toBe(true);
    expect(names).toContain("All voices — full score");

    const upper = score.parts.find(
      (part) => part.displayName === "Piano · upper voice",
    );
    expect(upper?.notes.every((n) => n.midi === 79)).toBe(true);
  });

  it("labels exactly four split voices as Soprano, Alto, Tenor, and Bass", () => {
    const staffVoice = (pitchStep: string, octave: number, voice: number) =>
      `<note><staff>1</staff><voice>${voice}</voice><pitch><step>${pitchStep}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`;
    const trebleBody = `${staffVoice("C", 5, 1)}${staffVoice("C", 4, 2)}${staffVoice(
      "C",
      5,
      1,
    )}${staffVoice("C", 4, 2)}`;
    const bassBody = `${staffVoice("C", 3, 1)}${staffVoice("C", 2, 2)}${staffVoice(
      "C",
      3,
      1,
    )}${staffVoice("C", 2, 2)}`;
    const secondPart = `<part id="P2">${measure(1, bassBody, fourFour)}</part>`;
    const score = parseMusicXml(
      scoreXml(measure(1, trebleBody, fourFour), secondPart),
    );

    const names = score.parts.map((part) => part.displayName);
    expect(names).toContain("Soprano");
    expect(names).toContain("Alto");
    expect(names).toContain("Tenor");
    expect(names).toContain("Bass");
    expect(names).toContain("All voices — full score");
  });
});

describe("timing helpers", () => {
  it("calculates known pitch frequencies and BPM durations", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 8);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
    expect(beatsToSeconds(1, 60)).toBe(1);
    expect(beatsToSeconds(2, 120)).toBe(1);
    expect(beatsToSeconds(2, 120, 0.5)).toBe(2);
  });
});

describe("playback engine", () => {
  it("plays note timing with BPM and practice-speed scaling", async () => {
    const { engine } = createEngine();
    engine.setTempo(60);
    engine.setPlaybackSpeed(0.5);
    engine.play();
    await advance(20);
    const oscillator = FakeAudioContext.latest?.oscillators.find(
      (item) => item.frequency.value > 200,
    );
    expect(oscillator?.frequency.value).toBeCloseTo(midiToFrequency(60), 3);
    expect(oscillator?.stopTime).toBeCloseTo(2, 1);
  });

  it("runs an audible count-in without moving the score position", async () => {
    const score = parseMusicXml(scoreXml(measure(1, note(), fourFour)));
    const { engine, snapshots } = createEngine(score);
    engine.setTempo(60);
    engine.setCountInBars(1);
    engine.play();
    expect(snapshots.at(-1)?.state).toBe("counting-in");
    await advance(3980);
    expect(snapshots.at(-1)?.state).toBe("counting-in");
    expect(snapshots.at(-1)?.positionBeat).toBe(0);
    await advance(40);
    expect(snapshots.at(-1)?.state).toBe("playing");
    const countInClicks = FakeAudioContext.latest?.oscillators.filter(
      (item) => item.frequency.value === 1320 || item.frequency.value === 880,
    );
    expect(countInClicks).toHaveLength(4);
  });

  it("schedules strong and weak metronome beats at the selected tempo", async () => {
    const score = parseMusicXml(
      scoreXml(measure(1, note({ duration: 4 }), fourFour)),
    );
    const { engine } = createEngine(score);
    engine.setTempo(60);
    engine.setMetronome(true);
    engine.play();
    await advance(1050);
    const clickFrequencies = FakeAudioContext.latest?.oscillators
      .map((item) => item.frequency.value)
      .filter((value) => value === 1320 || value === 880);
    expect(clickFrequencies).toEqual(expect.arrayContaining([1320, 880]));
  });

  it("keeps rests silent while advancing their timing", async () => {
    const score = parseMusicXml(
      scoreXml(
        measure(
          1,
          `${note({ rest: true, duration: 1 })}${note({ duration: 1 })}`,
          oneFour,
        ),
      ),
    );
    const { engine } = createEngine(score);
    engine.setTempo(60);
    engine.play();
    await advance(500);
    expect(FakeAudioContext.latest?.oscillators).toHaveLength(0);
    await advance(550);
    expect(FakeAudioContext.latest?.oscillators.length).toBeGreaterThan(0);
  });

  it("respects measure boundaries and selected playback ranges", async () => {
    const { engine, snapshots } = createEngine();
    engine.setRange(1, 1);
    engine.setTempo(60);
    engine.play();
    expect(snapshots.at(-1)?.currentMeasure).toBe(1);
    await advance(1050);
    expect(snapshots.at(-1)).toMatchObject({
      state: "completed",
      currentMeasure: 1,
      progress: 1,
    });
  });

  it("schedules the final note before completing after a large clock step", async () => {
    const score = parseMusicXml(
      scoreXml(
        `${measure(1, note({ duration: 1 }), oneFour)}${measure(2, note({ step: "D", duration: 1 }), oneFour)}`,
      ),
    );
    const { engine, snapshots } = createEngine(score);
    engine.setTempo(60);
    engine.play();

    await advance(1900);

    const playedPitches = FakeAudioContext.latest?.oscillators
      .map((oscillator) => oscillator.frequency.value)
      .filter((frequency) => frequency > 200);
    expect(playedPitches).toEqual(
      expect.arrayContaining([midiToFrequency(60), midiToFrequency(62)]),
    );
    expect(snapshots.at(-1)?.state).toBe("playing");
    expect(snapshots.at(-1)?.progress).toBeCloseTo(0.95, 8);

    await advance(200);

    expect(snapshots.at(-1)).toMatchObject({
      state: "completed",
      progress: 1,
      positionBeat: 2,
    });
  });

  it("restarts from the beginning after completing playback", async () => {
    const { engine, snapshots } = createEngine();
    engine.setTempo(60);
    engine.play();
    await advance(2100);
    expect(snapshots.at(-1)?.state).toBe("completed");

    engine.play();
    expect(snapshots.at(-1)?.state).toBe("playing");
    expect(snapshots.at(-1)?.progress).toBe(0);
  });

  it("restarts the selected range and increments loop count", async () => {
    const { engine, snapshots } = createEngine();
    engine.setRange(0, 0);
    engine.setTempo(60);
    engine.setLoop(true);
    engine.play();
    await advance(2150);
    expect(snapshots.at(-1)?.state).toBe("playing");
    expect(snapshots.at(-1)?.loopCount).toBeGreaterThanOrEqual(2);
  });

  it("pauses and resumes from the current position", async () => {
    const { engine, snapshots } = createEngine();
    engine.setTempo(60);
    engine.play();
    await advance(500);
    engine.pause();
    const pausedPosition = snapshots.at(-1)?.positionBeat ?? 0;
    expect(snapshots.at(-1)?.state).toBe("paused");
    await advance(500);
    expect(snapshots.at(-1)?.positionBeat).toBeCloseTo(pausedPosition, 2);
    engine.play();
    await advance(100);
    expect(snapshots.at(-1)?.positionBeat).toBeGreaterThan(pausedPosition);
  });

  it("stops and resets to the selected range or score beginning", () => {
    const { engine, snapshots } = createEngine();
    engine.setRange(1, 1);
    engine.seekMeasure(1);
    engine.stop();
    expect(snapshots.at(-1)).toMatchObject({
      state: "stopped",
      currentMeasure: 1,
      progress: 0,
    });
    engine.reset();
    expect(snapshots.at(-1)).toMatchObject({
      state: "stopped",
      currentMeasure: 0,
      progress: 0,
    });
  });

  it("routes volume and mute changes through the master gain", () => {
    const { engine } = createEngine();
    engine.play();
    const context = FakeAudioContext.latest!;
    engine.setVolume(0.4);
    expect(context.masterGain?.gain.value).toBeCloseTo(0.4);
    engine.setMuted(true);
    expect(context.masterGain?.gain.value).toBe(0);
    engine.setMuted(false);
    expect(context.masterGain?.gain.value).toBeCloseTo(0.4);
  });

  it("cleans up interval, voice cleanup timers, and audio nodes on stop and dispose", async () => {
    const { engine } = createEngine();
    engine.play();
    await advance(20);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    engine.stop();
    expect(vi.getTimerCount()).toBe(0);
    engine.dispose();
    expect(FakeAudioContext.latest?.state).toBe("closed");
  });
});



describe("measure lengths in playback", () => {
  const withDivisions = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
  const q = (n = 1) => Array.from({ length: n }, () => note()).join("");

  it("does not pad a pickup bar into a silent hold", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(0, q(1), withDivisions) + measure(1, q(4)) + measure(2, q(4)),
      ),
    );
    expect(parsed.measures.map((m) => m.durationBeats)).toEqual([1, 4, 4]);
    expect(parsed.measures.map((m) => m.startBeat)).toEqual([0, 1, 5]);
  });

  it("joins a bar that was split across a line break into one bar", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(1, q(4), withDivisions) +
          measure(2, q(3)) +
          measure(3, q(1)) +
          measure(4, q(4)),
      ),
    );
    expect(parsed.measures.map((m) => m.durationBeats)).toEqual([4, 3, 1, 4]);
    expect(parsed.measures[3].startBeat).toBe(8);
  });

  it("lets a short closing bar complete the pickup", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(0, q(1), withDivisions) + measure(1, q(4)) + measure(2, q(3)),
      ),
    );
    expect(parsed.measures.map((m) => m.durationBeats)).toEqual([1, 4, 3]);
  });

  it("still pads an isolated short bar (likely a misread note) to a full bar", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(1, q(4), withDivisions) + measure(2, q(2)) + measure(3, q(4)),
      ),
    );
    expect(parsed.measures.map((m) => m.durationBeats)).toEqual([4, 4, 4]);
  });

  it("fills a missing beat once when two short bars add up to less than a bar", () => {
    const parsed = parseMusicXml(
      scoreXml(
        measure(1, q(4), withDivisions) +
          measure(2, q(2)) +
          measure(3, q(1)) +
          measure(4, q(4)),
      ),
    );
    expect(parsed.measures.map((m) => m.durationBeats)).toEqual([4, 2, 2, 4]);
    expect(parsed.measures[3].startBeat).toBe(8);
  });

  it("keeps two parts in step even when only one of them is short", () => {
    const second = `<part id="P2">${measure(0, q(1), withDivisions) + measure(1, q(4))}</part>`;
    const parsed = parseMusicXml(
      scoreXml(measure(0, q(1), withDivisions) + measure(1, q(4)), second),
    );
    const starts = parsed.parts
      .filter((p) => p.kind === "part")
      .map((p) => p.measures.map((m) => m.startBeat));
    expect(new Set(starts.map((s) => JSON.stringify(s))).size).toBe(1);
  });
});
