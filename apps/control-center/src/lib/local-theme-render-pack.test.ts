import { describe, expect, it } from "vitest";
import {
  writeThemeStudioRecovery,
  writeUserThemes,
  type ThemeStudioStorage,
} from "./theme-studio-storage";
import {
  buildThemePack,
  type ThemeStudioSpec,
} from "./theme-studio";
import { loadLocalThemeRenderPack } from "./local-theme-render-pack";

class MemoryStorage implements ThemeStudioStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function customSpec(color: string): ThemeStudioSpec {
  return {
    bgColor: color,
    primitives: [
      {
        color,
        height: 240,
        type: "rect",
        width: 240,
        x: 0,
        y: 0,
      },
    ],
    themeId: "synthwave-custom",
    themeRev: 1,
    themeSpecVersion: 1,
  };
}

describe("loadLocalThemeRenderPack", () => {
  it("loads the exact saved custom theme installed on VibeTV", () => {
    const storage = new MemoryStorage();
    const spec = customSpec("#050014");
    const document = { assets: {}, packName: "Synthwave Custom", spec };
    expect(
      writeUserThemes(
        [{ document, id: spec.themeId, updatedAt: "2026-07-19T13:55:00Z" }],
        storage,
      ).ok,
    ).toBe(true);

    expect(
      loadLocalThemeRenderPack(
        spec.themeId,
        buildThemePack(spec, document.packName).themeSpecPath,
        storage,
      ),
    ).toMatchObject({
      name: "Synthwave Custom",
      ok: true,
      spec: { bgColor: "#050014", themeId: "synthwave-custom" },
      themeId: "synthwave-custom",
    });
  });

  it("prefers the matching recovery document for a directly installed edit", () => {
    const storage = new MemoryStorage();
    const savedSpec = customSpec("#050014");
    const installedSpec = customSpec("#110022");
    expect(
      writeUserThemes(
        [
          {
            document: { assets: {}, packName: "Saved", spec: savedSpec },
            id: savedSpec.themeId,
            updatedAt: "2026-07-19T13:50:00Z",
          },
        ],
        storage,
      ).ok,
    ).toBe(true);
    expect(
      writeThemeStudioRecovery(
        {
          document: {
            assets: {},
            packName: "Installed edit",
            spec: installedSpec,
          },
          libraryId: savedSpec.themeId,
          source: "custom",
          updatedAt: "2026-07-19T13:55:00Z",
        },
        storage,
      ).ok,
    ).toBe(true);

    expect(
      loadLocalThemeRenderPack(
        installedSpec.themeId,
        buildThemePack(installedSpec, "Installed edit").themeSpecPath,
        storage,
      ),
    ).toMatchObject({
      name: "Installed edit",
      spec: { bgColor: "#110022" },
    });
  });

  it("does not render an older local revision with the same theme id", () => {
    const storage = new MemoryStorage();
    const spec = customSpec("#050014");
    expect(
      writeUserThemes(
        [
          {
            document: { assets: {}, packName: "Old edit", spec },
            id: spec.themeId,
            updatedAt: "2026-07-19T13:50:00Z",
          },
        ],
        storage,
      ).ok,
    ).toBe(true);

    expect(
      loadLocalThemeRenderPack(
        spec.themeId,
        "/themes/u/synthwa-1-ffffff.json",
        storage,
      ),
    ).toBeNull();
  });
});
