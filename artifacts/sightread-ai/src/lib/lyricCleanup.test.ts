import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { checkLyricVerses, findFooterRun, removeFooterLyrics } from "./lyricCleanup";

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMParser = DOMParser;
  g.XMLSerializer = XMLSerializer;
});

const flagged = (texts: string[]) => texts.filter((_, i) => findFooterRun(texts)[i]);

describe("findFooterRun (footers seen in real scans)", () => {
  it("removes a CPDL credit but keeps the last real word", () => {
    expect(flagged(["ex", "cel", "sis!", "by", "CPDL", "May", "freely", "duplicated,"])).toEqual([
      "by", "CPDL", "May", "freely", "duplicated,",
    ]);
  });
  it("removes an edition credit with a name and a year", () => {
    expect(flagged(["King.", "This", "edition", "produced", "by", "Andrew", "Sims,", "2020"])).toEqual([
      "This", "edition", "produced", "by", "Andrew", "Sims,", "2020",
    ]);
  });
  it("removes an engraving credit with a web address and an e-mail", () => {
    const line = ["Engraving", "by", "LilyPond", "2.12.3", "<http://lilypond.org>.", "Edition", "by", "Klaus", "F\u00f6hl", "<klaus@foehl.net>", "2012/2020."];
    expect(flagged(["ri", "a", ...line])).toEqual(line);
  });
  it("removes a copyright sign line", () => {
    expect(flagged(["Day", "\u00ae", "edition", "Andrew"])).toEqual(["\u00ae", "edition", "Andrew"]);
  });
  it("copes with a footer that was only partly read", () => {
    expect(flagged(["joy", "edition", "produced"])).toEqual(["edition", "produced"]);
  });
});

describe("findFooterRun (must not touch real words)", () => {
  it("keeps a hymn that really sings 'freely'", () => {
    expect(flagged(["Freely", "freely", "you", "have", "received"])).toEqual([]);
  });
  it("keeps ordinary words such as 'may be' and 'by'", () => {
    expect(flagged(["we", "may", "be", "led", "by", "thy", "light"])).toEqual([]);
  });
  it("keeps a lyric line that has no strong marker at all", () => {
    expect(flagged(["God", "rest", "ye", "mer", "ry", "gen", "tle", "men"])).toEqual([]);
  });
  it("does not spread through a whole long line", () => {
    const long = Array.from({ length: 40 }, () => "edition");
    expect(flagged(long)).toEqual([]);
  });
});

const note = (text: string, verse = "1") =>
  `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><lyric number="${verse}"><syllabic>single</syllabic><text>${text}</text></lyric></note>`;
const doc = (...parts: string[][]) =>
  `<score-partwise><part-list/>${parts
    .map((p, i) => `<part id="P${i + 1}"><measure number="1"><attributes><divisions>1</divisions></attributes>${p.join("")}</measure></part>`)
    .join("")}</score-partwise>`;

describe("removeFooterLyrics", () => {
  it("returns the same text when there is nothing to remove", () => {
    const clean = doc(["God", "rest", "ye"].map((t) => note(t)));
    expect(removeFooterLyrics(clean)).toEqual({ xml: clean, removed: [] });
  });

  it("removes footer syllables and leaves the notes and real words alone", () => {
    const words = ["God", "rest", "ye", "edition", "produced", "by", "Andrew"];
    const result = removeFooterLyrics(doc(words.map((t) => note(t))));
    expect(result.removed).toEqual(["edition", "produced", "by", "Andrew"]);
    expect((result.xml.match(/<note>/g) ?? []).length).toBe(7); // no note is removed
    expect((result.xml.match(/<lyric/g) ?? []).length).toBe(3);
    expect(result.xml).toContain("<text>God</text>");
  });

  it("treats each verse line separately", () => {
    const part = [
      note("Day", "1"), note("by", "1"), note("CPDL", "1"),
      note("Day", "2"), note("sings", "2"),
    ];
    const result = removeFooterLyrics(doc(part));
    expect(result.removed).toEqual(["by", "CPDL"]);
    expect(result.xml).toContain("<text>sings</text>");
  });

  it("finds footer text in a different staff", () => {
    const upper = ["God", "rest"].map((t) => note(t));
    const lower = [note("edition"), note("Sims,")];
    expect(removeFooterLyrics(doc(upper, lower)).removed).toEqual(["edition", "Sims,"]);
  });

  it("is idempotent", () => {
    const once = removeFooterLyrics(doc(["Day", "edition", "produced", "by", "Sims,"].map((t) => note(t)))).xml;
    expect(removeFooterLyrics(once).removed).toEqual([]);
  });

  it("returns the original text for something that is not a score", () => {
    expect(removeFooterLyrics("not xml").xml).toBe("not xml");
  });
});

describe("checkLyricVerses", () => {
  const verses = (counts: Record<string, number>) =>
    doc(
      Object.entries(counts).flatMap(([verse, count]) =>
        Array.from({ length: count }, (_, i) => note(`w${i}`, verse)),
      ),
    );

  it("is quiet when the verses are about the same length", () => {
    expect(checkLyricVerses(verses({ "1": 40, "2": 38, "3": 40 })).suspectVerses).toEqual([]);
  });
  it("accepts natural variation (a longer first verse, as in real hymns)", () => {
    expect(checkLyricVerses(verses({ "1": 45, "2": 30, "3": 30, "4": 30 })).suspectVerses).toEqual([]);
  });
  it("flags a verse with far fewer words than the rest", () => {
    const check = checkLyricVerses(verses({ "1": 40, "2": 40, "3": 40, "4": 12 }));
    expect(check.suspectVerses).toEqual(["4"]);
    expect(check.counts["4"]).toBe(12);
  });
  it("does not judge with fewer than three verses", () => {
    expect(checkLyricVerses(verses({ "1": 40, "2": 5 })).suspectVerses).toEqual([]);
  });
  it("does not judge a very short song", () => {
    expect(checkLyricVerses(verses({ "1": 6, "2": 6, "3": 1 })).suspectVerses).toEqual([]);
  });
  it("ignores footer text when counting", () => {
    const footer = Array.from({ length: 10 }, () => note("edition", "3"));
    const xml = doc(
      [
        ...Array.from({ length: 20 }, (_, i) => note(`a${i}`, "1")),
        ...Array.from({ length: 20 }, (_, i) => note(`b${i}`, "2")),
        ...Array.from({ length: 20 }, (_, i) => note(`c${i}`, "3")),
        ...footer,
      ],
    );
    expect(checkLyricVerses(xml).counts["3"]).toBe(20);
  });
});
