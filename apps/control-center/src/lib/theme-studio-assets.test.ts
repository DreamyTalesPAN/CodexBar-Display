import { describe, expect, it } from "vitest";

import {
  assetKind,
  formatBytes,
  importedImageSize,
  spriteMetadata,
  themeAssetByteLength,
  themeAssetPathForFile,
  uniqueAssetPath,
} from "./theme-studio-assets";

describe("Theme Studio asset helpers", () => {
  it("never overwrites an existing asset when a second import has the same name", () => {
    const taken = { "/themes/u/image.cbi": 1, "/themes/u/image-2.cbi": 1 };
    expect(uniqueAssetPath("/themes/u/photo.cbi", taken)).toBe("/themes/u/photo.cbi");
    expect(uniqueAssetPath("/themes/u/image.cbi", taken)).toBe("/themes/u/image-3.cbi");
    const long = uniqueAssetPath("/themes/u/averyveryverylong.cbi", { "/themes/u/averyveryverylong.cbi": 1 });
    expect(long).toBe("/themes/u/averyveryverylo-2.cbi");
    expect(long.slice(long.lastIndexOf("/") + 1).length).toBeLessThanOrEqual(21);
  });
  it("scales imported pictures into the static sprite pixel budget", () => {
    expect(importedImageSize(1000, 1000)).toEqual({ width: 181, height: 181 });
    expect(importedImageSize(181, 181)).toEqual({ width: 181, height: 181 });
    expect(importedImageSize(1920, 1080)).toEqual({ width: 240, height: 135 });
    expect(importedImageSize(240, 128)).toEqual({ width: 240, height: 128 });
    expect(importedImageSize(1000, 1000).width ** 2).toBeLessThanOrEqual(32768);
  });
  it("reads static and animated sprite metadata", () => {
    expect(spriteMetadata("CBI1\n16 8\n1\n#FFFFFF\n16.\n")).toEqual({
      fps: 0,
      frameCount: 1,
      height: 8,
      width: 16,
    });
    expect(spriteMetadata("CBA1\n32 24 4 8\n1\n#FFFFFF\n32.\n")).toEqual({
      fps: 8,
      frameCount: 4,
      height: 24,
      width: 32,
    });
  });

  it("rejects malformed sprite metadata", () => {
    expect(spriteMetadata("PNG\n16 16\n1")).toBeNull();
    expect(spriteMetadata("CBA1\n0 16 2 8\n1\n#FFFFFF")).toBeNull();
  });

  it("creates bounded LittleFS asset paths", () => {
    const path = themeAssetPathForFile(
      "A very long customer sprite filename that needs trimming.png",
      ".cba",
    );
    expect(path).toMatch(/^\/themes\/u\/[a-z0-9._-]+\.cba$/);
    expect(path.replace("/themes/u/", "")).toHaveLength(21);
    expect(themeAssetPathForFile("clock.gif", ".gif", "screensaver")).toBe(
      "/themes/s/clock.gif",
    );
  });

  it("reports asset kinds and encoded byte sizes", () => {
    expect(assetKind("/themes/u/animation.gif")).toBe("gif");
    expect(assetKind("/themes/u/sprite.cbi")).toBe("sprite");
    expect(
      themeAssetByteLength({
        contentType: "application/octet-stream",
        data: "eHh4",
        encoding: "base64",
      }),
    ).toBe(3);
    expect(formatBytes(2048)).toBe("2 KB");
  });
});
