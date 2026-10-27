import { describe, expect, it } from "vitest";
import { buildReportUrl } from "./reportUrl";

describe("buildReportUrl", () => {
  it("replaces placeholders and URL-encodes special characters", () => {
    const scoreTitle = "Ding dong! Merrily & on high";
    const result = buildReportUrl(
      "https://example.test/report?score=SCORE&measure=MEASURE&part=PART",
      { scoreTitle, measure: 5, partName: "Soprano + Alto" },
    );

    expect(result).not.toBeNull();
    expect(result).toContain("Ding+dong");
    expect(result).toContain("%26");
    const params = new URL(result!).searchParams;
    expect(params.get("score")).toBe(scoreTitle);
    expect(params.get("measure")).toBe("5");
    expect(params.get("part")).toBe("Soprano + Alto");
  });

  it("preserves other query parameters, including repeated keys", () => {
    const result = buildReportUrl(
      "https://example.test/report?score=SCORE&source=reader&tag=one&tag=two",
      { scoreTitle: "Test score", measure: 1, partName: "Piano" },
    );

    expect(new URL(result!).searchParams.get("source")).toBe("reader");
    expect(new URL(result!).searchParams.getAll("tag")).toEqual(["one", "two"]);
  });

  it("returns a plain form URL unchanged", () => {
    const formUrl = "https://example.test/form?source=reader";
    expect(
      buildReportUrl(formUrl, {
        scoreTitle: "Test score",
        measure: 1,
        partName: "Piano",
      }),
    ).toBe(formUrl);
  });

  it("returns null when the form URL is missing or empty", () => {
    const details = { scoreTitle: "Test score", measure: 1, partName: "Piano" };
    expect(buildReportUrl(undefined, details)).toBeNull();
    expect(buildReportUrl("", details)).toBeNull();
    expect(buildReportUrl("   ", details)).toBeNull();
  });
});
