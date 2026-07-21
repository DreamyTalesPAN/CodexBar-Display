import { describe, expect, it } from "vitest";
import { buildAIThemeCandidateFromRGBA } from "./ai-theme";
import { AI_THEME_GOLDEN_FIXTURES } from "./ai-theme-golden-fixtures";
import { validateThemeAgainstCapabilities } from "./theme-studio-capabilities";
import { validateThemeSpec } from "./theme-studio";

describe("AI screenmaster golden fixtures", () => {
  for (const fixture of AI_THEME_GOLDEN_FIXTURES) {
    it(`${fixture.name} builds a firmware-compatible static theme`, () => {
      const candidate = buildAIThemeCandidateFromRGBA(fixture.concept, new Uint8ClampedArray(240 * 128 * 4));
      expect(fixture.prompt.length).toBeGreaterThan(0);
      expect(validateThemeSpec(candidate.spec, candidate.assets).errors).toEqual([]);
      expect(candidate.spec.primitives.filter((item) => item.type === "progress")).toHaveLength(2);
      expect(validateThemeAgainstCapabilities(candidate.spec, candidate.assets, {
        displayHeightPx: 240, displayWidthPx: 240, maxStoredThemeSpecBytes: 4096,
        maxThemePrimitives: 32, supportedPrimitiveTypes: ["rect", "text", "progress", "sprite"],
        supportsStoredThemes: true, supportsThemeSpecV1: true,
      }).errors).toEqual([]);
    });
  }
});
