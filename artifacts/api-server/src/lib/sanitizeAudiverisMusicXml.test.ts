import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { sanitizeAudiverisMusicXml } from "./sanitizeAudiverisMusicXml";

const n = (step: string, octave: number, dur: number, chord = false, extra = "") =>
  `<note>${chord ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>half</type>${extra}</note>`;
const rest = (dur: number) =>
  `<note><rest/><duration>${dur}</duration><voice>1</voice><type>half</type></note>`;
const attrs = `<attributes><divisions>2</divisions><time><beats>2</beats><beat-type>2</beat-type></time></attributes>`;
const m = (i: number, body: string) => `<measure number="${i}">${i === 1 ? attrs : ""}${body}</measure>`;
const score = (parts: string[]) =>
  `<score-partwise version="4.0"><part-list>${parts.map((_, i) => `<score-part id="P${i + 1}"><part-name>Voice</part-name></score-part>`).join("")}</part-list>${parts.map((body, i) => `<part id="P${i + 1}">${body}</part>`).join("")}</score-partwise>`;

// S over A, T over B: every note a stacked pair, one rest.
const sa = m(1, n("D", 5, 4) + n("A", 4, 4, true)) + m(2, n("B", 4, 2) + n("G", 4, 2, true) + n("A", 4, 2) + n("F", 4, 2, true)) + m(3, rest(4));
const tb = m(1, n("B", 3, 4) + n("G", 3, 4, true)) + m(2, n("D", 3, 2) + n("G", 2, 2, true) + n("E", 3, 2) + n("C", 3, 2, true)) + m(3, rest(4));

function voicesOf(xml: string, partIndex: number) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const part = doc.getElementsByTagName("part")[partIndex];
  return Array.from(part.getElementsByTagName("note")).map((el) => ({
    voice: el.getElementsByTagName("voice")[0]?.textContent,
    chord: el.getElementsByTagName("chord").length > 0,
    rest: el.getElementsByTagName("rest").length > 0,
    pitch: el.getElementsByTagName("step")[0]?.textContent,
  }));
}

describe("stacked chord -> voice split", () => {
  it("splits SA/TB stacked pairs: top stays voice 1, lower becomes voice 2", () => {
    const out = sanitizeAudiverisMusicXml(score([sa, tb]));
    const notes = voicesOf(out, 0);
    expect(notes.some((x) => x.chord)).toBe(false);
    const v1 = notes.filter((x) => x.voice === "1" && !x.rest).map((x) => x.pitch);
    const v2 = notes.filter((x) => x.voice === "2" && !x.rest).map((x) => x.pitch);
    expect(v1).toEqual(["D", "B", "A"]);
    expect(v2).toEqual(["A", "G", "F"]);
    expect(out.match(/<backup>/g)?.length).toBeGreaterThan(0);
  });

  it("mirrors a rest into voice 2 in a measure that also has pairs", () => {
    const mixed = m(1, n("D", 5, 4) + n("A", 4, 4, true)) + m(2, rest(4) + n("B", 4, 4) + n("G", 4, 4, true));
    const notes = voicesOf(sanitizeAudiverisMusicXml(score([mixed])), 0);
    expect(notes.filter((x) => x.rest).map((x) => x.voice)).toEqual(["1", "2"]);
  });

  it("leaves rest-only measures untouched", () => {
    const notes = voicesOf(sanitizeAudiverisMusicXml(score([sa, tb])), 0);
    expect(notes.filter((x) => x.rest).map((x) => x.voice)).toEqual(["1"]);
  });

  it("is idempotent", () => {
    const once = sanitizeAudiverisMusicXml(score([sa, tb]));
    expect(sanitizeAudiverisMusicXml(once)).toBe(once);
  });
});

describe("conservative no-ops (output must equal input exactly)", () => {
  const noop = (body: string) => {
    const xml = score([body]);
    expect(sanitizeAudiverisMusicXml(xml)).toBe(xml);
  };
  it("single-voice melody (godrest-like)", () =>
    noop(m(1, n("D", 4, 4) + n("E", 4, 4)) + m(2, n("F", 4, 8))));
  it("mixed singles and pairs", () =>
    noop(m(1, n("D", 5, 4) + n("A", 4, 4, true)) + m(2, n("B", 4, 8))));
  it("three-note chord", () =>
    noop(m(1, n("D", 5, 8) + n("A", 4, 8, true) + n("F", 4, 8, true))));
  it("unison pair", () => noop(m(1, n("D", 4, 8) + n("D", 4, 8, true))));
  it("pair with mismatched durations", () =>
    noop(m(1, n("D", 5, 4) + n("A", 4, 8, true))));
  it("part that already has a voice 2", () =>
    noop(m(1, n("D", 5, 8) + n("A", 4, 8, true).replace("<voice>1", "<voice>2"))));
});
