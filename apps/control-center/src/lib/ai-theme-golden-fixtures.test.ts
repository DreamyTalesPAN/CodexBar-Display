import { describe, expect, it } from "vitest";
import { validateThemeAgainstCapabilities } from "./theme-studio-capabilities";
import { validateThemeSpec } from "./theme-studio";
import { AI_THEME_GOLDEN_FIXTURES } from "./ai-theme-golden-fixtures";

describe("AI theme golden fixtures", () => {
  for (const fixture of AI_THEME_GOLDEN_FIXTURES) {
    it(`${fixture.name} passes ThemeSpec and capability validation`, () => {
      expect(fixture.prompt.length).toBeGreaterThan(0);
      expect(fixture.spec.primitives.length).toBeLessThanOrEqual(16);
      expect(validateThemeSpec(fixture.spec).errors).toEqual([]);
      expect(validateThemeAgainstCapabilities(fixture.spec, {}, {
        displayHeightPx: 240,
        displayWidthPx: 240,
        maxStoredThemeSpecBytes: 4096,
        maxThemePrimitives: 32,
        supportedPrimitiveTypes: ["rect", "text", "progress", "pixels"],
        supportsStoredThemes: true,
        supportsThemeSpecV1: true,
      }).errors).toEqual([]);
    });
  }
});
