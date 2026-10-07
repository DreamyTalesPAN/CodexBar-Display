import { describe, expect, it } from "vitest";

import {
  assetKind,
  formatBytes,
  keySpriteColor,
  spriteMetadata,
  spritePalette,
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

describe("keySpriteColor", () => {
  const sprite = "CBI1\n4 2\n3\n#000000\n#ff0000\n#00FF00\n2a2b\na.bc\n";

  it("lists the palette colors once, in upper case", () => {
    expect(spritePalette(sprite)).toEqual(["#000000", "#FF0000", "#00FF00"]);
    expect(spritePalette("CBI1\n1 1\n2\n#000000\n#000000\na\n")).toEqual([
      "#000000",
    ]);
    expect(spritePalette("R0lGODlhAQABAAAAACw=")).toEqual([]);
    expect(spritePalette(undefined)).toEqual([]);
  });

  it("removes the color from the palette and remaps the pixels", () => {
    expect(keySpriteColor(sprite, "#000000")).toBe(
      "CBI1\n4 2\n2\n#ff0000\n#00FF00\n2.2a\n2.ab\n",
    );
    expect(
      keySpriteColor("CBI1\n14 1\n2\n#000000\n#FFFFFF\n10a.2ab\n", "#000000"),
    ).toBe("CBI1\n14 1\n1\n#FFFFFF\n13.a\n");
  });

  it("keeps real black pixels when another color is keyed", () => {
    expect(keySpriteColor(sprite, "#FF0000")).toBe(
      "CBI1\n4 2\n2\n#000000\n#00FF00\n2a2.\na2.b\n",
    );
  });

  it("keys every frame of an animated sprite", () => {
    const animated = "CBA1\n2 2 2 4\n2\n#000000\n#FFFFFF\n2a\nab\nba\n2b\n";
    const keyed = keySpriteColor(animated, "#000000");
    expect(keyed).toBe("CBA1\n2 2 2 4\n1\n#FFFFFF\n2.\n.a\na.\n2a\n");
    expect(spriteMetadata(keyed)).toEqual(spriteMetadata(animated));
  });

  it("leaves the sprite unchanged when the color cannot be keyed", () => {
    expect(keySpriteColor(sprite, "#123456")).toBe(sprite);
    const oneColor = "CBI1\n2 1\n1\n#000000\n2a\n";
    expect(keySpriteColor(oneColor, "#000000")).toBe(oneColor);
    expect(keySpriteColor("not a sprite", "#000000")).toBe("not a sprite");
  });
});
