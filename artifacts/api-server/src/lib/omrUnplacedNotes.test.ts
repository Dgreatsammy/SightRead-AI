import JSZip from "jszip";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findUnplacedNotesInSheet, readUnplacedNotes } from "./omrUnplacedNotes";

const measure = (id: number, chords: string[], placed: string[]) =>
  `<measure id="${id}"><head-chords>${chords.join(" ")}</head-chords><voice id="1"><slots>` +
  placed.map((c, i) => `<entry><key>${i + 1}</key><value chord="${c}" status="BEGIN"/></entry>`).join("") +
  `</slots></voice></measure>`;

describe("findUnplacedNotesInSheet", () => {
  it("reports nothing when every chord is placed", () => {
    const xml = `<sheet>${measure(1, ["1", "2", "3"], ["1", "2", "3"])}</sheet>`;
    expect(findUnplacedNotesInSheet(xml)).toEqual([]);
  });

  it("counts the chords that were found but not placed", () => {
    const xml = `<sheet>${measure(1, ["1", "2"], ["1", "2"])}${measure(2, ["3", "4", "5", "6"], ["3"])}</sheet>`;
    expect(findUnplacedNotesInSheet(xml)).toEqual([{ bar: 2, count: 3 }]);
  });

  it("adds up the staves of the same bar", () => {
    const xml = `<sheet>${measure(4, ["1", "2"], ["1"])}${measure(4, ["7", "8"], ["7"])}</sheet>`;
    expect(findUnplacedNotesInSheet(xml)).toEqual([{ bar: 4, count: 2 }]);
  });

  it("ignores text that is not a project file", () => {
    expect(findUnplacedNotesInSheet("not xml at all")).toEqual([]);
    expect(findUnplacedNotesInSheet("")).toEqual([]);
  });

  it("finds exactly the five lost soprano notes in chorus bar 9 of the real Ding Dong reading", async () => {
    const real = await fs.readFile(
      new URL("./__fixtures__/dingdong-sheet-measures.xml", import.meta.url),
      "utf8",
    );
    // Verified against the true score: bar 9's top staff lost its run of
    // eighth notes, and no other bar had a note left out.
    expect(findUnplacedNotesInSheet(real)).toEqual([{ bar: 9, count: 5 }]);
  });
});

describe("readUnplacedNotes", () => {
  const writeOmr = async (sheets: Record<string, string>) => {
    const zip = new JSZip();
    zip.file("book.xml", "<book/>");
    for (const [name, xml] of Object.entries(sheets)) zip.file(`sheet#${name}/sheet#${name}.xml`, xml);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-"));
    const file = path.join(dir, "score.omr");
    await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
    return file;
  };

  it("reads every page and labels results with the page number", async () => {
    const file = await writeOmr({
      "1": `<sheet>${measure(1, ["1"], ["1"])}</sheet>`,
      "2": `<sheet>${measure(3, ["1", "2"], [])}</sheet>`,
    });
    expect(await readUnplacedNotes(file)).toEqual([{ page: 2, bar: 3, count: 2 }]);
  });

  it("returns an empty list for a missing or corrupt file instead of throwing", async () => {
    expect(await readUnplacedNotes("/no/such/file.omr")).toEqual([]);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omr-"));
    const bad = path.join(dir, "bad.omr");
    await fs.writeFile(bad, "not a zip");
    expect(await readUnplacedNotes(bad)).toEqual([]);
  });
});
