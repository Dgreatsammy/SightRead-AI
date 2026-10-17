import { describe, expect, it } from "vitest";
import { assessImageResolution } from "./uploadQuality";

describe("assessImageResolution", () => {
  it("warns strongly on a very small image and reports its size", () => {
    const msg = assessImageResolution(850, 1100);
    expect(msg).toContain("very small");
    expect(msg).toContain("850 \u00d7 1100");
    expect(msg).toContain("PDF");
    expect(msg).toContain("Document");
  });
  it("warns gently on a middle-sized image: notes mostly fine, words at risk", () => {
    const msg = assessImageResolution(1236, 1600);
    expect(msg).toContain("smaller than ideal");
    expect(msg).toContain("lyrics");
    expect(msg).not.toContain("very small");
  });
  it("switches wording at the poor-quality boundary", () => {
    expect(assessImageResolution(1199, 900)).toContain("very small");
    expect(assessImageResolution(1200, 900)).toContain("smaller than ideal");
  });
  it("is silent for a full-resolution scan", () => {
    expect(assessImageResolution(2550, 3300)).toBeNull();
    expect(assessImageResolution(3300, 2550)).toBeNull();
  });
  it("judges by the long side, so landscape pages are treated the same", () => {
    expect(assessImageResolution(1999, 1000)).not.toBeNull();
    expect(assessImageResolution(2000, 1000)).toBeNull();
  });
  it("ignores unreadable dimensions", () => {
    expect(assessImageResolution(0, 0)).toBeNull();
    expect(assessImageResolution(NaN, 100)).toBeNull();
  });
});

import {
  assessPdfPages,
  estimatePdfPageCount,
  MAX_PAGES_READ,
  omrWaitMessage,
} from "./uploadQuality";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("estimatePdfPageCount", () => {
  it("reads the page total from the page tree", () => {
    expect(estimatePdfPageCount(bytes("<< /Type /Pages /Kids [1 0 R] /Count 23 >>"))).toBe(23);
    expect(estimatePdfPageCount(bytes("<< /Count 7 /Kids [1 0 R] /Type /Pages >>"))).toBe(7);
  });
  it("falls back to counting page objects", () => {
    expect(
      estimatePdfPageCount(bytes("<< /Type /Page /A 1 >> << /Type /Page /B 2 >> << /Type /Pages >>")),
    ).toBe(2);
  });
  it("returns null when it cannot tell", () => {
    expect(estimatePdfPageCount(bytes("not a pdf"))).toBeNull();
  });
  it("copes with a large file", () => {
    const big = new Uint8Array(3_000_000).fill(65);
    expect(estimatePdfPageCount(big)).toBeNull();
  });
});

describe("assessPdfPages", () => {
  it("is quiet for a short PDF or an unknown count", () => {
    expect(assessPdfPages(MAX_PAGES_READ)).toBeNull();
    expect(assessPdfPages(1)).toBeNull();
    expect(assessPdfPages(null)).toBeNull();
  });
  it("warns for a long PDF and says what will happen", () => {
    const text = assessPdfPages(23);
    expect(text).toContain("about 23 pages");
    expect(text).toContain(`first ${MAX_PAGES_READ}`);
  });
});

describe("omrWaitMessage", () => {
  it("is honest that a long wait may not finish", () => {
    expect(omrWaitMessage(5)).toContain("Converting");
    expect(omrWaitMessage(60)).toContain("few minutes");
    expect(omrWaitMessage(120)).toContain("2m 00s");
    expect(omrWaitMessage(200)).toContain("may not finish");
    expect(omrWaitMessage(200)).not.toContain("normal, not stuck");
  });
});
