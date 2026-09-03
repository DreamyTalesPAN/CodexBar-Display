import { describe, expect, it } from "vitest";

import {
  buildThemePack,
  createStarterThemeSpec,
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
        providerAssets: { cursor: "/themes/u/cursor.cbi" },
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
        "/themes/u/cursor.cbi": asset,
        "/themes/u/main.cbi": asset,
      },
      "screensaver",
    );
    const packedSpec = JSON.parse(pack.themeJson);

    expect(pack.manifest.usage).toBe("screensaver");
    expect(pack.themeSpecPath).toMatch(/^\/themes\/s\//);
    expect(pack.manifest.assets).toEqual([
      expect.objectContaining({
        path: expect.stringMatching(
          /^\/themes\/s\/main-[0-9a-f]{8}\.cbi$/,
        ),
      }),
    ]);
    expect(packedSpec.p[0].a).toMatch(/^\/themes\/s\/main-[0-9a-f]{8}\.cbi$/);
    expect(packedSpec.p[0]).not.toHaveProperty("sa");
    expect(packedSpec.p[0]).not.toHaveProperty("pa");
    expect(spec.primitives[0].stateAssets).toEqual({
      coding: "/themes/u/coding.cbi",
    });
    expect(spec.primitives[0].providerAssets).toEqual({
      cursor: "/themes/u/cursor.cbi",
    });
  });

  it("round-trips provider assets through compact device JSON", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        assetPath: "/themes/u/fallback.cbi",
        height: 24,
        providerAssets: {
          claude: "/themes/u/claude.cbi",
          cursor: "/themes/u/cursor.cbi",
        },
        type: "sprite",
        width: 24,
        x: 0,
        y: 0,
      },
    ];

    const compact = JSON.parse(deviceThemeSpecJson(spec));
    expect(compact.p[0].pa).toEqual({
      claude: "/themes/u/claude.cbi",
      cursor: "/themes/u/cursor.cbi",
    });
    expect(compact.p[0].a).toBe("/themes/u/fallback.cbi");

    const roundTrip = importThemeSpec(compact);
    expect(roundTrip.primitives[0].providerAssets).toEqual({
      claude: "/themes/u/claude.cbi",
      cursor: "/themes/u/cursor.cbi",
    });
  });

  it("round-trips progress colorStops through compact device JSON", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        color: "#22C55E",
        colorStops: [
          { color: "#22C55E", gte: 75 },
          { color: "#EAB308", gte: 50 },
          { color: "#F59E0B", gte: 25 },
          { color: "#EF4444", gte: 0 },
        ],
        height: 12,
        progressStyle: "segments",
        segments: 12,
        type: "progress",
        width: 120,
        x: 10,
        y: 20,
      },
    ];

    const compact = JSON.parse(deviceThemeSpecJson(spec));
    expect(compact.p[0].cs).toEqual([
      { c: "#22C55E", gte: 75 },
      { c: "#EAB308", gte: 50 },
      { c: "#F59E0B", gte: 25 },
      { c: "#EF4444", gte: 0 },
    ]);

    const roundTrip = importThemeSpec(compact);
    expect(roundTrip.primitives[0].colorStops).toEqual([
      { color: "#22C55E", gte: 75 },
      { color: "#EAB308", gte: 50 },
      { color: "#F59E0B", gte: 25 },
      { color: "#EF4444", gte: 0 },
    ]);
  });

  it("keeps screensaver assets with matching file names distinct", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        assetPath: "/themes/u/idle/icon.cbi",
        height: 1,
        type: "sprite",
        width: 1,
        x: 0,
        y: 0,
      },
      {
        assetPath: "/themes/u/coding/icon.cbi",
        height: 1,
        type: "sprite",
        width: 1,
        x: 1,
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
      "Distinct Screensaver Assets",
      {
        "/themes/u/idle/icon.cbi": asset,
        "/themes/u/coding/icon.cbi": asset,
      },
      "screensaver",
    );
    const packedSpec = JSON.parse(pack.themeJson);
    const assetPaths = pack.manifest.assets.map((entry) => entry.path);

    expect(assetPaths).toHaveLength(2);
    expect(new Set(assetPaths).size).toBe(2);
    expect(packedSpec.p.map((primitive: { a: string }) => primitive.a)).toEqual(
      assetPaths,
    );
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

  it("keeps the starter theme independent from firmware-owned assets", () => {
    const starter = createStarterThemeSpec();
    expect(deviceThemeSpecJson(starter)).not.toContain("/themes/mini/");
  });

  it("keeps the starter theme independent from firmware-owned assets", () => {
    const starter = createStarterThemeSpec();
    expect(deviceThemeSpecJson(starter)).not.toContain("/themes/mini/");
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
    const pack = buildThemePack(normalized, "Legacy Theme");

    expect(normalized).not.toHaveProperty("fallbackTheme");
    expect(normalized).not.toHaveProperty("fb");
    expect(deviceSpec).not.toHaveProperty("fallbackTheme");
    expect(deviceSpec).not.toHaveProperty("fb");
    expect(packSpec).not.toHaveProperty("fallbackTheme");
    expect(packSpec).not.toHaveProperty("fb");
    expect(pack.manifest.minFirmware).toBe("1.0.24");
    expect(pack.manifest.requiredCapabilities).toBeUndefined();
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

  it("round-trips firmware text auto-fit through compact device JSON", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        fit: "shrink",
        fontSize: 3,
        text: "{usageSlot1Label}",
        type: "text",
        width: 108,
        x: 7,
        y: 30,
      },
    ];

    const deviceSpec = JSON.parse(deviceThemeSpecJson(spec));
    expect(deviceSpec.p[0].ft).toBe("shrink");
    expect(importThemeSpec(deviceSpec).primitives[0].fit).toBe("shrink");
  });

  it("round-trips vertical text align through compact device JSON", () => {
    const spec = validSpec();
    spec.primitives = [
      {
        fit: "shrink",
        fontSize: 2,
        height: 32,
        text: "{label}",
        type: "text",
        valign: "middle",
        width: 156,
        x: 68,
        y: 20,
      },
    ];

    const deviceSpec = JSON.parse(deviceThemeSpecJson(spec));
    expect(deviceSpec.p[0].va).toBe("middle");
    expect(deviceSpec.p[0].h).toBe(32);
    expect(importThemeSpec(deviceSpec).primitives[0].valign).toBe("middle");
    expect(importThemeSpec({ p: [{ t: "tx", va: "center", h: 32 }] }).primitives[0].valign).toBe(
      "middle",
    );
  });

  it("rejects border radii outside the supported pixel range", () => {
    const spec = validSpec();
    spec.primitives[0].borderRadius = 121;

    expect(validateThemeSpec(spec).errors).toContainEqual(
      expect.stringContaining("border radius must be between 0 and 120"),
    );
  });

  it("round-trips usage lane ownership and advertises its capability", () => {
    const spec = validSpec();
    spec.primitives[0].slot = 2;

    const deviceSpec = JSON.parse(deviceThemeSpecJson(spec));
    expect(deviceSpec.p[0].sl).toBe(2);
    expect(importThemeSpec(deviceSpec).primitives[0].slot).toBe(2);

    const pack = buildThemePack(spec, "Usage Theme");
    expect(pack.manifest.minFirmware).toBe("1.0.40");
    expect(pack.manifest.requiredCapabilities).toEqual(["usage-slots-v1"]);
  });
});

