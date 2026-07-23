import { describe, expect, it } from "vitest";
import { countUpPreviewValue } from "./live-vibetv-preview";

describe("countUpPreviewValue", () => {
  it("moves from zero to the complete preview value in twelve steps", () => {
    expect(countUpPreviewValue(142_400_000, 0)).toBe(0);
    expect(countUpPreviewValue(142_400_000, 6)).toBe(71_200_000);
    expect(countUpPreviewValue(142_400_000, 12)).toBe(142_400_000);
  });

  it("clamps steps and token values to safe preview bounds", () => {
    expect(countUpPreviewValue(142_400_000, 20)).toBe(142_400_000);
    expect(countUpPreviewValue(-1, 6)).toBe(0);
  });
});
