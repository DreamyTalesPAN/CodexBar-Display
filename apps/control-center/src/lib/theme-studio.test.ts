import { describe, expect, it } from "vitest";

import {
  buildThemePack,
  deviceThemeSpecJson,
  importThemeSpec,
  normalizeThemeSpec,
  validateThemeSpec,
  type ThemeStudioSpec,
} from "./theme-studio";

function validSpec(): ThemeStudioSpec {
  return {
    bgColor: "#000000",
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
    const result = validateThemeSpec(validSpec());

    expect(result.errors).toEqual([]);
    expect(result.maxBytes).toBe(4096);
    expect(result.themeSpecPath).toMatch(/^\/themes\/u\//);
  });

  it("builds a screensaver pack in its own slot without hidden state assets", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        assetPath: "/themes/u/main.cbi",
        height: 1,
        stateAssets: { coding: "/themes/u/coding.cbi" },
        type: "sprite",
        width: 1,
        x: 0,
        y: 0,
      },
    ];
    const asset = {
      contentType: "text/plain",
      data: "CBI1\n1 1\n1\n#FFFFFF\na\n",
      encoding: "text" as const,
    };

    const pack = buildThemePack(
      spec,
      "Test Screensaver",
      {
        "/themes/u/coding.cbi": asset,
        "/themes/u/main.cbi": asset,
      },
      "screensaver",
    );
    const packedSpec = JSON.parse(pack.themeJson);

    expect(pack.manifest.usage).toBe("screensaver");
    expect(pack.themeSpecPath).toMatch(/^\/themes\/s\//);
    expect(pack.manifest.assets).toEqual([
      expect.objectContaining({ path: "/themes/s/main.cbi" }),
    ]);
    expect(packedSpec.p[0]).toMatchObject({ a: "/themes/s/main.cbi" });
    expect(packedSpec.p[0]).not.toHaveProperty("sa");
    expect(spec.primitives[0].stateAssets).toEqual({
      coding: "/themes/u/coding.cbi",
    });
  });

  it("enforces the central 2 KB screensaver budget without motion lint", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        color: "#FFFFFF",
        fontSize: 1,
        text: "x".repeat(2300),
        type: "text",
        width: 240,
        x: 0,
        y: 0,
      },
    ];

    const live = validateThemeSpec(spec);
    const screensaver = validateThemeSpec(spec, {}, "screensaver");

    expect(live.errors).toEqual([]);
    expect(live.maxBytes).toBe(4096);
    expect(screensaver.maxBytes).toBe(2048);
    expect(screensaver.errors).toContainEqual(
      expect.stringContaining("Screensaver file is too large"),
    );
    expect(validateThemeSpec(validSpec(), {}, "screensaver").warnings).toEqual(
      [],
    );
  });

  it("accepts legacy fallback metadata but omits it from normalized exports", () => {
    const imported = importThemeSpec({
      bg: "#000000",
      fb: "mini",
      id: "legacy-theme",
      p: [{ c: "#FFFFFF", h: 20, t: "r", w: 20, x: 10, y: 10 }],
      rev: 1,
      v: 1,
    });
    const normalized = normalizeThemeSpec({
      ...imported,
      fallbackTheme: "mini",
    } as ThemeStudioSpec & { fallbackTheme: string });
    const deviceSpec = JSON.parse(deviceThemeSpecJson(normalized));
    const packSpec = JSON.parse(buildThemePack(normalized, "Legacy Theme").themeJson);

    expect(normalized).not.toHaveProperty("fallbackTheme");
    expect(normalized).not.toHaveProperty("fb");
    expect(deviceSpec).not.toHaveProperty("fallbackTheme");
    expect(deviceSpec).not.toHaveProperty("fb");
    expect(packSpec).not.toHaveProperty("fallbackTheme");
    expect(packSpec).not.toHaveProperty("fb");
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
