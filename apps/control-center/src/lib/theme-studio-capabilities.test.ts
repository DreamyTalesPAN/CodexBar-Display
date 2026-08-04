import { describe, expect, it } from "vitest";

import {
  validateThemeAgainstCapabilities,
  type ThemeStudioDeviceCapabilities,
} from "./theme-studio-capabilities";
import type {
  ThemeStudioAsset,
  ThemeStudioSpec,
} from "./theme-studio";

const baseCapabilities: ThemeStudioDeviceCapabilities = {
  supportsThemeSpecV1: true,
  supportsUsageSlotsV1: true,
  supportsStoredThemes: true,
  maxThemeSpecBytes: 2048,
  maxStoredThemeSpecBytes: 4096,
  maxThemePrimitives: 32,
  maxThemeGifAssets: 1,
  maxThemeGifBytes: 24 * 1024,
  maxThemeGifWidth: 80,
  maxThemeGifHeight: 80,
  maxThemeGifPixels: 6400,
  supportedPrimitiveTypes: ["text", "rect", "progress", "gif", "sprite", "pixels"],
  builtinThemes: ["mini", "classic", "crt"],
  displayWidthPx: 240,
  displayHeightPx: 240,
};

function baseSpec(): ThemeStudioSpec {
  return {
    themeSpecVersion: 1,
    themeId: "test-theme",
    themeRev: 1,
    bgColor: "#000000",
    primitives: [
      {
        type: "rect",
        x: 0,
        y: 0,
        width: 240,
        height: 240,
        color: "#000000",
      },
    ],
  };
}

describe("validateThemeAgainstCapabilities", () => {
  it("prefers the stored ThemeSpec limit over the inline limit", () => {
    const spec = baseSpec();
    spec.primitives.push({
      type: "text",
      x: 4,
      y: 4,
      text: "x".repeat(2200),
    });

    const accepted = validateThemeAgainstCapabilities(
      spec,
      {},
      baseCapabilities,
    );
    expect(accepted.bytes).toBeGreaterThan(2048);
    expect(accepted.bytes).toBeLessThan(4096);
    expect(accepted.errors).toEqual([]);

    const rejected = validateThemeAgainstCapabilities(spec, {}, {
      ...baseCapabilities,
      maxStoredThemeSpecBytes: 2048,
    });
    expect(rejected.errors).toContainEqual(
      expect.stringContaining("stored-theme limit"),
    );
  });

  it("falls back to the inline ThemeSpec limit for older firmware", () => {
    const spec = baseSpec();
    spec.primitives.push({
      type: "text",
      x: 4,
      y: 4,
      text: "x".repeat(2200),
    });

    const result = validateThemeAgainstCapabilities(spec, {}, {
      supportsThemeSpecV1: true,
      maxThemeSpecBytes: 2048,
    });
    expect(result.errors).toContainEqual(
      expect.stringContaining("stored-theme limit"),
    );
  });

  it("checks primitive count, supported types, and display bounds", () => {
    const spec = baseSpec();
    spec.primitives = [
      { type: "rect", x: 230, y: 220, width: 20, height: 30 },
      { type: "pixels", x: 0, y: 0, width: 1, height: 1, data: "0" },
    ];

    const result = validateThemeAgainstCapabilities(spec, {}, {
      ...baseCapabilities,
      maxThemePrimitives: 1,
      supportedPrimitiveTypes: ["rect"],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Too many elements"),
        expect.stringContaining("type pixels"),
        expect.stringContaining("right edge"),
        expect.stringContaining("bottom edge"),
      ]),
    );
  });

  it("checks unique GIF count, bytes, dimensions, and pixels", () => {
    const spec = baseSpec();
    spec.primitives = [
      {
        type: "gif",
        x: 0,
        y: 0,
        width: 90,
        height: 80,
        assetPath: "/themes/u/a.gif",
        stateAssets: { coding: "/themes/u/b.gif" },
      },
    ];
    const assets: Record<string, ThemeStudioAsset> = {
      "/themes/u/a.gif": {
        contentType: "image/gif",
        data: "eHh4eHh4eHh4eA==",
        encoding: "base64",
      },
      "/themes/u/b.gif": {
        contentType: "image/gif",
        data: "123456789",
        encoding: "text",
      },
    };

    const result = validateThemeAgainstCapabilities(spec, assets, {
      ...baseCapabilities,
      maxThemeGifAssets: 1,
      maxThemeGifBytes: 8,
    });
    expect(result.gifAssetCount).toBe(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Too many GIF assets"),
        expect.stringContaining("GIF width"),
        expect.stringContaining("GIF area"),
        expect.stringContaining("/themes/u/a.gif exceeds"),
        expect.stringContaining("/themes/u/b.gif exceeds"),
      ]),
    );
  });

  it("does not block when optional capability limits are missing", () => {
    const result = validateThemeAgainstCapabilities(baseSpec(), {}, {});
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("will be checked when sending"),
    );
  });

  it("blocks slot-owned themes when the device lacks usage slot support", () => {
    const spec = baseSpec();
    spec.primitives.push({
      type: "text",
      x: 4,
      y: 4,
      slot: 1,
      text: "{usageSlot1Label}",
    });

    const result = validateThemeAgainstCapabilities(spec, {}, {
      ...baseCapabilities,
      supportsUsageSlotsV1: false,
    });
    expect(result.errors).toContainEqual(
      expect.stringContaining("needs a firmware update"),
    );
  });

  it("blocks compact slot templates when the device lacks usage slot support", () => {
    const spec = baseSpec();
    spec.primitives.push({
      type: "text",
      x: 4,
      y: 4,
      text: "{us1p}%",
    });

    const result = validateThemeAgainstCapabilities(spec, {}, {
      ...baseCapabilities,
      supportsUsageSlotsV1: false,
    });
    expect(result.errors).toContainEqual(
      expect.stringContaining("needs a firmware update"),
    );
  });
});
