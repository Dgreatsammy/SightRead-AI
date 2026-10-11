import { readFileSync } from "node:fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMusicXml } from "./playback";
import { fillMissingRests, splitIntoRests } from "./restFill";

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser = DOMParser;
  g.XMLSerializer = XMLSerializer;
});

const attrs =
  "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
const q = (n: number, voice = "1") =>
  Array.from(
    { length: n },
    () =>
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>${voice}</voice><type>quarter</type></note>`,
  ).join("");
const half = `<note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>`;
const m = (i: number, body: string, first = false) =>
  `<measure number="${i}">${first ? attrs : ""}${body}</measure>`;
const score = (...parts: string[]) =>
  `<score-partwise version="4.0"><part-list>${parts.map((_, i) => `<score-part id="P${i + 1}"><part-name>x</part-name></score-part>`).join("")}</part-list>${parts.map((b, i) => `<part id="P${i + 1}">${b}</part>`).join("")}</score-partwise>`;

const restsIn = (xml: string) => (xml.match(/<rest\/>|<rest>/g) ?? []).length;

describe("splitIntoRests", () => {
  it("uses ordinary rest shapes", () => {
    expect(splitIntoRests(1)?.map((s) => s.type)).toEqual(["quarter"]);
    expect(splitIntoRests(3)).toEqual([{ beats: 3, type: "half", dots: 1 }]);
    expect(splitIntoRests(2.5)?.map((s) => s.beats)).toEqual([2, 0.5]);
  });
  it("refuses gaps it cannot write exactly", () => {
    expect(splitIntoRests(0.1)).toBeNull();
  });
});

describe("fillMissingRests", () => {
  // phrase end (2 beats) | pickup of the next phrase (1 beat): one beat unread
  const split = score(m(1, q(4), true) + m(2, half) + m(3, q(1)) + m(4, q(4)));

  it("draws the missing rest at the end of the FIRST short bar", () => {
    const out = fillMissingRests(split);
    expect(restsIn(out)).toBe(1);
    const doc = new DOMParser().parseFromString(out, "application/xml");
    const measures = Array.from(doc.getElementsByTagName("measure"));
    const bar2 = Array.from(measures[1].getElementsByTagName("note"));
    expect(bar2).toHaveLength(2);
    expect(bar2[1].getElementsByTagName("rest")).toHaveLength(1);
    expect(bar2[1].getElementsByTagName("type")[0].textContent).toBe("quarter");
    expect(measures[2].getElementsByTagName("rest")).toHaveLength(0); // the pickup is untouched
  });

  it("changes nothing when no bar needs a rest (output is the same text)", () => {
    const clean = score(m(1, q(1), true) + m(2, q(4)) + m(3, q(4)) + m(4, q(3)));
    expect(fillMissingRests(clean)).toBe(clean);
  });

  it("is idempotent", () => {
    const once = fillMissingRests(split);
    expect(fillMissingRests(once)).toBe(once);
  });

  it("never changes or removes an existing note", () => {
    const out = fillMissingRests(split);
    const count = (x: string) => (x.match(/<pitch>/g) ?? []).length;
    expect(count(out)).toBe(count(split));
  });

  it("returns the original text for something that is not a score", () => {
    expect(fillMissingRests("not xml at all")).toBe("not xml at all");
  });

  it("only fills the main line, not stray extra voices that reach the same point", () => {
    const bar2 = m(2, half + `<backup><duration>2</duration></backup>` + q(2, "2"));
    const out = fillMissingRests(score(m(1, q(4), true) + bar2 + m(3, q(1)) + m(4, q(4))));
    expect(restsIn(out)).toBe(1);
    const doc = new DOMParser().parseFromString(out, "application/xml");
    const rest = doc.getElementsByTagName("rest")[0].parentNode as unknown as Element;
    expect(rest.getElementsByTagName("voice")[0].textContent).toBe("1");
  });

  it("leaves a voice that stops short of the bar's notes alone", () => {
    const bar2 = m(2, half + `<backup><duration>2</duration></backup>` + q(1, "2"));
    const out = fillMissingRests(score(m(1, q(4), true) + bar2 + m(3, q(1)) + m(4, q(4))));
    // voice 1 reaches the end of the bar's notes (beat 2) and gets the rest; the
    // shorter voice 2 (1 beat) does not.
    expect(restsIn(out)).toBe(1);
  });
});

describe("real Godrest scan (openhymnal PDF)", () => {
  const xml = readFileSync(
    new URL("./__fixtures__/godrest-openhymnal-audiveris.xml", import.meta.url),
    "utf8",
  );

  it("draws the rest in bar 10 of both staves and nowhere unexpected", () => {
    const out = fillMissingRests(xml);
    expect(restsIn(out)).toBeGreaterThan(restsIn(xml));
    const doc = new DOMParser().parseFromString(out, "application/xml");
    for (const part of Array.from(doc.getElementsByTagName("part"))) {
      const bar10 = Array.from(part.getElementsByTagName("measure")).find(
        (mm) => mm.getAttribute("number") === "10",
      )!;
      expect(bar10.getElementsByTagName("rest").length).toBeGreaterThan(0);
    }
  });

  it("agrees with playback: same bar lengths and the same notes either way", () => {
    const out = fillMissingRests(xml);
    const before = parseMusicXml(xml);
    const after = parseMusicXml(out);
    expect(after.measures.map((x) => x.durationBeats)).toEqual(
      before.measures.map((x) => x.durationBeats),
    );
    const sounding = (s: ReturnType<typeof parseMusicXml>) =>
      s.parts.map((p) => p.notes.filter((n) => !n.isRest).length);
    expect(sounding(after)).toEqual(sounding(before));
  });

  it("puts the bar 10 silence before the pickup in bar 11 when played", () => {
    const score = parseMusicXml(xml);
    expect(score.measures[9].durationBeats).toBe(3); // 2 beats of notes + the unread rest
    expect(score.measures[10].durationBeats).toBe(1); // the pickup note only
  });
});
