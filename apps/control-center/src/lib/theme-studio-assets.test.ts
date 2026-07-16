import { describe, expect, it } from "vitest";

import {
  assetKind,
  formatBytes,
  spriteMetadata,
  themeAssetByteLength,
  themeAssetPathForFile,
} from "./theme-studio-assets";

describe("Theme Studio asset helpers", () => {
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
