import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { compareScores, formatAccuracyReport, normaliseWord, summariseScore } from "./omrAccuracy";

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
});

type NoteOpts = { chord?: boolean; lyric?: [string, string]; rest?: boolean };
const n = (step: string, oct: number, dur: number, o: NoteOpts = {}) =>
  `<note>${o.chord ? "<chord/>" : ""}${o.rest ? "<rest/>" : `<pitch><step>${step}</step><octave>${oct}</octave></pitch>`}<duration>${dur}</duration>${
    o.lyric ? `<lyric number="1"><syllabic>${o.lyric[1]}</syllabic><text>${o.lyric[0]}</text></lyric>` : ""
  }</note>`;
const attrs = (fifths = 0, time = "4/4") => {
  const [b, t] = time.split("/");
  return `<attributes><divisions>1</divisions><key><fifths>${fifths}</fifths></key><time><beats>${b}</beats><beat-type>${t}</beat-type></time></attributes>`;
};
const m = (i: number, body: string, a = "") => `<measure number="${i}">${a}${body}</measure>`;
const score = (parts: string[], extra = "") =>
  `<score-partwise><part-list>${parts.map((_, i) => `<score-part id="P${i + 1}"><part-name>x</part-name></score-part>`).join("")}</part-list>${parts.map((b, i) => `<part id="P${i + 1}">${b}${extra}</part>`).join("")}</score-partwise>`;

// A small two-voice piece: soprano line and alto line, four quarter notes per bar.
const soprano = (fifths = 0, time = "4/4") =>
  m(1, n("E", 5, 1, { lyric: ["God", "single"] }) + n("D", 5, 1, { lyric: ["rest", "single"] }) + n("C", 5, 1, { lyric: ["ye", "single"] }) + n("B", 4, 1, { lyric: ["mer", "begin"] }), attrs(fifths, time)) +
  m(2, n("A", 4, 4, { lyric: ["ry", "end"] }));
const alto = () => m(1, n("C", 5, 1) + n("B", 4, 1) + n("A", 4, 1) + n("G", 4, 1), attrs()) + m(2, n("E", 4, 4));
const stacked = () =>
  m(1, n("E", 5, 1, { lyric: ["God", "single"] }) + n("C", 5, 1, { chord: true }) +
       n("D", 5, 1, { lyric: ["rest", "single"] }) + n("B", 4, 1, { chord: true }) +
       n("C", 5, 1, { lyric: ["ye", "single"] }) + n("A", 4, 1, { chord: true }) +
       n("B", 4, 1, { lyric: ["mer", "begin"] }) + n("G", 4, 1, { chord: true }), attrs()) +
  m(2, n("A", 4, 4, { lyric: ["ry", "end"] }) + n("E", 4, 4, { chord: true }));

const truth = score([soprano(), alto()]);

describe("compareScores", () => {
  it("scores 100% when the recognised score matches", () => {
    const r = compareScores(truth, truth);
    expect(r).toMatchObject({ chordAccuracy: 100, melodyAccuracy: 100, bassAccuracy: 100, rhythmAccuracy: 100, missedGroups: 0, extraGroups: 0, lyricWordAccuracy: 100, lyricLetterAccuracy: 100 });
  });

  it("does not care how the parts are organised (two parts vs stacked chords)", () => {
    const r = compareScores(truth, score([stacked()]));
    expect(r.chordAccuracy).toBe(100);
    expect(r.melodyAccuracy).toBe(100);
    expect(r.bassAccuracy).toBe(100);
  });

  it("does not care where bars were split, as long as the notes are the same", () => {
    const split = score([
      m(1, n("E", 5, 1, { lyric: ["God", "single"] }) + n("D", 5, 1, { lyric: ["rest", "single"] }), attrs()) +
        m(2, n("C", 5, 1, { lyric: ["ye", "single"] }) + n("B", 4, 1, { lyric: ["mer", "begin"] })) +
        m(3, n("A", 4, 4, { lyric: ["ry", "end"] })),
      m(1, n("C", 5, 1) + n("B", 4, 1), attrs()) + m(2, n("A", 4, 1) + n("G", 4, 1)) + m(3, n("E", 4, 4)),
    ]);
    const r = compareScores(truth, split);
    expect(r.chordAccuracy).toBe(100);
    expect(r.lyricWordAccuracy).toBe(100);
  });

  it("counts a wrong note and says which line it hurt", () => {
    const wrong = score([soprano(), m(1, n("C", 5, 1) + n("B", 4, 1) + n("A", 4, 1) + n("G", 3, 1), attrs()) + m(2, n("E", 4, 4))]);
    const r = compareScores(truth, wrong);
    expect(r.bassAccuracy).toBeLessThan(100);
    expect(r.melodyAccuracy).toBe(100);
    expect(r.chordAccuracy).toBeLessThan(100);
  });

  it("counts a missing note group", () => {
    const missing = score([soprano(), m(1, n("C", 5, 1) + n("B", 4, 1) + n("A", 4, 1), attrs()) + m(2, n("E", 4, 4))]);
    expect(compareScores(truth, missing).chordAccuracy).toBeLessThan(100);
  });

  it("counts an extra note group", () => {
    const extra = score([soprano(), alto()], ``).replace("</part>", `${m(3, n("C", 4, 4))}</part>`);
    expect(compareScores(truth, extra).extraGroups).toBeGreaterThan(0);
  });

  it("checks rhythm separately from pitch", () => {
    const tune = (firstLength: number) => score([m(1, n("C", 4, firstLength) + n("D", 4, 1) + n("E", 4, 1) + n("F", 4, 1), attrs())]);
    const r = compareScores(tune(1), tune(2));
    expect(r.chordAccuracy).toBe(100);
    expect(r.rhythmAccuracy).toBeLessThan(100);
    expect(compareScores(tune(1), tune(1)).rhythmAccuracy).toBe(100);
  });

  it("measures word accuracy and lists the mistakes", () => {
    const typo = truth.replace("<text>rest</text>", "<text>rcst</text>");
    const r = compareScores(truth, typo);
    expect(r.lyricWordAccuracy).toBe(75);
    expect(r.lyricMistakes).toEqual([{ truth: "rest", recognised: "rcst" }]);
  });

  it("flags a wrong key and time signature and counts invented dynamics", () => {
    const r = compareScores(
      truth,
      score([soprano(1, "2/2"), alto()]).replace("</measure>", "<direction><direction-type><dynamics><p/></dynamics></direction-type></direction></measure>"),
    );
    expect(r.structure.key.ok).toBe(false);
    expect(r.structure.timeSignature.ok).toBe(false);
    expect(r.inventedDynamics).toBe(1);
  });
});

