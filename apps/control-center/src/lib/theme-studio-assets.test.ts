import { afterEach, describe, expect, it, vi } from "vitest";

import { buildThemePack, validateThemeSpec } from "./theme-studio";
import {
  assetKind,
  formatBytes,
  importSpriteFile,
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

// Found on 2026-10-08 on the Windows app: a theme with one imported picture
// could not be sent. The picture was stored as CBI1 under a .cba name, which
// the Mac App and VibeTV both refuse.
describe("importSpriteFile", () => {
  type Rgb = [number, number, number];
  // A yellow face on magenta, 32x32, like the picture the defect was found with.
  const face = (x: number, y: number): Rgb =>
    Math.hypot(x - 15.5, y - 15.5) > 12
      ? [255, 0, 255]
      : y === 12 && (x === 11 || x === 20)
        ? [0, 0, 0]
        : [255, 221, 0];

  // Stands in for the browser's image decoding, which the test runner lacks.
  function stubPicture(
    width: number,
    height: number,
    colorAt: (x: number, y: number) => Rgb,
  ) {
    let left = 0;
    let top = 0;
    vi.stubGlobal("createImageBitmap", async () => ({
      close() {},
      height,
      width,
    }));
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          clearRect() {},
          drawImage(_bitmap: unknown, sx: number, sy: number) {
            left = sx;
            top = sy;
          },
          getImageData(_x: number, _y: number, w: number, h: number) {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let pixel = 0; pixel < w * h; pixel += 1) {
              data.set(
                [...colorAt(left + (pixel % w), top + Math.floor(pixel / w)), 255],
                pixel * 4,
              );
            }
            return { data };
          },
        }),
      }),
    });
  }

  // The theme Theme Studio holds after the Sprite button imported the file.
  async function themeWithImportedSprite(fileName: string) {
    const imported = await importSpriteFile(
      new File([], fileName, { type: "image/png" }),
    );
    return {
      assets: { [imported.assetPath]: imported.asset },
      imported,
      spec: {
        bgColor: "#000000",
        primitives: [
          {
            assetPath: imported.assetPath,
            fps: imported.fps,
            frameCount: imported.frameCount,
            height: imported.height,
            sheetColumns: imported.sheetColumns,
            type: "sprite" as const,
            width: imported.width,
            x: 176,
            y: 26,
          },
        ],
        themeId: "my-theme",
        themeRev: 1,
        themeSpecVersion: 1 as const,
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a single picture as a static .cbi sprite that packs for VibeTV", async () => {
    stubPicture(32, 32, face);
    const { assets, imported, spec } =
      await themeWithImportedSprite("face-on-magenta.png");

    expect(imported.assetPath).toBe("/themes/u/face-on-magenta.cbi");
    expect(imported.asset.data).toMatch(/^CBI1\n32 32\n3\n/);
    expect(imported).toMatchObject({ fps: 0, frameCount: 1 });

    expect(validateThemeSpec(spec, assets).errors).toEqual([]);
    const pack = buildThemePack(spec, "New Theme", assets);
    expect(pack.manifest.assets).toEqual([
      {
        bytes: imported.asset.data.length,
        contentType: "text/plain",
        file: "assets/face-on-magenta.cbi",
        path: "/themes/u/face-on-magenta.cbi",
      },
    ]);
    // companion/internal/themepack/themepack_test.go loads a pack with this
    // exact theme file: TestLoadAcceptsThemeStudioSinglePictureSprite.
    expect(pack.themeJson).toBe(
      '{"v":1,"id":"my-theme","rev":1,"p":[{"t":"sp","x":176,"y":26,"w":32,"h":32,"a":"/themes/u/face-on-magenta.cbi","fc":1,"fps":0,"sc":1}],"bg":"#000000"}\n',
    );
  });

  it("stores a sheet of two frames as an animated .cba sprite", async () => {
    stubPicture(64, 32, (x, y) => face(x % 32, x < 32 ? y : 31 - y));
    const { assets, imported, spec } = await themeWithImportedSprite("blink.png");

    expect(imported.assetPath).toBe("/themes/u/blink.cba");
    expect(imported.asset.data).toMatch(/^CBA1\n32 32 2 8\n3\n/);
    expect(imported).toMatchObject({ fps: 8, frameCount: 2, sheetColumns: 2 });

    expect(validateThemeSpec(spec, assets).errors).toEqual([]);
    expect(buildThemePack(spec, "New Theme", assets).manifest.assets).toEqual([
      expect.objectContaining({ path: "/themes/u/blink.cba" }),
    ]);
  });
});
