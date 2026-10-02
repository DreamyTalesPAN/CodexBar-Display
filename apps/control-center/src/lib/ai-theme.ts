import { companionRequestUrl } from "@/components/control-center-runtime";
import type { SceneMotionPlan } from "./ai-scene-motion";
import { normalizeCompanionSheet } from "./ai-companion-sprites";
import type { AIThemeLayoutPlan, layoutContext } from "./ai-theme-layout";
import {
  validateThemeSpec,
  type ThemeStudioAsset,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";

export type AIThemeProviderId = "openai";
export type AIThemeMessage = {
  content: string;
  createdAt: string;
  role: "assistant" | "user";
};
export type AIThemeStyle = {
  animationMode: "four_frame" | "static" | "scene_loop";
  preserveArtwork?: boolean;
  animationPrompt: string;
  artPrompt: string;
  environmentPrompt: string;
  backgroundColor: string;
  borderRadius: number;
  notes: string;
  packName: string;
  panelColor: string;
  progressStyle: "segments" | "solid";
  sessionColor: string;
  textColor: string;
  title: string;
  weeklyColor: string;
};
export type AIThemeConcept = {
  companions?: AIThemeCompanion[];
  referenceImageBase64?: string;
  sceneAnimation?: {
    x: number;
    y: number;
    width: number;
    height: number;
    fps: number;
    frameCount?: number;
    sheetBase64: string;
  };
  sceneMotion?: SceneMotionPlan;
  animation?: {
    fps: number;
    keyColor: string;
    spriteSheetBase64: string;
  };
  imageBase64: string;
  imageContentType: "image/png";
  style: AIThemeStyle;
};
export type AIThemeCandidate = {
  preserveArtwork?: boolean;
  retainedCompanions?: string[];
  assets: Record<string, ThemeStudioAsset>;
  notes: string;
  packName: string;
  spec: ThemeStudioSpec;
};
export type AIThemeCompanion = {
  id: "pet-1" | "pet-2";
  x: number; y: number; size: number; fps: number;
  frameCount: number; keyColor: string; sheetBase64: string; reuse: boolean;
};
export function isCompanionSprite(path?: string): boolean {
  return /^\/themes\/u\/ai-pet-[12]\.cba$/.test(path || "");
}
export type AIThemeSession = {
  candidate: AIThemeCandidate;
  concept: AIThemeConcept;
};
export type AIThemeCapabilities = {
  enabled: boolean;
  providers: Array<{ configured: boolean; verificationRequired?: boolean; id: AIThemeProviderId }>;
};

export const AI_THEME_SCREENMASTER_ASSET_PATH = "/themes/u/ai-screen.cbi";
export const AI_THEME_ANIMATION_ASSET_PATH = "/themes/u/ai-animation.cba";
export const AI_THEME_SCENE_LOOP_ASSET_PATH = "/themes/u/ai-scene-loop.cba";
export function isAttachedSceneAnimation(path?: string): boolean {
  return Boolean(
    path &&
    /^\/themes\/u\/ai-scene-(loop|breathe|sway|flicker|scroll)\.cba$/.test(
      path,
    ),
  );
}
const SCREENMASTER_WIDTH = 240;
const SCREENMASTER_ART_HEIGHT = 128;
const ANIMATION_FRAME_SIZE = 48;
const ANIMATION_FRAME_COUNT = 4;
const ANIMATION_CONTENT_SIZE = 44;
const MAX_COLORS = 26;
export const AI_THEME_LOCAL_HISTORY_LIMIT = 20;
export const AI_THEME_TRANSMITTED_HISTORY_LIMIT = 10;

export async function fetchAIThemeCapabilities(
  signal?: AbortSignal,
): Promise<AIThemeCapabilities> {
  return aiRequest<AIThemeCapabilities>("/v1/ai-theme/capabilities", {
    method: "GET",
    signal,
  });
}

export async function saveAIThemeCredential(
  provider: AIThemeProviderId,
  apiKey: string,
): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/credential`, {
    body: JSON.stringify({ apiKey }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

export async function deleteAIThemeCredential(
  provider: AIThemeProviderId,
): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/credential`, {
    method: "DELETE",
  });
}

