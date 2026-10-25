import { describe, expect, it } from "vitest";
import { describeUnplacedNotes, readUnplacedNotes } from "./unplacedNotice";

describe("describeUnplacedNotes", () => {
  it("says nothing when no notes were left out", () => {
    expect(describeUnplacedNotes([])).toBe("");
  });

  it("names a single bar", () => {
    expect(describeUnplacedNotes([{ page: 1, bar: 9, count: 5 }])).toBe(
      "Bar 9 is incomplete: 5 notes were read but could not be placed, so what you see and hear there is not reliable.",
    );
  });

  it("uses singular for one note", () => {
    expect(describeUnplacedNotes([{ page: 1, bar: 2, count: 1 }])).toContain("1 note was read");
  });

  it("lists several bars, adds up the notes, and mentions the page after page 1", () => {
    const text = describeUnplacedNotes([
      { page: 1, bar: 9, count: 5 },
      { page: 2, bar: 3, count: 2 },
    ]);
    expect(text).toBe(
      "Bars 9 and 3 (page 2) are incomplete: 7 notes were read but could not be placed, so what you see and hear there is not reliable.",
    );
  });
});

describe("readUnplacedNotes", () => {
  it("keeps good entries and drops malformed ones", () => {
    expect(
      readUnplacedNotes([
        { page: 1, bar: 9, count: 5 },
        { page: 1, bar: 0, count: 2 },
        { page: "1", bar: 2, count: 2 },
        null,
        "x",
      ]),
    ).toEqual([{ page: 1, bar: 9, count: 5 }]);
  });

  it("returns an empty list for anything that is not a list", () => {
    expect(readUnplacedNotes(undefined)).toEqual([]);
    expect(readUnplacedNotes({})).toEqual([]);
  });
});
