import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { splitStackedChordsIntoVoices } from "./voiceSplit";

// Mirrors what the app does: parse, split on the parsed copy, and (here only,
// to inspect the result) serialise. Returns the input string if nothing changed.
function sanitizeAudiverisMusicXml(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (!splitStackedChordsIntoVoices(doc as unknown as Document)) return xml;
  return new XMLSerializer().serializeToString(doc);
}

const n = (step: string, octave: number, dur: number, chord = false, extra = "") =>
  `<note>${chord ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>half</type>${extra}</note>`;
const rest = (dur: number) =>
  `<note><rest/><duration>${dur}</duration><voice>1</voice><type>half</type></note>`;
const attrs = `<attributes><divisions>2</divisions><time><beats>2</beats><beat-type>2</beat-type></time></attributes>`;
const m = (i: number, body: string) => `<measure number="${i}">${i === 1 ? attrs : ""}${body}</measure>`;
const score = (parts: string[]) =>
  `<score-partwise version="4.0"><part-list>${parts.map((_, i) => `<score-part id="P${i + 1}"><part-name>Voice</part-name></score-part>`).join("")}</part-list>${parts.map((body, i) => `<part id="P${i + 1}">${body}</part>`).join("")}</score-partwise>`;

// S over A, T over B: every note a stacked pair, one rest-only bar at the end.
const sa = m(1, n("D", 5, 4) + n("A", 4, 4, true)) + m(2, n("B", 4, 2) + n("G", 4, 2, true) + n("A", 4, 2) + n("F", 4, 2, true)) + m(3, n("G", 4, 4) + n("D", 4, 4, true)) + m(4, rest(4));
const tb = m(1, n("B", 3, 4) + n("G", 3, 4, true)) + m(2, n("D", 3, 2) + n("G", 2, 2, true) + n("E", 3, 2) + n("C", 3, 2, true)) + m(3, n("B", 2, 4) + n("G", 2, 4, true)) + m(4, rest(4));

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
const run = (parts: string[]) => sanitizeAudiverisMusicXml(score(parts));
const pitched = (xml: string, voice: string) =>
  voicesOf(xml, 0).filter((x) => x.voice === voice && !x.rest).map((x) => x.pitch);

describe("stacked chord -> voice split", () => {
  it("splits SA/TB stacked pairs: top stays voice 1, lower becomes voice 2", () => {
    const out = run([sa, tb]);
    expect(voicesOf(out, 0).some((x) => x.chord)).toBe(false);
    expect(pitched(out, "1")).toEqual(["D", "B", "A", "G"]);
    expect(pitched(out, "2")).toEqual(["A", "G", "F", "D"]);
    expect(out.match(/<backup>/g)?.length).toBeGreaterThan(0);
  });

  it("mirrors a rest into voice 2 in a measure that also has pairs", () => {
    const mixed = sa + m(5, rest(4) + n("B", 4, 4) + n("G", 4, 4, true));
    const notes = voicesOf(run([mixed]), 0);
    expect(notes.filter((x) => x.rest).map((x) => x.voice)).toEqual(["1", "1", "2"]);
  });

  it("leaves rest-only measures untouched", () => {
    const notes = voicesOf(run([sa, tb]), 0);
    expect(notes.filter((x) => x.rest).map((x) => x.voice)).toEqual(["1"]);
  });

  it("is idempotent", () => {
    const once = run([sa, tb]);
    expect(sanitizeAudiverisMusicXml(once)).toBe(once);
  });

  it("accepts a unison pair (soprano and alto on the same pitch)", () => {
    const uni = m(1, n("D", 4, 4) + n("D", 4, 4, true)) + sa;
    const out = run([uni]);
    expect(pitched(out, "1")[0]).toBe("D");
    expect(pitched(out, "2")[0]).toBe("D");
  });
});

describe("tolerance for messy OMR output", () => {
  it("gives a lone note a unison copy in voice 2", () => {
    const messy = sa + m(5, n("E", 4, 8));
    const out = run([messy]);
    expect(pitched(out, "1").at(-1)).toBe("E");
    expect(pitched(out, "2").at(-1)).toBe("E");
  });

  it("keeps only the top and bottom of a 3-note stack", () => {
    const messy = sa + m(5, n("E", 5, 8) + n("C", 5, 8, true) + n("G", 4, 8, true));
    const out = run([messy]);
    expect(pitched(out, "1").at(-1)).toBe("E");
    expect(pitched(out, "2").at(-1)).toBe("G");
    expect(voicesOf(out, 0).filter((x) => x.pitch === "C" && x.voice).length).toBe(0);
  });

  it("skips a measure whose pair has mismatched durations, still splits the rest", () => {
    const bad = m(5, n("D", 5, 4) + n("A", 4, 8, true));
    const out = run([sa + bad]);
    expect(pitched(out, "2").length).toBe(4); // only the 4 good pairs
    expect(out).toContain("<duration>8</duration>"); // bad measure untouched
  });
});

describe("playback integration", () => {
  it("parseMusicXml offers Soprano/Alto/Tenor/Bass without changing the drawn source", async () => {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
    const { parseMusicXml } = await import("./playback");
    const xml = score([sa, tb]);
    const names = parseMusicXml(xml).parts.map((p) => p.displayName);
    for (const label of ["Soprano", "Alto", "Tenor", "Bass"]) expect(names).toContain(label);
    expect(xml).toBe(score([sa, tb])); // the source string used for drawing is untouched
  });
});

describe("conservative no-ops (output must equal input exactly)", () => {
  const noop = (body: string) => {
    const xml = score([body]);
    expect(sanitizeAudiverisMusicXml(xml)).toBe(xml);
  };
  it("single-voice melody (godrest-like, no chords)", () =>
    noop(m(1, n("D", 4, 4) + n("E", 4, 4)) + m(2, n("F", 4, 8)) + m(3, n("G", 4, 8)) + m(4, n("A", 4, 8))));
  it("mostly single notes with an occasional pair", () =>
    noop(m(1, n("D", 5, 4) + n("A", 4, 4, true)) + m(2, n("B", 4, 8)) + m(3, n("C", 5, 8)) + m(4, n("D", 5, 8))));
  it("only three-note chords", () =>
    noop(
      [1, 2, 3, 4].map((i) => m(i, n("D", 5, 8) + n("A", 4, 8, true) + n("F", 4, 8, true))).join(""),
    ));
  it("too few note groups to judge", () =>
    noop(m(1, n("D", 5, 4) + n("A", 4, 4, true))));
  it("part that already has two voices written with backup", () =>
    noop(
      [1, 2, 3, 4]
        .map((i) => m(i, n("D", 5, 8) + `<backup><duration>8</duration></backup>` + n("A", 4, 8).replace("<voice>1", "<voice>2")))
        .join(""),
    ));
});
