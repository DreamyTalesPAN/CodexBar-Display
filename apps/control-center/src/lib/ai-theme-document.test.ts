import { describe, expect, it, vi } from "vitest";
import {
  applyAIThemeCandidate,
  setAIAnimationSpeed,
  conceptFromDocument,
} from "./ai-theme-document";
import {
  AI_THEME_ANIMATION_ASSET_PATH as ANIMATION,
  AI_THEME_SCREENMASTER_ASSET_PATH as ART,
  buildAIThemeAnimationCandidateFromRGBA,
  encodeAIThemeCBA1,
  type AIThemeConcept,
} from "./ai-theme";
import {
  createThemeStudioEditorState,
  themeStudioEditorReducer,
} from "@/components/theme-studio/theme-studio-editor-state";
import type { ThemeStudioDocument } from "./theme-studio-storage";

const concept: AIThemeConcept = {
  imageBase64: "",
  imageContentType: "image/png",
  style: {
    animationMode: "four_frame",
    animationPrompt: "Blinks",
    artPrompt: "A cat",
    environmentPrompt: "Lake",
    backgroundColor: "#112233",
    borderRadius: 0,
    notes: "Calm",
    packName: "Moonlight",
    panelColor: "#112233",
    progressStyle: "solid",
    sessionColor: "#CCFF00",
    textColor: "#EEEEEE",
    title: "Moonlight",
    weeklyColor: "#CCFF00",
  },
};
function candidate() {
  const background = new Uint8ClampedArray(240 * 128 * 4).fill(100);
  const frames = Array.from(
    { length: 4 },
    () => new Uint8ClampedArray(48 * 48 * 4),
  );
  frames.forEach((f) => {
    f[100 * 4] = 200;
    f[100 * 4 + 3] = 255;
  });
  return buildAIThemeAnimationCandidateFromRGBA(concept, background, frames);
}
describe("AI scene document", () => {
  it("sends all eight previous frames for refinement instead of truncating the return leg", () => {
    const canvases: Array<{width:number;height:number; calls:number[][]}> = [];
    const fakeDocument={createElement:()=>{
      const canvas={width:0,height:0,calls:[] as number[][],getContext:()=>({fillStyle:"",fillRect:(...args:number[])=>canvas.calls.push(args)}),toDataURL:()=>"data:image/png;base64,fixture"};
      canvases.push(canvas);return canvas;
    }};
    vi.stubGlobal("document",fakeDocument);vi.stubGlobal("window",{document:fakeDocument});
    try {
      const c=candidate();const loop="/themes/u/ai-scene-loop.cba";
      const frames=Array.from({length:8},(_,n)=>{const pixels=new Uint8ClampedArray(32*32*4);for(let i=0;i<pixels.length;i+=4)pixels.set([n*17,34,51,255],i);return pixels;});
      c.assets[loop]={contentType:"text/plain",encoding:"text",data:encodeAIThemeCBA1(frames,32,32,8)};
      c.spec.primitives.push({type:"sprite",x:20,y:20,width:32,height:32,assetPath:loop,frameCount:8});
      const result=conceptFromDocument({...c,usage:"live"});
      expect(result?.animation).toBeDefined();
      const reference=canvases.find(canvas=>canvas.width===128&&canvas.height===64);
      expect(reference).toBeDefined();
      expect(reference!.calls.some(([x,y])=>x===96&&y>=32)).toBe(true);
    } finally {vi.unstubAllGlobals();}
  });
  it("keeps transparent sprite pixels rather than baking in the old background", () => {
    const c = candidate();
    expect(c.assets[ANIMATION].data).toContain("48.");
    expect(c.assets[ANIMATION].data).toMatch(/^CBA1\n48 48 4 4/);
  });
  it("preserves manual positions, labels, removed readings and independent assets", () => {
    const c = candidate();
    const d: ThemeStudioDocument = {
      assets: {
        ...c.assets,
        "/themes/u/custom.cbi": {
          data: "custom",
          encoding: "text",
          contentType: "text/plain",
        },
      },
      packName: "My edits",
      spec: { ...c.spec, primitives: c.spec.primitives.slice(0, 3) },
    };
    d.spec.primitives[0] = { ...d.spec.primitives[0], x: 0, y: 10, width: 210 };
    d.spec.primitives[1] = { ...d.spec.primitives[1], x: 60, y: 30 };
    const result = applyAIThemeCandidate(d, c, "scene");
    expect(result.spec.primitives).toHaveLength(3);
    expect(result.spec.primitives[0]).toMatchObject({ y: 10, width: 210 });
    expect(result.spec.primitives[1]).toMatchObject({ x: 60, y: 30 });
    expect(result.packName).toBe("My edits");
    expect(result.assets["/themes/u/custom.cbi"]).toBeDefined();
  });
  it("changes only the animation asset for a movement edit", () => {
    const c = candidate();
    const d: ThemeStudioDocument = {
      ...c,
      assets: {
        ...c.assets,
        [ART]: {
          encoding: "text",
          contentType: "text/plain",
          data: "original background",
        },
      },
    };
    const result = applyAIThemeCandidate(d, c, "animation");
    expect(result.assets[ART].data).toBe("original background");
    expect(result.spec).toEqual(d.spec);
  });
  it("speed changes the actual CBA header and survives shared undo/redo", () => {
    const initial = createThemeStudioEditorState(candidate());
    const changed = themeStudioEditorReducer(initial, {
      type: "mutate",
      mutate: (d) => setAIAnimationSpeed(d, ANIMATION, 8),
    });
    expect(changed.present.assets[ANIMATION].data).toMatch(/^CBA1\n48 48 4 8/);
    const undone = themeStudioEditorReducer(changed, { type: "undo" });
    expect(undone.present).toEqual(initial.present);
    expect(themeStudioEditorReducer(undone, { type: "redo" }).present).toEqual(
      changed.present,
    );
  });
  it("rejects malformed animation frame inputs", () => {
    expect(() => encodeAIThemeCBA1([])).toThrow();
  });
  it("preserves the manually chosen playback speed after AI refinement", () => {
    const c = candidate();
    const d: ThemeStudioDocument = { ...c };
    setAIAnimationSpeed(d, ANIMATION, 8);
    const result = applyAIThemeCandidate(d, candidate(), "animation");
    expect(result.assets[ANIMATION].data).toMatch(/^CBA1\n48 48 4 8/);
    expect(
      result.spec.primitives.find((p) => p.assetPath === ANIMATION)?.fps,
    ).toBe(8);
  });
});
