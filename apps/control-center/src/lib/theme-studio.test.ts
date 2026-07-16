import { describe, expect, it } from "vitest";

import { validateThemeSpec, type ThemeStudioSpec } from "./theme-studio";

function validSpec(): ThemeStudioSpec {
  return {
    bgColor: "#000000",
    fallbackTheme: "mini",
    primitives: [
      {
        color: "#FFFFFF",
        height: 20,
        type: "rect",
        width: 20,
        x: 10,
        y: 10,
      },
    ],
    themeId: "test-theme",
    themeRev: 1,
    themeSpecVersion: 1,
  };
}

describe("validateThemeSpec", () => {
  it("accepts a structurally valid portable theme", () => {
    expect(validateThemeSpec(validSpec()).errors).toEqual([]);
  });

  it("blocks primitives that extend beyond the 240x240 canvas", () => {
    const spec = validSpec();
    spec.primitives[0].x = 230;

    const result = validateThemeSpec(spec);

    expect(result.errors).toContainEqual(
      expect.stringContaining("must stay inside 240x240"),
    );
  });
});