export async function verifyAIThemeCredential(
  provider: AIThemeProviderId,
): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/verify`, {
    method: "POST",
  });
}

export async function generateAIThemeConcept(
  input: {
    history: AIThemeMessage[];
    previous?: AIThemeConcept;
    prompt: string;
    target?: "scene" | "animation" | "scene_motion" | "auto" | "companions";
  },
  signal?: AbortSignal,
): Promise<AIThemeConcept> {
  return aiRequest<AIThemeConcept>("/v1/ai-theme/concepts", {
    body: JSON.stringify({
      prompt: input.prompt,
      target: input.target,
      history: input.history
        .slice(-AI_THEME_TRANSMITTED_HISTORY_LIMIT)
        .map(({ content, role }) => ({ content, role })),
      previous: input.previous
        ? {
            animationSheetBase64: input.previous.animation?.spriteSheetBase64,
            companions: input.previous.companions,
            referenceImageBase64: input.previous.referenceImageBase64,
            imageBase64: input.previous.imageBase64,
            imageContentType: input.previous.imageContentType,
            style: input.previous.style,
          }
        : undefined,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });
}

export async function planAIThemeLayout(prompt: string, layout: ReturnType<typeof layoutContext>, signal?: AbortSignal): Promise<AIThemeLayoutPlan> {
  return aiRequest<AIThemeLayoutPlan>("/v1/ai-theme/concepts", {
    body: JSON.stringify({prompt,target:"layout",layout}),
    headers: {"Content-Type":"application/json"}, method:"POST", signal,
  });
}

export async function buildAIThemeCandidate(
  concept: AIThemeConcept,
): Promise<AIThemeCandidate> {
  if (concept.companions) validateCompanions(concept);
  const region = concept.sceneAnimation;
  if (region && (
    ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
    region.x < 0 || region.y < 0 ||
    region.width < 8 || region.height < 8 ||
    region.width > 64 || region.height > 64 ||
    region.x + region.width > 240 || region.y + region.height > 128
  )) throw new Error("The generated scene animation has invalid dimensions.");
  const encodedFrames = [
    concept.imageBase64,
    ...(concept.animation ? [concept.animation.spriteSheetBase64] : []),
    ...(concept.sceneAnimation ? [concept.sceneAnimation.sheetBase64] : []),
    ...(concept.companions || []).map(p => p.sheetBase64),
  ];
  if (concept.animation && !concept.animation.spriteSheetBase64) {
    throw new Error("Animated concepts must contain a sprite sheet.");
  }
  const bitmaps = await Promise.all(
    encodedFrames.map((value) =>
      conceptBitmap(value, concept.imageContentType),
    ),
  );
  try {
    if (concept.companions) {
      return buildAIThemeCompanionCandidateFromRGBA(concept, bitmapRGBA(bitmaps[0]!, 240, 128), concept.companions.map((p, i) => normalizeCompanionSheet(bitmaps[i + 1]!, Math.min(p.size, 64))));
    }
    if (concept.sceneAnimation) {
      if (concept.animation)
        throw new Error("Only one animation can be used at a time.");
      const region = concept.sceneAnimation;
      const sheet = bitmaps[1]!;
      const frameCount = region.frameCount ?? 4;
      if (![4, 8].includes(frameCount)) throw new Error("The scene animation has an unsupported frame count.");
      const columns = frameCount / 2;
      const frames = Array.from({ length: frameCount }, (_, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = region.width;
        canvas.height = region.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Image preparation is unavailable.");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          sheet,
          ((index % columns) * sheet.width) / columns,
          (Math.floor(index / columns) * sheet.height) / 2,
          sheet.width / columns,
          sheet.height / 2,
          0,
          0,
          region.width,
          region.height,
        );
        return ctx.getImageData(0, 0, region.width, region.height).data;
      });
      return buildAIThemeSceneCandidateFromRGBA(
        concept,
        bitmapRGBA(bitmaps[0]!, 240, 128),
        frames,
      );
    }
    if (concept.animation) {
      const background = bitmapRGBA(
        bitmaps[0]!,
        SCREENMASTER_WIDTH,
        SCREENMASTER_ART_HEIGHT,
      );
      const frames = normalizeAnimationSpriteSheet(
        bitmaps[1]!,
        concept.animation.keyColor,
      );
      return buildAIThemeAnimationCandidateFromRGBA(
        concept,
        background,
        frames,
        concept.animation.fps,
      );
    }
    const rgba = bitmapRGBA(
      bitmaps[0]!,
      SCREENMASTER_WIDTH,
      SCREENMASTER_ART_HEIGHT,
    );
    return buildAIThemeCandidateFromRGBA(concept, rgba);
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
}

export function buildAIThemeSceneCandidateFromRGBA(
  concept: AIThemeConcept,
  background: ArrayLike<number>,
  inputFrames: ArrayLike<number>[],
): AIThemeCandidate {
  const r = concept.sceneAnimation;
  if (
    !r ||
    ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 8 ||
    r.height < 8 ||
    r.width > 64 ||
    r.height > 64 ||
    r.x + r.width > 240 ||
    r.y + r.height > 128 ||
    ![4, 8].includes(r.frameCount ?? 4) ||
    inputFrames.length !== (r.frameCount ?? 4) ||
    inputFrames.some((f) => f.length !== r.width * r.height * 4)
  )
    throw new Error("The generated scene animation has invalid dimensions.");
  // Small animated subjects must not lose their defining colors to a large
  // background. Reserve a few shared palette entries for actual changing pixels,
  // including new light levels, before filling with common background colors.
  const detailColors = new Map<string, number>();
  for (const frame of inputFrames)
    for (let y = 3; y < r.height - 3; y++)
      for (let x = 3; x < r.width - 3; x++) {
        const offset = (y * r.width + x) * 4;
        const source = ((r.y + y) * 240 + r.x + x) * 4;
        const next = quantizedColor(frame[offset], frame[offset + 1], frame[offset + 2]);
        const original = quantizedColor(background[source], background[source + 1], background[source + 2]);
        if (next !== original) detailColors.set(next, (detailColors.get(next) ?? 0) + 1);
      }
  const priorityColors = [...detailColors].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([color]) => color);
  const backgroundData = encodeAIThemeCBI1(
    background, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT,
    concept.style.preserveArtwork ? [] : priorityColors,
  );
  const lines = backgroundData.split("\n"),
    palette = lines.slice(3, 3 + Number(lines[2]));
  const rgb = (c: string) =>
    c.match(/[0-9A-F]{2}/g)!.map((v) => parseInt(v, 16));
  const cache = new Map<string, number[]>();
  const color = (pixels: ArrayLike<number>, offset: number) => {
    const key = quantizedColor(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
    );
    if (!cache.has(key)) cache.set(key, rgb(nearestColor(key, palette)));
    return cache.get(key)!;
  };
  const frames = inputFrames.map((input) => {
    const frame = new Uint8ClampedArray(input.length);
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const offset = (y * r.width + x) * 4,
          source = ((r.y + y) * 240 + r.x + x) * 4;
        const original = color(background, source);
        const edge = x < 3 || y < 3 || x >= r.width - 3 || y >= r.height - 3;
        const next = edge ? original : color(input, offset);
        frame.set([...next, 255], offset);
      }
    return frame;
  });
  const animationData = encodeAIThemeCBA1(frames, r.width, r.height, r.fps);
  return buildCandidate(
    concept,
    {
      [AI_THEME_SCREENMASTER_ASSET_PATH]: {
        contentType: "text/plain",
        encoding: "text",
        data: backgroundData,
      },
      [AI_THEME_SCENE_LOOP_ASSET_PATH]: {
        contentType: "text/plain",
        encoding: "text",
        data: animationData,
      },
    },
    [
      {
        type: "sprite",
        x: 0,
        y: 0,
        width: 240,
        height: 128,
        assetPath: AI_THEME_SCREENMASTER_ASSET_PATH,
      },
      {
        type: "sprite",
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        assetPath: AI_THEME_SCENE_LOOP_ASSET_PATH,
        frameCount: inputFrames.length,
        fps: r.fps,
        sheetColumns: inputFrames.length,
      },
    ],
  );
}

export function buildAIThemeCandidateFromRGBA(
  concept: AIThemeConcept,
  rgba: ArrayLike<number>,
): AIThemeCandidate {
  const asset: ThemeStudioAsset = {
    contentType: "text/plain",
    data: encodeAIThemeCBI1(rgba, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT),
    encoding: "text",
  };
  return buildCandidate(
    concept,
    { [AI_THEME_SCREENMASTER_ASSET_PATH]: asset },
    [
      {
        type: "sprite",
        x: 0,
        y: 0,
        width: 240,
        height: 128,
        assetPath: AI_THEME_SCREENMASTER_ASSET_PATH,
      },
    ],
  );
}

export function buildAIThemeAnimationCandidateFromRGBA(
  concept: AIThemeConcept,
  background: ArrayLike<number>,
  frames: ArrayLike<number>[],
  fps = 4,
): AIThemeCandidate {
  if (frames.length !== ANIMATION_FRAME_COUNT) {
    throw new Error("Animated concepts must contain exactly four frames.");
  }
  const backgroundAsset: ThemeStudioAsset = {
    contentType: "text/plain",
    data: encodeAIThemeCBI1(
      background,
      SCREENMASTER_WIDTH,
      SCREENMASTER_ART_HEIGHT,
    ),
    encoding: "text",
  };
  const animationAsset: ThemeStudioAsset = {
    contentType: "text/plain",
    data: encodeAIThemeCBA1(
      frames,
      ANIMATION_FRAME_SIZE,
      ANIMATION_FRAME_SIZE,
      fps,
    ),
    encoding: "text",
  };
  return buildCandidate(
    concept,
    {
      [AI_THEME_SCREENMASTER_ASSET_PATH]: backgroundAsset,
      [AI_THEME_ANIMATION_ASSET_PATH]: animationAsset,
    },
    [
      {
        type: "sprite",
        x: 0,
        y: 0,
        width: 240,
        height: 128,
        assetPath: AI_THEME_SCREENMASTER_ASSET_PATH,
      },
      {
        type: "sprite",
        x: Math.round((SCREENMASTER_WIDTH - ANIMATION_FRAME_SIZE) / 2),
        y: Math.round((SCREENMASTER_ART_HEIGHT - ANIMATION_FRAME_SIZE) / 2),
        width: ANIMATION_FRAME_SIZE,
        height: ANIMATION_FRAME_SIZE,
        assetPath: AI_THEME_ANIMATION_ASSET_PATH,
        frameCount: ANIMATION_FRAME_COUNT,
        fps,
        sheetColumns: ANIMATION_FRAME_COUNT,
      },
    ],
  );
}

function buildCandidate(
  concept: AIThemeConcept,
  assets: Record<string, ThemeStudioAsset>,
  artPrimitives: ThemeStudioSpec["primitives"],
): AIThemeCandidate {
  const style = concept.style;
  const spec: ThemeStudioSpec = {
    themeSpecVersion: 1,
    themeId: themeIdForPack(style.packName),
    themeRev: 1,
    bgColor: style.backgroundColor,
    primitives: [
      ...artPrimitives,
      {
        type: "rect",
        x: 0,
        y: 128,
        width: 240,
        height: 112,
        color: style.panelColor,
        bgColor: style.panelColor,
        borderColor: style.panelColor,
        borderRadius: 0,
      },
      {
        type: "text",
        x: 12,
        y: 134,
        text: "SESSION",
        fontSize: 2,
        color: style.textColor,
      },
      {
        type: "text",
        x: 152,
        y: 134,
        width: 76,
        text: "{session}%",
        align: "right",
        fontSize: 2,
        color: style.sessionColor,
      },
      {
        type: "progress",
        x: 12,
        y: 154,
        width: 216,
        height: 13,
        binding: "session",
        color: style.sessionColor,
        bgColor: style.backgroundColor,
        borderColor: style.sessionColor,
        borderRadius: style.borderRadius,
        progressStyle: style.progressStyle,
        segments: style.progressStyle === "segments" ? 10 : undefined,
        segmentGap: style.progressStyle === "segments" ? 2 : undefined,
      },
      {
        type: "text",
        x: 12,
        y: 170,
        text: "{usageMode}",
        fontSize: 1,
        color: style.textColor,
      },
      {
        type: "text",
        x: 12,
        y: 184,
        text: "WEEKLY",
        fontSize: 2,
        color: style.textColor,
      },
      {
        type: "text",
        x: 152,
        y: 184,
        width: 76,
        text: "{weekly}%",
        align: "right",
        fontSize: 2,
        color: style.weeklyColor,
      },
      {
        type: "progress",
        x: 12,
        y: 204,
        width: 216,
        height: 13,
        binding: "weekly",
        color: style.weeklyColor,
        bgColor: style.backgroundColor,
        borderColor: style.weeklyColor,
        borderRadius: style.borderRadius,
        progressStyle: style.progressStyle,
        segments: style.progressStyle === "segments" ? 10 : undefined,
        segmentGap: style.progressStyle === "segments" ? 2 : undefined,
      },
      {
        type: "text",
        x: 12,
        y: 220,
        text: "{usageMode}",
        fontSize: 1,
        color: style.textColor,
      },
    ],
  };
  const validation = validateThemeSpec(spec, assets);
  if (validation.errors.length > 0) throw new Error(validation.errors[0]);
  return { assets, notes: style.notes, packName: style.packName, spec, preserveArtwork: style.preserveArtwork };
}

function validateCompanions(concept: AIThemeConcept) {
  const pets = concept.companions!;
  if (!Array.isArray(pets) || pets.length > 2 || concept.animation || concept.sceneAnimation || concept.sceneMotion)
    throw new Error("A scene supports up to two separate companions.");
  const ids = new Set<string>();
  for (const p of pets) {
    if (!p || !["pet-1", "pet-2"].includes(p.id) || ids.has(p.id) || ![p.x, p.y, p.size, p.fps].every(Number.isInteger) || p.size < 16 || p.size > 80 || p.x < 0 || p.y < 0 || p.x + p.size > 240 || p.y + p.size > 128 || ![0,1,2,4,8].includes(p.fps) || p.frameCount !== 8 || p.keyColor !== "#FF00FF" || !p.sheetBase64)
      throw new Error("The companion layout or sprite sheet is invalid.");
    ids.add(p.id);
  }
  if (pets.length === 2) {
    const [a,b] = pets;
    if (a.x < b.x+b.size && b.x < a.x+a.size && a.y < b.y+b.size && b.y < a.y+a.size)
      throw new Error("The companion sprites overlap. Your design is unchanged.");
  }
}

export function buildAIThemeCompanionCandidateFromRGBA(concept: AIThemeConcept, background: ArrayLike<number>, frames: ArrayLike<number>[][]): AIThemeCandidate {
  validateCompanions(concept);
  const pets=concept.companions!;
  if (frames.length !== pets.length) throw new Error("Missing companion frames.");
  const base = buildAIThemeCandidateFromRGBA(concept, background);
  const primitives: ThemeStudioSpec["primitives"] = [base.spec.primitives[0]];
  pets.forEach((p,i) => {
    if (frames[i].length !== 8) throw new Error("A companion needs eight frames.");
    const assetPath = `/themes/u/ai-${p.id}.cba`;
    base.assets[assetPath] = {contentType:"text/plain",encoding:"text",data:encodeAIThemeCBA1(frames[i],Math.min(p.size,64),Math.min(p.size,64),p.fps)};
    primitives.push({type:"sprite",assetPath,x:p.x,y:p.y,width:p.size,height:p.size,frameCount:8,fps:p.fps,sheetColumns:8});
  });
  const candidate=buildCandidate(concept,base.assets,primitives);
  candidate.retainedCompanions=pets.filter(p=>p.reuse).map(p=>`/themes/u/ai-${p.id}.cba`);
  return candidate;
}

export function encodeAIThemeCBA1(
  frames: ArrayLike<number>[],
  width = ANIMATION_FRAME_SIZE,
  height = ANIMATION_FRAME_SIZE,
  fps = 4,
): string {
  if (
    ![ANIMATION_FRAME_COUNT, 8].includes(frames.length) ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 64 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 64 ||
    width * height * frames.length > 32768 ||
    !Number.isInteger(fps) ||
    fps < 0 ||
    fps > 30 ||
    frames.some((frame) => frame.length !== width * height * 4)
  ) {
    throw new Error(
      "Animation must contain four or eight valid RGBA frames up to 64x64 pixels within the device budget.",
    );
  }
  const colors: Array<Array<string | null>> = [];
  const counts = new Map<string, number>();
  for (const rgba of frames) {
    const frameColors: Array<string | null> = [];
    for (let offset = 0; offset < rgba.length; offset += 4) {
      if ((rgba[offset + 3] ?? 0) < 128) {
        frameColors.push(null);
        continue;
      }
      const color = quantizedColor(
        rgba[offset] ?? 0,
        rgba[offset + 1] ?? 0,
        rgba[offset + 2] ?? 0,
      );
      frameColors.push(color);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    colors.push(frameColors);
  }
  const palette = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COLORS)
    .map(([color]) => color);
  if (palette.length === 0) palette.push("#FFFFFF");
  const rows = colors.flatMap((frame) =>
    Array.from({ length: height }, (_, y) => {
      const tokens = Array.from({ length: width }, (_, x) => {
        const color = frame[y * width + x];
        return color
          ? paletteToken(nearestColor(color, palette), palette)
          : ".";
      });
      return encodeRle(tokens);
    }),
  );
  return [
    "CBA1",
    `${width} ${height} ${frames.length} ${fps}`,
    String(palette.length),
    ...palette,
    ...rows,
    "",
  ].join("\n");
}

async function conceptBitmap(
  value: string,
  contentType: string,
): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(value), (character) =>
    character.charCodeAt(0),
  );
  return createImageBitmap(new Blob([bytes], { type: contentType }));
}

function bitmapRGBA(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The concept image could not be prepared.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function normalizeAnimationSpriteSheet(
  bitmap: ImageBitmap,
  keyColor: string,
): Uint8ClampedArray[] {
  const cellWidths = Array.from({ length: ANIMATION_FRAME_COUNT }, (_, frame) =>
    Math.max(
      1,
      Math.round(((frame + 1) * bitmap.width) / ANIMATION_FRAME_COUNT) -
        Math.round((frame * bitmap.width) / ANIMATION_FRAME_COUNT),
    ),
  );
  const sourceSize = Math.max(1, Math.min(bitmap.height, ...cellWidths));
  const sourceFrames = Array.from(
    { length: ANIMATION_FRAME_COUNT },
    (_, frame) => {
      const cellLeft = Math.round(
        (frame * bitmap.width) / ANIMATION_FRAME_COUNT,
      );
      const cellWidth = cellWidths[frame]!;
      const sourceX = Math.max(
        0,
        Math.min(
          bitmap.width - sourceSize,
          cellLeft + Math.round((cellWidth - sourceSize) / 2),
        ),
      );
      const sourceY = Math.max(0, Math.round((bitmap.height - sourceSize) / 2));
      const canvas = document.createElement("canvas");
      canvas.width = sourceSize;
      canvas.height = sourceSize;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context)
        throw new Error("The animation sprite sheet could not be prepared.");
      context.drawImage(
        bitmap,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        sourceSize,
        sourceSize,
      );
      return {
        canvas,
        image: context.getImageData(0, 0, sourceSize, sourceSize),
      };
    },
  );
  const key = hexRGB(keyColor);
  const bounds = sourceFrames.reduce(
    (current, frame) => {
      for (let y = 0; y < frame.image.height; y += 1) {
        for (let x = 0; x < frame.image.width; x += 1) {
          const offset = (y * frame.image.width + x) * 4;
          if (!isKeyPixel(frame.image.data, offset, key)) {
            current.left = Math.min(current.left, x);
            current.top = Math.min(current.top, y);
            current.right = Math.max(current.right, x);
            current.bottom = Math.max(current.bottom, y);
          }
        }
      }
      return current;
    },
    { bottom: -1, left: sourceSize, right: -1, top: sourceSize },
  );
  if (bounds.right < bounds.left || bounds.bottom < bounds.top) {
    throw new Error("OpenAI returned an empty animation sprite sheet.");
  }
  const padding = Math.max(1, Math.round(sourceSize * 0.015));
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const cropWidth = Math.min(
    sourceSize - left,
    bounds.right - bounds.left + 1 + padding * 2,
  );
  const cropHeight = Math.min(
    sourceSize - top,
    bounds.bottom - bounds.top + 1 + padding * 2,
  );
  const scale = Math.min(
    ANIMATION_CONTENT_SIZE / cropWidth,
    ANIMATION_CONTENT_SIZE / cropHeight,
  );
  const targetWidth = Math.max(1, Math.round(cropWidth * scale));
  const targetHeight = Math.max(1, Math.round(cropHeight * scale));
  return sourceFrames.map((frame) => {
    const target = document.createElement("canvas");
    target.width = ANIMATION_FRAME_SIZE;
    target.height = ANIMATION_FRAME_SIZE;
    const context = target.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The animation frame could not be prepared.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      frame.canvas,
      left,
      top,
      cropWidth,
      cropHeight,
      Math.round((ANIMATION_FRAME_SIZE - targetWidth) / 2),
      Math.round((ANIMATION_FRAME_SIZE - targetHeight) / 2),
      targetWidth,
      targetHeight,
    );
    const normalized = context.getImageData(
      0,
      0,
      ANIMATION_FRAME_SIZE,
      ANIMATION_FRAME_SIZE,
    );
    for (let offset = 0; offset < normalized.data.length; offset += 4) {
      if (isKeyPixel(normalized.data, offset, key))
        normalized.data[offset + 3] = 0;
    }
    return normalized.data;
  });
}

function hexRGB(value: string): [number, number, number] {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(value);
  if (!match) throw new Error("The animation key color is invalid.");
  return [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16),
  ];
}

function isKeyPixel(
  data: ArrayLike<number>,
  offset: number,
  key: [number, number, number],
): boolean {
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  const distance = Math.sqrt(
    (r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2,
  );
  return distance < 105 || (r > 170 && b > 170 && g < Math.min(r, b) * 0.72);
}

export function encodeAIThemeCBI1(
  rgba: ArrayLike<number>,
  width = SCREENMASTER_WIDTH,
  height = SCREENMASTER_ART_HEIGHT,
  priorityColors: readonly string[] = [],
): string {
  if (
    width !== SCREENMASTER_WIDTH ||
    height !== SCREENMASTER_ART_HEIGHT ||
    rgba.length !== width * height * 4
  ) {
    throw new Error("Concept art must contain exactly 30,720 pixels.");
  }
  const colors: string[] = [];
  const counts = new Map<string, number>();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const color = quantizedColor(
      rgba[offset] ?? 0,
      rgba[offset + 1] ?? 0,
      rgba[offset + 2] ?? 0,
    );
    colors.push(color);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const reserved = [...new Set(priorityColors)].slice(0, 8);
  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([color]) => !reserved.includes(color));
  const palette = [...reserved];
  // Use representative colors for scene loops, not 18 almost identical sky
  // shades. Weight by frequency while retaining distinct small accents.
  const rgb = (color: string) => color.match(/[0-9A-F]{2}/g)!.map((v) => parseInt(v, 16));
  const candidates = ranked.map(([color, count]) => ({ color, rgb: rgb(color), count }));
  if (reserved.length) {
    while (palette.length < MAX_COLORS && candidates.length) {
      const selected = palette.map(rgb);
      let best = 0, score = -1;
      candidates.forEach((candidate, index) => {
        const distance = Math.min(...selected.map((value) =>
          value.reduce((sum, channel, i) => sum + (channel - candidate.rgb[i]) ** 2, 0)));
        const weighted = distance * Math.sqrt(candidate.count);
        if (weighted > score) { best = index; score = weighted; }
      });
      palette.push(candidates.splice(best, 1)[0].color);
    }
  } else {
    palette.push(...ranked.slice(0, MAX_COLORS).map(([color]) => color));
  }
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const tokens: string[] = [];
    for (let x = 0; x < width; x += 1)
      tokens.push(
        paletteToken(
          nearestColor(colors[y * width + x] || "#000000", palette),
          palette,
        ),
      );
    rows.push(encodeRle(tokens));
  }
  return [
    "CBI1",
    `${width} ${height}`,
    String(palette.length),
    ...palette,
    ...rows,
    "",
  ].join("\n");
}

function quantizedColor(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value / 17) * 17));
  return `#${[channel(r), channel(g), channel(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function nearestColor(color: string, palette: string[]): string {
  if (palette.includes(color)) return color;
  const rgb = color
    .match(/[0-9A-F]{2}/g)
    ?.map((value) => Number.parseInt(value, 16)) || [0, 0, 0];
  return palette.reduce(
    (best, candidate) => {
      const value = candidate
        .match(/[0-9A-F]{2}/g)
        ?.map((part) => Number.parseInt(part, 16)) || [0, 0, 0];
      const distance = value.reduce(
        (sum, channel, index) => sum + (channel - (rgb[index] || 0)) ** 2,
        0,
      );
      return distance < best.distance ? { color: candidate, distance } : best;
    },
    { color: palette[0] || "#000000", distance: Number.POSITIVE_INFINITY },
  ).color;
}

