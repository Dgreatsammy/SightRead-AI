import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import { hasMeaningfulPartNames } from "./scoreLabels";

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;
});

const score = (...names: string[]) =>
  `<score-partwise><part-list>${names
    .map((n, i) => `<score-part id="P${i + 1}"><part-name>${n}</part-name></score-part>`)
    .join("")}</part-list></score-partwise>`;

describe("hasMeaningfulPartNames", () => {
  it("hides names Audiveris made up", () => {
    expect(hasMeaningfulPartNames(score("Voice", "Voice"))).toBe(false);
    expect(hasMeaningfulPartNames(score("Part 1", "Part 2"))).toBe(false);
    expect(hasMeaningfulPartNames(score("Music"))).toBe(false);
    expect(hasMeaningfulPartNames(score(""))).toBe(false);
  });
  it("keeps real printed names", () => {
    expect(hasMeaningfulPartNames(score("Contralto", "Basso"))).toBe(true);
    expect(hasMeaningfulPartNames(score("Soprano", "Alto", "Tenor", "Bass"))).toBe(true);
  });
  it("keeps names if any one of them is real", () => {
    expect(hasMeaningfulPartNames(score("Voice", "Basso"))).toBe(true);
  });
  it("does not hide anything when unsure", () => {
    expect(hasMeaningfulPartNames("")).toBe(true);
  });
});
