import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMusicXml, type PlaybackMeasure, type PlaybackNote } from "./playback";
import {
  buildPlayOrder,
  hasRepeats,
  NO_REPEATS,
  readRepeatMarks,
  toPlayedMeasure,
  toPlayedRange,
  unrollForRepeats,
  type RepeatMarks,
} from "./repeats";

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
});

const marks = (m: Partial<RepeatMarks>): RepeatMarks => ({ ...NO_REPEATS, ...m });

describe("buildPlayOrder", () => {
  it("is a straight run when there are no repeat signs", () => {
    expect(buildPlayOrder(4, NO_REPEATS)).toEqual([0, 1, 2, 3]);
    expect(buildPlayOrder(4, undefined)).toEqual([0, 1, 2, 3]);
    expect(buildPlayOrder(0, marks({ backward: [{ measure: 0, times: 1 }] }))).toEqual([]);
  });
  it("plays a ||: ... :|| section twice", () => {
    expect(buildPlayOrder(5, marks({ forward: [1], backward: [{ measure: 3, times: 1 }] }))).toEqual([
      0, 1, 2, 3, 1, 2, 3, 4,
    ]);
  });
  it("repeats from the very start when only :|| is present", () => {
    expect(buildPlayOrder(4, marks({ backward: [{ measure: 2, times: 1 }] }))).toEqual([0, 1, 2, 0, 1, 2, 3]);
  });
  it("handles two repeated sections one after the other", () => {
    const order = buildPlayOrder(
      6,
      marks({ forward: [0, 3], backward: [{ measure: 2, times: 1 }, { measure: 5, times: 1 }] }),
    );
    expect(order).toEqual([0, 1, 2, 0, 1, 2, 3, 4, 5, 3, 4, 5]);
  });
  it("only repeats the second section when the first sign was not read (Ding Dong)", () => {
    const order = buildPlayOrder(16, marks({ forward: [8], backward: [{ measure: 15, times: 1 }] }));
    expect(order).toHaveLength(24);
    expect(order.slice(14, 18)).toEqual([14, 15, 8, 9]);
  });
  it("plays the section the stated number of times", () => {
    expect(buildPlayOrder(3, marks({ forward: [0], backward: [{ measure: 1, times: 2 }] }))).toEqual([
      0, 1, 0, 1, 0, 1, 2,
    ]);
  });
  it("plays first and second endings on the right passes", () => {
    const m = marks({
      forward: [0],
      backward: [{ measure: 2, times: 1 }],
      endings: [
        { start: 2, stop: 2, numbers: [1] },
        { start: 3, stop: 3, numbers: [2] },
      ],
    });
    expect(buildPlayOrder(5, m)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });
  it("handles endings that are two bars long", () => {
    const m = marks({
      forward: [0],
      backward: [{ measure: 3, times: 1 }],
      endings: [
        { start: 2, stop: 3, numbers: [1] },
        { start: 4, stop: 5, numbers: [2] },
      ],
    });
    expect(buildPlayOrder(7, m)).toEqual([0, 1, 2, 3, 0, 1, 4, 5, 6]);
  });
  it("cannot loop forever on odd input", () => {
    const m = marks({
      forward: [0, 1],
      backward: [{ measure: 0, times: 8 }, { measure: 1, times: 8 }],
    });
    expect(buildPlayOrder(2, m).length).toBeLessThan(200);
  });
});

const note = (measureIndex: number, startBeat: number, midi = 60): PlaybackNote => ({
  startBeat,
  durationBeats: 1,
  midi,
  measureIndex,
  isRest: false,
});
const bars = (n: number): PlaybackMeasure[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, number: String(i + 1), startBeat: i * 4, durationBeats: 4 }));

describe("unrollForRepeats", () => {
  it("returns the same objects when nothing repeats", () => {
    const notes = [note(0, 0), note(1, 4)];
    const measures = bars(2);
    const out = unrollForRepeats(notes, measures, [0, 1]);
    expect(out.notes).toBe(notes);
    expect(out.measures).toBe(measures);
  });
  it("copies repeated bars after each other with correct times", () => {
    const notes = [note(0, 0, 60), note(1, 4, 62), note(2, 8, 64)];
    const out = unrollForRepeats(notes, bars(3), [0, 1, 0, 1, 2]);
    expect(out.measures.map((m) => m.startBeat)).toEqual([0, 4, 8, 12, 16]);
    expect(out.measures.map((m) => m.index)).toEqual([0, 1, 2, 3, 4]);
    expect(out.notes.map((n) => [n.startBeat, n.midi, n.measureIndex])).toEqual([
      [0, 60, 0], [4, 62, 1], [8, 60, 2], [12, 62, 3], [16, 64, 4],
    ]);
    expect(out.order).toEqual([0, 1, 0, 1, 2]);
  });
  it("keeps the bars' own names so the screen can show the original numbers", () => {
    const out = unrollForRepeats([note(0, 0)], bars(1), [0, 0]);
    expect(out.measures.map((m) => m.number)).toEqual(["1", "1"]);
  });
  it("honours a first bar that does not start at zero", () => {
    const measures = bars(2).map((m) => ({ ...m, startBeat: m.startBeat + 1 }));
    const out = unrollForRepeats([note(0, 1), note(1, 5)], measures, [0, 1, 0, 1]);
    expect(out.measures[0].startBeat).toBe(1);
    expect(out.measures[2].startBeat).toBe(9);
  });
});