function paletteToken(color: string, palette: string[]): string {
  return String.fromCharCode(97 + Math.max(0, palette.indexOf(color)));
}
function encodeRle(tokens: string[]): string {
  let output = "";
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index] || "A";
    let count = 1;
    while (tokens[index + count] === token) count += 1;
    output += `${count > 1 ? count : ""}${token}`;
    index += count;
  }
  return output;
}

function themeIdForPack(packName: string): string {
  const slug = packName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `ai-${slug || "screenmaster"}`;
}

async function aiRequest<T = unknown>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(companionRequestUrl(path), {
    ...init,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    { error?: { code?: string; stage?: string; reason?: unknown; assessment?: boolean; providerStatus?: unknown; providerCode?: unknown; requestId?: unknown } } | T | null;
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    const code = detail?.code;
    if (path.endsWith("/verify") && detail?.stage === "connection") {
      const clean = (value: unknown, limit: number) => typeof value === "string"
        ? value.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, limit).trim() : "";
      const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !value.includes("sk-") ? value : "";
      const providerStatus = typeof detail.providerStatus === "number" && Number.isInteger(detail.providerStatus) && detail.providerStatus >= 100 && detail.providerStatus <= 599 ? detail.providerStatus : undefined;
      const providerCode = token(detail.providerCode);
      const requestId = token(detail.requestId);
      const reason = clean(detail.reason, 300);
      const message = code === "provider_invalid_response"
        ? "OpenAI returned an unexpected response to the connection check."
        : code === "provider_response_too_large"
          ? "OpenAI returned an oversized response to the connection check."
          : aiErrorMessage(code);
      throw new Error(message + " Connection check." +
        (providerStatus ? ` OpenAI HTTP ${providerStatus}${providerCode ? ` (${providerCode})` : ""}.` : "") +
        (reason ? ` ${reason}` : "") + (requestId ? ` Request: ${requestId}` : ""));
    }
    if (code === "request_invalid" && path.includes("/providers/")) {
      throw new Error(
        "The connection request could not be processed. Please try connecting again.",
      );
    }
    const stages: Record<string, string> = {
      direction: "Scene planning", artwork: "Artwork generation",
      character: "Character generation", region: "Motion area selection",
      frames: "Animation generation",
    };
    const stage = typeof detail?.stage === "string" && Object.hasOwn(stages, detail.stage)
      ? stages[detail.stage] : undefined;
    const reason = stage && code === "animation_quality_failed" && typeof detail?.reason === "string"
      ? detail.reason.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 300).trim()
      : "";
    throw new Error(aiErrorMessage(code) + (stage ? ` Step: ${stage}.` : "") +
      (reason ? ` ${detail?.assessment === true ? "AI assessment" : "Details"}: ${reason}` : ""));
  }
  return payload as T;
}

