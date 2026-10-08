import { describe, expect, it } from "vitest";
import { assessImageResolution } from "./uploadQuality";

describe("assessImageResolution", () => {
  it("warns on a small image and reports its size", () => {
    const msg = assessImageResolution(850, 1100);
    expect(msg).toContain("850 × 1100");
    expect(msg).toContain("PDF");
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