describe("mapping what the person chose onto the played bars", () => {
  const order = [0, 1, 2, 3, 1, 2, 3, 4];
  it("a loop over original bars covers the repeats inside it", () => {
    expect(toPlayedRange(order, 1, 2)).toEqual([1, 5]);
    expect(toPlayedRange(order, 0, 4)).toEqual([0, 7]);
  });
  it("jumping to a bar goes to the first time it is played", () => {
    expect(toPlayedMeasure(order, 1)).toBe(1);
    expect(toPlayedMeasure(order, 4)).toBe(7);
  });
  it("falls back safely for a bar that does not exist", () => {
    expect(toPlayedRange(order, 40, 50)).toEqual([0, 7]);
    expect(toPlayedMeasure(order, 40)).toBe(0);
  });
});

const wrap = (...parts: string[]) =>
  `<score-partwise><part-list/>${parts.map((b, i) => `<part id="P${i + 1}">${b}</part>`).join("")}</score-partwise>`;
const bar = (n: number, extra = "") => `<measure number="${n}">${extra}</measure>`;
const rep = (dir: string, times = "") => `<barline><repeat direction="${dir}"${times}/></barline>`;

describe("readRepeatMarks", () => {
  const read = (xml: string) =>
    readRepeatMarks(Array.from(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("part")) as unknown as Element[]);

  it("reads forward and backward signs", () => {
    const r = read(wrap(bar(1) + bar(2, rep("forward")) + bar(3) + bar(4, rep("backward"))));
    expect(r.forward).toEqual([1]);
    expect(r.backward).toEqual([{ measure: 3, times: 1 }]);
    expect(hasRepeats(r)).toBe(true);
  });
  it("reads a times count as total plays", () => {
    const r = read(wrap(bar(1, rep("backward", ' times="3"'))));
    expect(r.backward).toEqual([{ measure: 0, times: 2 }]);
  });
  it("joins signs found in different staves", () => {
    const r = read(wrap(bar(1, rep("forward")) + bar(2), bar(1, rep("forward")) + bar(2, rep("backward"))));
    expect(r.forward).toEqual([0]);
    expect(r.backward).toEqual([{ measure: 1, times: 1 }]);
  });
  it("reads first and second endings", () => {
    const xml = wrap(
      bar(1) + bar(2, `<barline><ending number="1" type="start"/></barline><barline><ending number="1" type="stop"/><repeat direction="backward"/></barline>`) +
        bar(3, `<barline><ending number="2" type="start"/></barline><barline><ending number="2" type="discontinue"/></barline>`),
    );
    const r = read(xml);
    expect(r.endings).toEqual([
      { start: 1, stop: 1, numbers: [1] },
      { start: 2, stop: 2, numbers: [2] },
    ]);
    expect(buildPlayOrder(3, r)).toEqual([0, 1, 0, 2]);
  });
  it("finds nothing in a score without repeats", () => {
    expect(hasRepeats(read(wrap(bar(1) + bar(2))))).toBe(false);
  });
});

describe("real recognised score: Ding Dong (CPDL PDF)", () => {
  const xml = readFileSync(new URL("./__fixtures__/dingdong-clean-audiveris.xml", import.meta.url), "utf8");
  it("finds the repeat the recogniser read and plays that section twice", () => {
    const score = parseMusicXml(xml);
    expect(hasRepeats(score.repeats)).toBe(true);
    const order = buildPlayOrder(score.measures.length, score.repeats);
    expect(order.length).toBeGreaterThan(score.measures.length);
  });
  it("the true score plays bars 1-8 three times and 9-16 twice (40 bars of sound)", () => {
    const trueXml = readFileSync(new URL("./__fixtures__/dingdong-true-cpdl.xml", import.meta.url), "utf8");
    const score = parseMusicXml(trueXml);
    expect(score.repeats?.forward).toEqual([0, 8]);
    expect(score.repeats?.backward).toEqual([
      { measure: 7, times: 2 }, // times="3" in the file = played three times in all
      { measure: 15, times: 1 },
    ]);
    expect(buildPlayOrder(score.measures.length, score.repeats)).toHaveLength(40);
  });
  it("the recogniser missed the first repeat, so only the second section is doubled", () => {
    const score = parseMusicXml(xml);
    expect(score.repeats?.forward).toEqual([8]);
    expect(buildPlayOrder(score.measures.length, score.repeats)).toHaveLength(24);
  });
});
