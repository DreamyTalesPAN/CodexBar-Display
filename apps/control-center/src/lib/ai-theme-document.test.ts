import { decodeSprite } from "@/components/live-vibetv-preview";
import { describe, expect, it, vi } from "vitest";
import {
  applyAIThemeCandidate,
  pruneUnusedThemeAssets,
  setAIAnimationSpeed,
  conceptFromDocument,
  adoptPicture,
  flattenCompanionSprites,
} from "./ai-theme-document";
import {
  AI_THEME_ANIMATION_ASSET_PATH as ANIMATION,
  AI_THEME_SCREENMASTER_ASSET_PATH as ART,
  buildAIThemeAnimationCandidateFromRGBA,
  encodeAIThemeCBA1,
  encodeAIThemeCBI1,
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
  it("keeps manually placed artwork geometry when only companion sprites change", () => {
    const c = candidate();
    c.spec.primitives = c.spec.primitives.filter((p) => p.assetPath !== ANIMATION);
    c.spec.primitives.splice(1, 0, { type: "sprite", assetPath: "/themes/u/ai-pet-1.cba", x: 170, y: 72, width: 48, height: 48, fps: 4 });
    c.assets["/themes/u/ai-pet-1.cba"] = { data: "", encoding: "base64", contentType: "application/octet-stream" };
    const d: ThemeStudioDocument = { assets: { ...c.assets }, packName: "Mine", spec: { ...c.spec, primitives: c.spec.primitives.map((p) => ({ ...p })) } };
    d.spec.primitives[0] = { ...d.spec.primitives[0], x: 8, y: 12, width: 200, height: 100 };
    const result = applyAIThemeCandidate(d, c, "auto");
    expect(result.spec.primitives.find((p) => p.assetPath === ART)).toMatchObject({ x: 8, y: 12, width: 200, height: 100 });
  });
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

it("drops unused image bytes from the current draft and preserves exact Undo", () => {
  const document: ThemeStudioDocument = {
    packName: "Asset cleanup", assets: {"/themes/u/import.cbi": {contentType:"text/plain",encoding:"text",data:"original image"}},
    spec: {themeSpecVersion:1,themeId:"asset-cleanup",themeRev:1,primitives:[{type:"sprite",assetPath:"/themes/u/import.cbi",x:0,y:0,width:24,height:24}]},
  };
  const initial = createThemeStudioEditorState(document);
  const removed = themeStudioEditorReducer(initial, {type:"mutate",mutate:(draft)=>{draft.spec.primitives=[];pruneUnusedThemeAssets(draft);}});
  expect(removed.present.assets).toEqual({});
  expect(themeStudioEditorReducer(removed,{type:"undo"}).present).toEqual(initial.present);
});

describe("companion sprites on the device", () => {
  it("paints the artwork behind a companion into the copy sent to the device", () => {
    const artwork = new Uint8ClampedArray(240 * 128 * 4);
    for (let i = 0; i < artwork.length; i += 4) artwork.set([255, 0, 0, 255], i);
    const frames = Array.from({ length: 8 }, () => {
      const frame = new Uint8ClampedArray(16 * 16 * 4);
      frame.set([0, 0, 255, 255], 0);
      return frame;
    });
    const pet = "/themes/u/ai-pet-1.cba";
    const document = {
      packName: "Cat", usage: "live",
      assets: {
        [ART]: { contentType: "text/plain", encoding: "text", data: encodeAIThemeCBI1(artwork, 240, 128) },
        [pet]: { contentType: "text/plain", encoding: "text", data: encodeAIThemeCBA1(frames, 16, 16, 2) },
      },
      spec: { primitives: [
        { type: "sprite", assetPath: ART, x: 0, y: 0, width: 240, height: 128 },
        { type: "sprite", assetPath: pet, x: 100, y: 120, width: 32, height: 32, frameCount: 8, fps: 2, sheetColumns: 8 },
      ] },
    } as unknown as ThemeStudioDocument;
    const original = document.assets[pet].data;
    const rows = flattenCompanionSprites(document).assets[pet].data.split("\n");
    expect(document.assets[pet].data).toBe(original);
    expect(rows.slice(0, 2)).toEqual(["CBA1", "16 16 8 2"]);
    expect(rows.slice(3, 5).sort()).toEqual(["#0000FF", "#FF0000"]);
    // The top quarter lies over the artwork; the rest hangs below it and stays
    // transparent, where the device shows the theme background as before.
    const pixels = rows.slice(5, 5 + 16);
    expect(pixels[0]).toMatch(/^[ab]15[ab]$/);
    expect(pixels[3]).not.toContain(".");
    expect(pixels[4]).toBe("16.");
  });
  it("preserves the device's rounded rectangle pixels in every animation frame", () => {
    const pet="/themes/u/ai-pet-1.cba";
    const frames=Array.from({length:4},()=>{const p=new Uint8ClampedArray(16*16*4);p.set([0,0,255,255],(8*16+8)*4);return p;});
    const document={packName:"Rounded",assets:{[pet]:{contentType:"text/plain",encoding:"text",data:encodeAIThemeCBA1(frames,16,16,2)}},spec:{primitives:[
      {type:"rect",x:0,y:0,width:16,height:16,color:"#FF0000"},
      {type:"rect",x:0,y:0,width:16,height:16,color:"#00FF00",borderRadius:4},
      {type:"sprite",x:0,y:0,width:16,height:16,assetPath:pet},
    ]}} as unknown as ThemeStudioDocument;
    const original=structuredClone(document);
    const sprite=decodeSprite(flattenCompanionSprites(document).assets[pet].data)!;
    const inset=[3,1,1,0,0,0,0,0,0,0,0,0,0,1,1,3];
    for(const frame of sprite.frames) for(let y=0;y<16;y++) for(let x=0;x<16;x++) {
      const color=frame.find(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height)?.color;
      expect(color).toBe(x===8&&y===8?'#0000FF':x<inset[y]||x>=16-inset[y]?'#FF0000':'#00FF00');
    }
    expect(document).toEqual(original);
  });
  it("redraws the picture of an older design in its place and keeps the rest", () => {
    const old = "/themes/s/synth-bg.cbi";
    const document = {
      packName: "Synthwave Custom", usage: "live",
      assets: { [old]: { contentType: "text/plain", encoding: "text", data: encodeAIThemeCBI1(new Uint8ClampedArray(240 * 128 * 4).fill(50), 240, 128) } },
      spec: { themeId: "synth", themeRev: 3, bgColor: "#000000", primitives: [
        { type: "rect", x: 0, y: 0, width: 240, height: 240, color: "#220044" },
        { type: "sprite", assetPath: old, x: 0, y: 8 },
        { type: "progress", binding: "session", x: 8, y: 150, width: 200, height: 8, color: "#FF00FF" },
      ] },
    } as unknown as ThemeStudioDocument;
    const base = adoptPicture(document);
    expect(document.spec.primitives[1].assetPath).toBe(old);
    expect(base.spec.primitives[1]).toMatchObject({ assetPath: ART, x: 0, y: 8, width: 240, height: 128 });
    expect(adoptPicture(base)).toBe(base);
    const next = applyAIThemeCandidate(base, candidate(), "auto");
    // Backdrop first, then the new picture in the old place, readout kept.
    expect(next.spec.primitives[0]).toMatchObject({ type: "rect", color: "#220044" });
    expect(next.spec.primitives[1]).toMatchObject({ assetPath: ART, x: 0, y: 8, width: 240, height: 128 });
    expect(next.spec.primitives.at(-1)).toMatchObject({ type: "progress", binding: "session" });
    expect(next.assets[ART].data).not.toBe(base.assets[ART].data);
    // A small icon is no picture of the design.
    const icon = { ...document, spec: { ...document.spec, primitives: [{ ...document.spec.primitives[1], width: 40, height: 40 }] } } as ThemeStudioDocument;
    expect(adoptPicture(icon)).toBe(icon);
    expect(adoptPicture(icon, [0]).spec.primitives[0].assetPath).toBe(ART);
  });
});
