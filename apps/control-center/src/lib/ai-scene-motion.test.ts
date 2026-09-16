import { describe, it, expect } from "vitest";
import { decodeSprite } from "@/components/live-vibetv-preview";
import {
  applySceneMotion,
  sceneMotionPlan,
  sceneMotionHasChanges,
  SCENE_MOTION_EFFECTS,
} from "./ai-scene-motion";
import {
  AI_THEME_SCREENMASTER_ASSET_PATH as ART,
  AI_THEME_ANIMATION_ASSET_PATH as CHARACTER,
  encodeAIThemeCBA1,
} from "./ai-theme";
import { applyAIThemeCandidate } from "./ai-theme-document";
import {
  buildThemePack,
  importThemeSpec,
  validateThemeSpec,
} from "./theme-studio";
import {
  createThemeStudioEditorState,
  themeStudioEditorReducer,
  type ThemeStudioDocument,
} from "@/components/theme-studio/theme-studio-editor-state";

function document(): ThemeStudioDocument {
  return {
    packName: "Motion test",
    usage: "live",
    assets: {
      [ART]: {
        contentType: "text/plain",
        encoding: "text",
        data: [
          "CBI1",
          "240 128",
          "3",
          "#112233",
          "#334455",
          "#556677",
          ...Array.from({ length: 128 }, (_, y) =>
            (y % 2 ? "ab" : "ba").repeat(120),
          ),
          "",
        ].join("\n"),
      },
    },
    spec: {
      themeSpecVersion: 1,
      themeId: "motion-test",
      themeRev: 1,
      primitives: [
        { type: "sprite", x: 0, y: 0, width: 240, height: 128, assetPath: ART },
        { type: "text", x: 12, y: 150, text: "Keep me", fontSize: 1 },
      ],
    },
  };
}
const plan = {
  x: 88,
  y: 32,
  width: 64,
  height: 64,
  effect: "breathe" as const,
};
function pixels(raw: string, frame: number) {
  const sprite = decodeSprite(raw)!;
  const values = Array<string>(sprite.width * sprite.height).fill("");
  for (const r of sprite.frames[frame])
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++)
        values[y * sprite.width + x] = r.color;
  return values;
}
describe("attached scene motion", () => {
  for (const effect of Object.keys(
    SCENE_MOTION_EFFECTS,
  ) as (keyof typeof SCENE_MOTION_EFFECTS)[])
    it(`${effect}: valid export, original palette, stationary edges and real frame changes`, async () => {
      const original = document();
      const next = applySceneMotion(original, { ...plan, effect });
      const path = next.spec.primitives[1].assetPath!;
      expect(next.assets[ART]).toEqual(original.assets[ART]);
      expect(next.spec.primitives[2]).toEqual(original.spec.primitives[1]);
      expect(original.spec.primitives).toHaveLength(2);
      const metadata = decodeSprite(next.assets[path].data)!;
      expect(metadata.frames).toHaveLength(8);
      expect(sceneMotionHasChanges(next)).toBe(true);
      expect(validateThemeSpec(next.spec, next.assets).errors).toEqual([]);
      const source = pixels(next.assets[ART].data, 0);
      const first = pixels(next.assets[path].data, 0);
      const all = Array.from({ length: 8 }, (_, f) =>
        pixels(next.assets[path].data, f),
      );
      expect(new Set(all.map((f) => f.join(""))).size).toBeGreaterThan(1);
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          expect(first[y * 64 + x]).toBe(source[(32 + y) * 240 + 88 + x]);
          if (x < 3 || y < 3 || x > 60 || y > 60)
            for (const frame of all)
              expect(frame[y * 64 + x]).toBe(first[y * 64 + x]);
        }
      const imported = {
        ...next,
        spec: importThemeSpec(JSON.parse(JSON.stringify(next.spec))),
      };
      expect(sceneMotionPlan(imported)).toEqual({ ...plan, effect });
      expect(
        buildThemePack(next.spec, next.packName, next.assets).zipBytes.length,
      ).toBeGreaterThan(0);
    });
  it("recrops the original scene on region changes and remains one animation", () => {
    const before = applySceneMotion(document(), plan);
    const after = applySceneMotion(
      before,
      { ...plan, x: 20, width: 32, effect: "sway" },
      false,
      8,
    );
    expect(sceneMotionPlan(after)).toEqual({
      ...plan,
      x: 20,
      width: 32,
      effect: "sway",
    });
    expect(Object.keys(after.assets)).toHaveLength(2);
    expect(after.spec.primitives[1].fps).toBe(8);
  });
  it("does not claim visible movement in a flat region", () => {
    const d = document();
    d.assets[ART].data = [
      "CBI1",
      "240 128",
      "1",
      "#112233",
      ...Array(128).fill("240a"),
      "",
    ].join("\n");
    expect(sceneMotionHasChanges(applySceneMotion(d, plan))).toBe(false);
  });
  it("rejects unsafe areas and requires explicit replacement", () => {
    for (const patch of [
      { x: 200 },
      { y: 100 },
      { width: 65 },
      { height: 7 },
      { x: 1.5 },
      { effect: "walk" },
    ])
      expect(() =>
        applySceneMotion(document(), { ...plan, ...patch } as typeof plan),
      ).toThrow();
    const d = document();
    d.assets[CHARACTER] = {
      contentType: "text/plain",
      encoding: "text",
      data: encodeAIThemeCBA1(
        Array.from({ length: 4 }, () => new Uint8Array(48 * 48 * 4).fill(255)),
      ),
    };
    d.spec.primitives.push({
      type: "sprite",
      x: 20,
      y: 20,
      width: 48,
      height: 48,
      assetPath: CHARACTER,
    });
    expect(() => applySceneMotion(d, plan)).toThrow("one animation");
    expect(
      applySceneMotion(d, plan, true).spec.primitives.some(
        (p) => p.assetPath === CHARACTER,
      ),
    ).toBe(false);
    const moved = document();
    moved.spec.primitives[0].x = 1;
    expect(() => applySceneMotion(moved, plan)).toThrow("original full-size");
  });
  it("undo/redo restores exact document and new art rebuilds attached motion", () => {
    const d = document(),
      animated = applySceneMotion(d, plan);
    let state = createThemeStudioEditorState(d);
    state = themeStudioEditorReducer(state, {
      type: "update",
      document: animated,
    });
    state = themeStudioEditorReducer(state, { type: "undo" });
    expect(state.present).toEqual(d);
    state = themeStudioEditorReducer(state, { type: "redo" });
    expect(state.present).toEqual(animated);
    d.assets[ART].data = d.assets[ART].data.replace("#112233", "#223344");
    const next = applyAIThemeCandidate(
      animated,
      { ...d, notes: "Updated" },
      "scene",
    );
    expect(sceneMotionPlan(next)).toEqual(plan);
    expect(next.assets[next.spec.primitives[1].assetPath!].data).toContain(
      "#223344",
    );
    expect(next.spec.primitives[2].text).toBe("Keep me");
  });
});
