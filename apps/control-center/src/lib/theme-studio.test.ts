import { describe, expect, it } from "vitest";

import {
  deviceThemeSpecJson,
  importThemeSpec,
  validateThemeSpec,
  type ThemeStudioSpec,
} from "./theme-studio";

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

  it("round-trips border radius through compact device JSON", () => {
    const spec = validSpec();
    spec.primitives[0].borderRadius = 8;

    const deviceSpec = JSON.parse(deviceThemeSpecJson(spec));
    expect(deviceSpec.p[0].br).toBe(8);

    const imported = importThemeSpec(deviceSpec);
    expect(imported.primitives[0].borderRadius).toBe(8);
    expect(validateThemeSpec(imported).errors).toEqual([]);
  });

  it("rejects border radii outside the supported pixel range", () => {
    const spec = validSpec();
    spec.primitives[0].borderRadius = 121;

    expect(validateThemeSpec(spec).errors).toContainEqual(
      expect.stringContaining("border radius must be between 0 and 120"),
    );
  });
});
