import { describe, expect, it } from "vitest";
import {
  DEFAULT_OMR_MAX_PAGES,
  isTimeoutError,
  pageRange,
  readPositiveInt,
  timeoutMessage,
} from "./omrLimits";

describe("readPositiveInt", () => {
  it("uses the fallback for missing or invalid values", () => {
    expect(readPositiveInt(undefined, 5)).toBe(5);
    expect(readPositiveInt("", 5)).toBe(5);
    expect(readPositiveInt("abc", 5)).toBe(5);
    expect(readPositiveInt("0", 5)).toBe(5);
    expect(readPositiveInt("-3", 5)).toBe(5);
    expect(readPositiveInt("2.5", 5)).toBe(5);
  });
  it("accepts a positive whole number", () => {
    expect(readPositiveInt("8", 5)).toBe(8);
  });
});

describe("pageRange", () => {
  it("asks Audiveris for pages 1 to N", () => {
    expect(pageRange(DEFAULT_OMR_MAX_PAGES)).toBe("1-4");
    expect(pageRange(1)).toBe("1-1");
  });
  it("never asks for fewer than one page", () => {
    expect(pageRange(0)).toBe("1-1");
  });
});

describe("isTimeoutError", () => {
  it("recognises a process stopped for running too long", () => {
    expect(isTimeoutError({ killed: true, signal: "SIGKILL" })).toBe(true);
    expect(isTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
  });
  it("does not mistake ordinary failures for a timeout", () => {
    expect(isTimeoutError(new Error("boom"))).toBe(false);
    expect(isTimeoutError({ code: 1 })).toBe(false);
    expect(isTimeoutError({ killed: false, signal: "SIGKILL" })).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});

describe("timeoutMessage", () => {
  it("tells the person what to do next", () => {
    const text = timeoutMessage(240_000, 4);
    expect(text).toContain("4 minutes");
    expect(text).toContain("first 4 pages");
    expect(text).toContain("MusicXML");
  });
});
