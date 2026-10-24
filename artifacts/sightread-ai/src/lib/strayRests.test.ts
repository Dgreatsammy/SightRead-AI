import { readFileSync } from "node:fs";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { hideDuplicateVoiceRests } from "./strayRests";

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser = DOMParser;
  g.XMLSerializer = XMLSerializer;
});

const attrs =
  "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
const n = (step: string, voice: string, d = 1) =>
  `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${d}</duration><voice>${voice}</voice><type>quarter</type></note>`;
const rest = (voice: string, d = 1) =>
  `<note><rest/><duration>${d}</duration><voice>${voice}</voice><type>quarter</type></note>`;
const bk = (d: number) => `<backup><duration>${d}</duration></backup>`;
const fw = (d: number) => `<forward><duration>${d}</duration></forward>`;
const wrap = (body: string) =>
  `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list><part id="P1"><measure number="1">${attrs}${body}</measure></part></score-partwise>`;
// Every sounding note straight from the XML (bar, start, length, pitch), with
// no playback re-voicing in between, so the check is about the text itself.
const sounding = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, "application/xml") as unknown as Document;
  const text = (el: Element, tag: string) => el.getElementsByTagName(tag)[0]?.textContent ?? "";
  const out: string[] = [];
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    for (const measure of Array.from(part.getElementsByTagName("measure"))) {
      let cursor = 0;
      let lastStart = 0;
      for (const el of Array.from(measure.childNodes).filter(
        (node): node is Element => node.nodeType === 1,
      )) {
        if (el.tagName === "backup") cursor -= Number(text(el, "duration"));
        else if (el.tagName === "forward") cursor += Number(text(el, "duration"));
        else if (el.tagName === "note") {
          const d = Number(text(el, "duration"));
          const chord = el.getElementsByTagName("chord").length > 0;
          const start = chord ? lastStart : cursor;
          if (!chord) {
            lastStart = cursor;
            cursor += d;
          }
          if (el.getElementsByTagName("rest").length === 0)
            out.push(
              `${part.getAttribute("id")} m${measure.getAttribute("number")} ${start}/${d}/${text(el, "step")}${text(el, "alter")}${text(el, "octave")}`,
            );
        }
      }
    }
  }
  return out.sort();
};
const restCount = (xml: string) => (xml.match(/<rest\/>|<rest>/g) ?? []).length;

describe("hideDuplicateVoiceRests", () => {
  it("hides a voice-2 rest that a voice-3 line fully covers", () => {
    // v1 four notes; v2 two notes + a rest on beat 3; v3 plays beats 3-4
    const exact = wrap(
      n("C", "1") + n("D", "1") + n("E", "1") + n("F", "1") +
        bk(4) + n("A", "2") + n("A", "2") + rest("2") +
        bk(2) + n("G", "3") + n("G", "3"),
    );
    const out = hideDuplicateVoiceRests(exact);
    expect(restCount(exact)).toBe(1);
    expect(restCount(out)).toBe(0);
    // every sounding note keeps its place
    expect(sounding(out)).toEqual(sounding(exact));
  });

  it("keeps a resting inner voice that only the main line covers", () => {
    const xml = wrap(
      n("C", "1") + n("D", "1") + n("E", "1") + n("F", "1") +
        bk(4) + rest("2") + n("A", "2") + n("A", "2") + n("A", "2"),
    );
    expect(hideDuplicateVoiceRests(xml)).toBe(xml);
  });

  it("keeps a rest that the third voice covers only partly", () => {
    const xml = wrap(
      n("C", "1") + n("D", "1") + n("E", "1") + n("F", "1") +
        bk(4) + n("A", "2") + n("A", "2") + rest("2", 2) +
        bk(2) + n("G", "3"),
    );
    expect(hideDuplicateVoiceRests(xml)).toBe(xml);
  });

  it("returns unreadable text unchanged", () => {
    expect(hideDuplicateVoiceRests("not xml")).toBe("not xml");
  });
});

describe("Ding Dong! Merrily on High (real Audiveris reading)", () => {
  const recognised = readFileSync(
    new URL("./__fixtures__/dingdong-clean-audiveris.xml", import.meta.url),
    "utf8",
  );
  const restsByBar = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const found: string[] = [];
    for (const part of Array.from(doc.getElementsByTagName("part"))) {
      for (const measure of Array.from(part.getElementsByTagName("measure"))) {
        for (const note of Array.from(measure.getElementsByTagName("note"))) {
          if (note.getElementsByTagName("rest").length)
            found.push(`${part.getAttribute("id")} m${measure.getAttribute("number")}`);
        }
      }
    }
    return found;
  };

  it("removes only the two stray rests under the beamed notes (bars 1 and 5)", () => {
    const before = restsByBar(recognised);
    const after = restsByBar(hideDuplicateVoiceRests(recognised));
    expect(before).toEqual(["P1 m1", "P1 m5", "P1 m11", "P1 m13", "P2 m11", "P2 m13"]);
    // the rests that the true score really has are all still there
    expect(after).toEqual(["P1 m11", "P1 m13", "P2 m11", "P2 m13"]);
  });

  it("does not move a single sounding note", () => {
    const fixed = hideDuplicateVoiceRests(recognised);
    expect(sounding(fixed)).toEqual(sounding(recognised));
    expect(sounding(fixed).length).toBeGreaterThan(200);
  });
});