describe("lyrics: letters, verses and page footers", () => {
  const withLyrics = (words: Array<[string, string]>, verse = "1") =>
    score([
      m(1, words.map(([text, syl]) => n("C", 4, 1, { lyric: [text, syl] }).replace('<lyric number="1">', `<lyric number="${verse}">`)).join(""), attrs()),
    ]);

  it("measures spelling letter by letter, so splitting a word differently does not count against it", () => {
    const truthLyrics = withLyrics([["mer", "begin"], ["ri", "middle"], ["ly", "end"], ["on", "single"]]);
    const readLyrics = withLyrics([["merri", "begin"], ["ly", "end"], ["on", "single"], ["", "single"]]);
    expect(compareScores(truthLyrics, readLyrics).lyricLetterAccuracy).toBe(100);
  });

  it("scores a misspelt word", () => {
    const a = withLyrics([["sky", "single"], ["looked", "single"]]);
    const b = withLyrics([["siy", "single"], ["looked", "single"]]);
    expect(compareScores(a, b).lyricLetterAccuracy).toBeCloseTo(88.9, 1);
  });

  it("reports footer and credit text that was read as lyrics", () => {
    const clean = withLyrics([["God", "single"], ["rest", "single"]]);
    const junky = withLyrics([
      ["God", "single"], ["rest", "single"],
      ["edition", "single"], ["klaus@foehl.net", "single"], ["CPDL", "single"],
    ]);
    const r = compareScores(clean, junky);
    expect(r.junkLyrics).toEqual(["edition", "klaus@foehl.net", "CPDL"]);
    expect(r.lyricLetterAccuracy).toBe(100); // the footer is kept out of the spelling score
  });

  it("finds footer text attached to notes in a different staff than the main lyrics", () => {
    const lyricsStaff = m(1, n("C", 4, 1, { lyric: ["God", "single"] }) + n("D", 4, 1, { lyric: ["rest", "single"] }), attrs());
    const otherStaff = m(1, n("C", 3, 1, { lyric: ["CPDL", "single"] }) + n("D", 3, 1), attrs());
    const clean = score([lyricsStaff]);
    const junky = score([lyricsStaff, otherStaff]);
    expect(compareScores(clean, junky).junkLyrics).toEqual(["CPDL"]);
  });

  it("does not blame the recogniser for footer text that is in the true score too", () => {
    const both = withLyrics([["God", "single"], ["CPDL", "single"]]);
    expect(compareScores(both, both).junkLyrics).toEqual([]);
  });

  it("counts verses", () => {
    const one = withLyrics([["God", "single"]]);
    expect(compareScores(one, one).verses).toEqual({ truth: 1, recognised: 1 });
  });
});

describe("helpers", () => {
  it("folds accents and punctuation in words", () => {
    expect(normaliseWord("Bless\u00e8d,")).toBe("blessed");
    expect(normaliseWord("pow'r")).toBe("powr");
  });
  it("summarises a score", () => {
    const s = summariseScore(truth);
    expect(s.parts).toBe(2);
    expect(s.measures).toBe(2);
    expect(s.totalBeats).toBe(8);
    expect(s.lyricWords).toEqual(["god", "rest", "ye", "merry"]);
  });
  it("formats a readable report", () => {
    const text = formatAccuracyReport("Test piece", compareScores(truth, truth));
    expect(text).toContain("## Test piece");
    expect(text).toContain("Bass (bottom line): 100% right");
    expect(text).toContain("letter by letter");
  });
});
