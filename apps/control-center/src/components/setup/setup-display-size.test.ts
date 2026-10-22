import { describe, expect, it } from "vitest";
import { displayPreviewSize } from "./setup-display-size";

describe("display preview size", () => {
  it("uses the largest integer device scale fitting both dimensions", () => {
    expect(displayPreviewSize(600, 500)).toBe(480);
    expect(displayPreviewSize(500, 300)).toBe(240);
    expect(displayPreviewSize(300, 500)).toBe(240);
  });
  it("fits below native scale without rounding up or pushing Continue down", () => {
    expect(displayPreviewSize(220, 180.5)).toBe(180);
    expect(displayPreviewSize(200, 300)).toBe(200);
    expect(displayPreviewSize(300, -10)).toBe(0);
  });
  it("fits three cards at Windows minimum and typical widths", () => {
    // 56px side padding, two 16px gaps, 2px card borders, 8px preview padding.
    expect(displayPreviewSize((960 - 112 - 32) / 3 - 10, 300)).toBe(240);
    expect(displayPreviewSize((1440 - 112 - 32) / 3 - 10, 550)).toBe(240);
  });
});
