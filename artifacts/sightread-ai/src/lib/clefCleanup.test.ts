import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanClefs, octaveMarkFits } from "./clefCleanup";

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser = DOMParser;
  g.XMLSerializer = XMLSerializer;
});

const clef = (sign: string, line: number, octave?: number, number?: number) =>
  `<clef${number ? ` number="${number}"` : ""}><sign>${sign}</sign><line>${line}</line>${octave ? `<clef-octave-change>${octave}</clef-octave-change>` : ""}</clef>`;
const note = (step: string, oct: number, staff?: number) =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>1</duration>${staff ? `<staff>${staff}</staff>` : ""}</note>`;
const part = (attrs: string[], notes: string, later = "") =>
  `<score-partwise><part-list/><part id="P1"><measure number="1"><attributes>${attrs.join("")}</attributes>${notes}</measure>${later}</part></score-partwise>`;

describe("octaveMarkFits", () => {
  it("rejects an octave-up treble clef on a soprano line", () => {
    expect(octaveMarkFits("G", 1, 71)).toBe(false);
  });
  it("keeps a real tenor treble-8 clef (tenor notes sit low)", () => {
    expect(octaveMarkFits("G", -1, 55)).toBe(true);
  });
  it("keeps an eight-below bass clef on a very low line", () => {
    expect(octaveMarkFits("F", -1, 40)).toBe(true);
  });
  it("rejects an octave-up treble clef on a bass line", () => {
    expect(octaveMarkFits("G", 1, 53)).toBe(false);
  });
  it("leaves plain clefs and unknown clefs alone", () => {
    expect(octaveMarkFits("G", 0, 60)).toBe(true);
    expect(octaveMarkFits("X", 1, 60)).toBe(true);
  });
});

describe("cleanClefs (cases from real Audiveris output)", () => {
  it("drops the ghost octave clef that sat in front of the bass clef", () => {
    const xml = part([clef("G", 2, 1), clef("F", 4)], note("A", 3) + note("D", 3));
    const out = cleanClefs(xml);
    expect(out.removedClefs).toBe(1);
    expect(out.xml).toContain("<sign>F</sign>");
    expect(out.xml).not.toContain("clef-octave-change");
  });
  it("drops the doubled treble clef, keeping the plain one", () => {
    const xml = part([clef("G", 2, 1), clef("G", 2)], note("D", 4) + note("A", 4));
    const out = cleanClefs(xml);
    expect(out.removedClefs).toBe(1);
    expect(out.xml).not.toContain("clef-octave-change");
  });
  it("removes an octave mark in the middle of a soprano line", () => {
    const later = `<measure number="2"><attributes>${clef("G", 2, 1)}</attributes></measure>`;
    const out = cleanClefs(part([clef("G", 2)], note("B", 4) + note("G", 4) + note("D", 5), later));
    expect(out.removedOctaveMarks).toBe(1);
    expect(out.xml).not.toContain("clef-octave-change");
    expect(out.xml).toContain("<sign>G</sign>");
  });
  it("keeps a genuine tenor clef", () => {
    const xml = part([clef("G", 2, -1)], note("D", 3) + note("G", 3) + note("C", 4));
    const out = cleanClefs(xml);
    expect(out.xml).toBe(xml);
  });
  it("never changes a note's pitch", () => {
    const xml = part([clef("G", 2, 1), clef("G", 2)], note("D", 4));
    expect(cleanClefs(xml).xml).toContain("<octave>4</octave>");
  });
  it("treats each staff of a two-staff part separately", () => {
    const xml = part(
      [clef("G", 2, undefined, 1), clef("F", 4, undefined, 2)],
      note("E", 5, 1) + note("C", 3, 2),
    );
    expect(cleanClefs(xml).xml).toBe(xml);
  });
  it("returns the same text when there is nothing to change", () => {
    const xml = part([clef("G", 2)], note("C", 4));
    expect(cleanClefs(xml)).toEqual({ xml, removedClefs: 0, removedOctaveMarks: 0 });
  });
  it("is idempotent", () => {
    const once = cleanClefs(part([clef("G", 2, 1), clef("F", 4)], note("A", 3))).xml;
    expect(cleanClefs(once).removedClefs).toBe(0);
    expect(cleanClefs(once).removedOctaveMarks).toBe(0);
  });
  it("returns something that is not a score untouched", () => {
    expect(cleanClefs("not xml").xml).toBe("not xml");
  });
});