// A pack that renders provider rows on firmware without provider slots leaves
// them empty, and only the manifest can stop that install.
describe("buildThemePack capability declaration", () => {
  function specWithBinding(binding: string, extra = {}): ThemeStudioSpec {
    const spec = validSpec();
    spec.primitives = [
      { binding, color: "#FFFFFF", type: "text", x: 0, y: 0, ...extra },
    ];
    return spec;
  }

  it("declares provider slots and their firmware floor", () => {
    const pack = buildThemePack(
      specWithBinding("providerSlot1Label", { providerSlot: 1 }),
      "Provider Pack",
    );

    expect(pack.manifest.requiredCapabilities).toContain("provider-slots-v1");
    expect(pack.manifest.minFirmware).toBe("1.0.41");
  });

  it("keeps declaring usage slots on their own", () => {
    const pack = buildThemePack(
      specWithBinding("usageSlot1Label", { slot: 1 }),
      "Usage Pack",
    );

    expect(pack.manifest.requiredCapabilities).toEqual(["usage-slots-v1"]);
    expect(pack.manifest.minFirmware).toBe("1.0.40");
  });

  it("declares both when a design mixes them", () => {
    const spec = validSpec();
    spec.primitives = [
      { binding: "usageSlot1Label", color: "#FFFFFF", slot: 1, type: "text", x: 0, y: 0 },
      { binding: "providerSlot1Label", color: "#FFFFFF", providerSlot: 1, type: "text", x: 0, y: 20 },
    ];
    const pack = buildThemePack(spec, "Mixed Pack");

    expect(pack.manifest.requiredCapabilities).toEqual([
      "usage-slots-v1",
      "provider-slots-v1",
    ]);
    expect(pack.manifest.minFirmware).toBe("1.0.41");
  });

  it("leaves a plain design without capability requirements", () => {
    const pack = buildThemePack(validSpec(), "Plain Pack");

    expect(pack.manifest.requiredCapabilities).toBeUndefined();
    expect(pack.manifest.minFirmware).toBe("1.0.24");
  });
});
