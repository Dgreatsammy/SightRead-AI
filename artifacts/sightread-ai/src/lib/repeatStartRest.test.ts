import { readFileSync } from "node:fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMusicXml } from "./playback";
import { fillMissingRests } from "./restFill";
import { restoreRestAfterRepeat } from "./repeatStartRest";

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser = DOMParser;
  g.XMLSerializer = XMLSerializer;
});

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const attrs =
  "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
const note = (step: string, d = 1) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${d}</duration><voice>1</voice><type>quarter</type></note>`;
const startRepeat = `<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>`;
const m = (i: number, body: string, first = false) =>
  `<measure number="${i}">${first ? attrs : ""}${body}</measure>`;
const score = (...parts: string[]) =>
  `<score-partwise version="4.0"><part-list>${parts.map((_, i) => `<score-part id="P${i + 1}"><part-name>x</part-name></score-part>`).join("")}</part-list>${parts.map((b, i) => `<part id="P${i + 1}">${b}</part>`).join("")}</score-partwise>`;

const fullBar = note("C") + note("D") + note("E") + note("F");
const shortBar = note("C") + note("D") + note("E");

describe("restoreRestAfterRepeat", () => {
  it("writes the dropped opening rest in a short part at a start-repeat bar", () => {
    const xml = score(
      m(1, fullBar, true) + m(2, startRepeat + fullBar),
      m(1, fullBar, true) + m(2, startRepeat + shortBar),
    );
    const out = restoreRestAfterRepeat(xml);
    expect(out).not.toBe(xml);
    const part = parseMusicXml(out).parts[1];
    const bar = part.notes.filter((n) => n.measureIndex === 1);
    expect(bar[0]).toMatchObject({ isRest: true, startBeat: 4, durationBeats: 1 });
    expect(bar.filter((n) => !n.isRest).map((n) => n.startBeat)).toEqual([5, 6, 7]);
  });

  it("leaves everything alone when no bar has a start-repeat sign", () => {
    const xml = score(m(1, fullBar, true), m(1, shortBar, true));
    expect(restoreRestAfterRepeat(xml)).toBe(xml);
  });

  it("does not touch a pickup bar where every part is short", () => {
    const xml = score(
      m(1, startRepeat + shortBar, true) + m(2, fullBar),
      m(1, startRepeat + shortBar, true) + m(2, fullBar),
    );
    expect(restoreRestAfterRepeat(xml)).toBe(xml);
  });

  it("does not guess when the short bar already opens with a rest", () => {
    const rest = `<note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>`;
    const xml = score(
      m(1, fullBar, true) + m(2, startRepeat + fullBar),
      m(1, fullBar, true) + m(2, startRepeat + rest + note("C") + note("D")),
    );
    expect(restoreRestAfterRepeat(xml)).toBe(xml);
  });

  it("returns single-part scores and unreadable text unchanged", () => {
    const one = score(m(1, startRepeat + shortBar, true));
    expect(restoreRestAfterRepeat(one)).toBe(one);
    expect(restoreRestAfterRepeat("not xml")).toBe("not xml");
  });
});

describe("Ding Dong! Merrily on High (real Audiveris reading)", () => {
  const recognised = fixture("dingdong-clean-audiveris.xml");
  const truth = fixture("dingdong-true-cpdl.xml");
  const barNotes = (xml: string, partId: string, bar: number) =>
    parseMusicXml(xml)
      .parts.find((p) => p.id === partId)!
      .notes.filter((n) => n.measureIndex === bar && !n.isRest)
      .map((n) => `${n.startBeat}/${n.durationBeats}/${n.midi}`)
      .sort();

  it("before the fix, the bass line of the first chorus bar sounds a beat early", () => {
    expect(barNotes(recognised, "P2", 8)[0]).toMatch(/^32\//);
    expect(barNotes(truth, "P2", 8)[0]).toMatch(/^33\//);
  });

  it("after the fix, the first chorus bar sounds exactly like the true score", () => {
    const fixed = restoreRestAfterRepeat(recognised);
    expect(barNotes(fixed, "P2", 8)).toEqual(barNotes(truth, "P2", 8));
  });

  it("after the fix, no extra rest is drawn at the END of that bar", () => {
    const fixed = restoreRestAfterRepeat(recognised);
    const drawn = fillMissingRests(fixed);
    const doc = new DOMParser().parseFromString(drawn, "application/xml");
    const part2 = Array.from(doc.getElementsByTagName("part"))[1];
    const bar9 = Array.from(part2.getElementsByTagName("measure")).find(
      (el) => el.getAttribute("number") === "9",
    )!;
    const notes = Array.from(bar9.getElementsByTagName("note")).filter(
      (el) => el.parentNode === bar9,
    );
    const voice1 = notes.filter((el) => el.getElementsByTagName("voice")[0]?.textContent === "1");
    expect(voice1[0].getElementsByTagName("rest").length).toBe(1); // rest first
    expect(voice1[voice1.length - 1].getElementsByTagName("rest").length).toBe(0); // not last
  });

  it("changes nothing else in the score", () => {
    const fixed = restoreRestAfterRepeat(recognised);
    for (const bar of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13]) {
      expect(barNotes(fixed, "P1", bar)).toEqual(barNotes(recognised, "P1", bar));
      expect(barNotes(fixed, "P2", bar)).toEqual(barNotes(recognised, "P2", bar));
    }
  });
});