function aiErrorMessage(code?: string): string {
  switch (code) {
    case "credential_missing":
      return "Add and verify your OpenAI key first.";
    case "credential_verification_required":
    case "credential_changed":
      return "Check your saved OpenAI key before creating with AI.";
    case "credential_invalid":
      return "Paste the complete secret key from your OpenAI account.";
    case "provider_model_unavailable":
      return "OpenAI could not confirm access to the selected image model. The model may be unavailable or not enabled for your project.";
    case "provider_permission_denied":
      return "OpenAI denied permission for this connection check. Check your key and project permissions.";
    case "provider_quota_exhausted":
      return "OpenAI reports a billing or usage limit. Check your account credits and project limits.";
    case "provider_unavailable":
      return "OpenAI could not be reached or could not complete the request. Try again shortly.";
    case "animation_quality_failed":
      return "The animation could not be accepted. Your design is unchanged.";
    case "scene_motion_unsupported":
      return "Try a subtle motion already in the picture: breathing, swaying, flickering light or scrolling on a monitor. New actions and scene changes are not supported yet.";
    case "provider_auth_failed":
      return "OpenAI rejected this key.";
    case "image_generation_unavailable":
      return "This OpenAI account does not have access to image generation.";
    case "provider_rate_limited":
      return "The OpenAI rate limit was reached. Try again later.";
    case "generation_busy":
      return "An AI request is already running. Wait for it to finish, then try again.";
    case "feature_disabled":
      return "AI Theme Builder is not enabled in this build.";
    case "provider_timeout":
      return "OpenAI took too long. Try again.";
    case "provider_response_too_large":
      return "The generated image is too large for VibeTV.";
    case "provider_invalid_response":
      return "OpenAI returned an invalid concept.";
    case "request_too_large":
      return "The previous concept image is too large to refine.";
    case "request_invalid":
      return "The concept request is invalid. Start a new concept and try again.";
    default:
      return "AI Theme Builder could not complete this request.";
  }
}
