import { describe, expect, it } from "vitest";
import {
  buildAIThemeCandidate,
  buildAIThemeSceneCandidateFromRGBA,
  buildAIThemeCandidateFromRGBA,
  buildAIThemeAnimationCandidateFromRGBA,
  encodeAIThemeCBI1,
  AI_THEME_SCENE_LOOP_ASSET_PATH as LOOP,
  AI_THEME_SCREENMASTER_ASSET_PATH as ART,
  AI_THEME_ANIMATION_ASSET_PATH as CHARACTER,
  type AIThemeConcept,
} from "./ai-theme";
import { applyAIThemeCandidate } from "./ai-theme-document";
import { decodeSprite } from "@/components/live-vibetv-preview";
import { buildThemePack, validateThemeSpec } from "./theme-studio";
import {
  createThemeStudioEditorState,
  themeStudioEditorReducer,
} from "@/components/theme-studio/theme-studio-editor-state";

const concept: AIThemeConcept = {
  imageBase64: "",
  imageContentType: "image/png",
  sceneAnimation: {
    x: 20,
    y: 20,
    width: 32,
    height: 32,
    fps: 4,
    sheetBase64: "",
  },
  style: {
    animationMode: "scene_loop",
    animationPrompt: "The monitor code moves",
    artPrompt: "An office",
    environmentPrompt: "A room",
    backgroundColor: "#112233",
    panelColor: "#112233",
    textColor: "#FFFFFF",
    sessionColor: "#FFFFFF",
    weeklyColor: "#FFFFFF",
    borderRadius: 0,
    progressStyle: "solid",
    packName: "Office",
    title: "Office",
    notes: "The code moves on the monitor.",
  },
};
function fixtures() {
  const background = new Uint8ClampedArray(240 * 128 * 4);
  for (let i = 0; i < background.length; i += 4)
    background.set([17, 34, 51, 255], i);
  for (let y = 28; y < 34; y++)
    for (let x = 28; x < 38; x++)
      background.set([255, 255, 255, 255], (y * 240 + x) * 4);
  const frames = Array.from({ length: 4 }, (_, frame) => {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([17, 34, 51, 255], i);
    for (let y = 8 + frame; y < 14 + frame; y++)
      for (let x = 8; x < 18; x++)
        data.set([255, 255, 255, 255], (y * 32 + x) * 4);
    return data;
  });
  return { background, frames };
}
describe("AI-owned unified scene creation", () => {
  it("compiles eight original-pixel frames into one device-safe scene layer", () => {
    const {background,frames}=fixtures();
    const eight=[...frames,...frames.slice().reverse()];
    const next={...concept,sceneAnimation:{...concept.sceneAnimation!,frameCount:8,fps:8},style:{...concept.style,preserveArtwork:true}};
    const candidate=buildAIThemeSceneCandidateFromRGBA(next,background,eight);
    const sprite=decodeSprite(candidate.assets[LOOP].data)!;
    expect(sprite.frames).toHaveLength(8);
    expect(sprite.fps).toBe(8);
    expect(candidate.assets[ART].data).toBe(encodeAIThemeCBI1(background));
    expect(candidate.spec.primitives.filter(p=>p.assetPath===LOOP)).toHaveLength(1);
    expect(candidate.spec.primitives.find(p=>p.assetPath===LOOP)?.frameCount).toBe(8);
    expect(validateThemeSpec(candidate.spec,candidate.assets).errors).toEqual([]);
    expect(()=>buildThemePack(candidate.spec,candidate.packName,candidate.assets)).not.toThrow();
  });
  it("rejects a mismatched or oversized scene frame declaration", () => {
    const {background,frames}=fixtures();
    for(const frameCount of [8,16,1000000]) expect(()=>buildAIThemeSceneCandidateFromRGBA({...concept,sceneAnimation:{...concept.sceneAnimation!,frameCount}},background,frames)).toThrow();
  });
  it("does not rebuild a preserved illustration's palette when changing motion", () => {
    const {background, frames} = fixtures();
    const before = encodeAIThemeCBI1(background);
    const result = buildAIThemeSceneCandidateFromRGBA(
      {...concept, style:{...concept.style, preserveArtwork:true}}, background, frames,
    );
    expect(result.assets[ART].data).toBe(before);
  });
  it("retains a small moving subject's red color despite many common background shades", () => {
    const { background, frames } = fixtures();
    for (let y = 60; y < 128; y++)
      for (let x = 0; x < 240; x++)
        background.set([17 * (x % 8), 17 * (y % 8), 153, 255], (y * 240 + x) * 4);
    for (let i = 0; i < background.length; i += 4)
      if (background[i] === 255) background.set([255, 0, 0, 255], i);
    for (let y = 90; y < 100; y++)
      for (let x = 180; x < 190; x++)
        background.set([0, 255, 0, 255], (y * 240 + x) * 4);
    for (const frame of frames)
      for (let i = 0; i < frame.length; i += 4)
        if (frame[i] === 255) frame.set([255, 0, 0, 255], i);
    const result = buildAIThemeSceneCandidateFromRGBA(concept, background, frames);
    const palette = result.assets[ART].data.split("\n");
    expect(palette.slice(3, 3 + Number(palette[2]))).toContain("#FF0000");
    expect(palette.slice(3, 3 + Number(palette[2]))).toContain("#00FF00");
    const sprite = decodeSprite(result.assets[LOOP].data)!;
    expect(sprite.frames.every((frame) => frame.some((run) => run.color === "#FF0000"))).toBe(true);
    expect(validateThemeSpec(result.spec, result.assets).errors).toEqual([]);
  });
  it("keeps a visible light pulse even when its brighter color was absent from the still", () => {
    const { background, frames } = fixtures();
    for (let n = 0; n < 4; n++)
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const source = ((20 + y) * 240 + 20 + x) * 4;
          frames[n].set(background.slice(source, source + 4), (y * 32 + x) * 4);
          if (n === 2 && x >= 8 && x < 14 && y >= 8 && y < 14)
            frames[n].set([255, 204, 170, 255], (y * 32 + x) * 4);
        }
    const result = buildAIThemeSceneCandidateFromRGBA(concept, background, frames);
    const sprite = decodeSprite(result.assets[LOOP].data)!;
    expect(new Set(sprite.frames.map((frame) => JSON.stringify(frame))).size).toBe(2);
  });
  it("rejects unsafe provider dimensions before decoding or allocating a canvas", async () => {
    await expect(buildAIThemeCandidate({
      ...concept,
      sceneAnimation: {...concept.sceneAnimation!, width: 1000000},
    })).rejects.toThrow("invalid dimensions");
  });
  it("compiles genuine generated frames with fixed original edges and valid device export", () => {
    const { background, frames } = fixtures();
    const result = buildAIThemeSceneCandidateFromRGBA(
      concept,
      background,
      frames,
    );
    expect(validateThemeSpec(result.spec, result.assets).errors).toEqual([]);
    expect(result.assets[LOOP].data).toMatch(/^CBA1\n32 32 4 4/);
    const sprite = decodeSprite(result.assets[LOOP].data)!;
    expect(new Set(sprite.frames.map((f) => JSON.stringify(f))).size).toBe(4);
    for (const frame of sprite.frames)
      expect(
        frame.filter((r) => r.y === 0).every((r) => r.color === "#112233"),
      ).toBe(true);
    expect(
      buildThemePack(result.spec, result.packName, result.assets).zipBytes
        .length,
    ).toBeGreaterThan(0);
  });
  it("accepts valid stills and redraws without aesthetic gates, but rejects unsafe bounds", () => {
    const { background, frames } = fixtures();
    expect(() =>
      buildAIThemeSceneCandidateFromRGBA(
        concept,
        background,
        Array(4).fill(frames[0]),
      ),
    ).not.toThrow();
    expect(() =>
      buildAIThemeSceneCandidateFromRGBA(
        { ...concept, sceneAnimation: { ...concept.sceneAnimation!, x: 230 } },
        background,
        frames,
      ),
    ).toThrow("invalid dimensions");
    expect(() =>
      buildAIThemeSceneCandidateFromRGBA(
        concept,
        background,
        Array.from({ length: 4 }, () =>
          new Uint8ClampedArray(32 * 32 * 4).fill(255),
        ),
      ),
    ).not.toThrow();
  });
  it("switches representation atomically, keeping labels, removed readings and custom assets", () => {
    const { background, frames } = fixtures();
    const initial = buildAIThemeCandidateFromRGBA(
      {
        ...concept,
        sceneAnimation: undefined,
        style: {
          ...concept.style,
          animationMode: "static",
          animationPrompt: "",
        },
      },
      background,
    );
    initial.spec.primitives = [
      initial.spec.primitives[0],
      { type: "text", x: 17, y: 180, text: "My label", fontSize: 2 },
    ];
    initial.assets["/themes/u/manual.cbi"] = {
      encoding: "text",
      contentType: "text/plain",
      data: "preserved",
    };
    const animated = applyAIThemeCandidate(
      initial,
      buildAIThemeSceneCandidateFromRGBA(concept, background, frames),
      "auto",
    );
    expect(animated.spec.primitives).toHaveLength(3);
    expect(animated.spec.primitives[2]).toEqual(initial.spec.primitives[1]);
    expect(animated.assets["/themes/u/manual.cbi"].data).toBe("preserved");
    const still = applyAIThemeCandidate(animated, initial, "auto");
    expect(still.spec.primitives.some((p) => p.assetPath === LOOP)).toBe(false);
    expect(still.assets[LOOP]).toBeUndefined();
    expect(still.assets[ART]).toEqual(initial.assets[ART]);
    let state = createThemeStudioEditorState(initial);
    const originalDocument=state.present;
    state = themeStudioEditorReducer(state, {
      type: "update",
      document: animated,
    });
    expect(themeStudioEditorReducer(state, { type: "undo" }).present).toEqual(
      originalDocument,
    );
  });
  it("keeps a standalone character's manually chosen position on automatic refinement", () => {
    const { background } = fixtures();
    const frames = Array.from({ length: 4 }, () =>
      new Uint8ClampedArray(48 * 48 * 4).fill(255),
    );
    const result = buildAIThemeAnimationCandidateFromRGBA(
      { ...concept, sceneAnimation: undefined },
      background,
      frames,
    );
    result.spec.primitives[1].x = 31;
    result.spec.primitives[1].y = 45;
    const refined = applyAIThemeCandidate(
      result,
      buildAIThemeAnimationCandidateFromRGBA(
        { ...concept, sceneAnimation: undefined },
        background,
        frames,
      ),
      "auto",
    );
    expect(
      refined.spec.primitives.find((p) => p.assetPath === CHARACTER),
    ).toMatchObject({ x: 31, y: 45 });
  });
});
