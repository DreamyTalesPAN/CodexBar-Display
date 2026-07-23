import { companionRequestUrl } from "@/components/control-center-runtime";
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
  animationMode: "four_frame" | "static";
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
  assets: Record<string, ThemeStudioAsset>;
  notes: string;
  packName: string;
  spec: ThemeStudioSpec;
};
export type AIThemeSession = {
  candidate: AIThemeCandidate;
  concept: AIThemeConcept;
};
export type AIThemeCapabilities = {
  enabled: boolean;
  providers: Array<{ configured: boolean; id: AIThemeProviderId }>;
};

const HISTORY_PREFIX = "vibetv.aiTheme.history.v1.";
export const AI_THEME_SCREENMASTER_ASSET_PATH = "/themes/u/ai-screen.cbi";
export const AI_THEME_ANIMATION_ASSET_PATH = "/themes/u/ai-animation.cba";
const SCREENMASTER_WIDTH = 240;
const SCREENMASTER_ART_HEIGHT = 128;
const ANIMATION_FRAME_SIZE = 72;
const ANIMATION_FRAME_COUNT = 4;
const ANIMATION_CONTENT_SIZE = 68;
const MAX_COLORS = 26;
export const AI_THEME_LOCAL_HISTORY_LIMIT = 20;
export const AI_THEME_TRANSMITTED_HISTORY_LIMIT = 10;

export async function fetchAIThemeCapabilities(signal?: AbortSignal): Promise<AIThemeCapabilities> {
  return aiRequest<AIThemeCapabilities>("/v1/ai-theme/capabilities", { method: "GET", signal });
}

export async function saveAIThemeCredential(provider: AIThemeProviderId, apiKey: string): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/credential`, {
    body: JSON.stringify({ apiKey }), headers: { "Content-Type": "application/json" }, method: "PUT",
  });
}

export async function deleteAIThemeCredential(provider: AIThemeProviderId): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/credential`, { method: "DELETE" });
}

export async function verifyAIThemeCredential(provider: AIThemeProviderId): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/verify`, { method: "POST" });
}

export async function generateAIThemeConcept(
  input: { history: AIThemeMessage[]; previous?: AIThemeConcept; prompt: string },
  signal?: AbortSignal,
): Promise<AIThemeConcept> {
  return aiRequest<AIThemeConcept>("/v1/ai-theme/concepts", {
    body: JSON.stringify({
      prompt: input.prompt,
      history: input.history.slice(-AI_THEME_TRANSMITTED_HISTORY_LIMIT).map(({ content, role }) => ({ content, role })),
      previous: input.previous ? {
        animationSheetBase64: input.previous.animation?.spriteSheetBase64,
        imageBase64: input.previous.imageBase64,
        imageContentType: input.previous.imageContentType,
        style: input.previous.style,
      } : undefined,
    }),
    headers: { "Content-Type": "application/json" }, method: "POST", signal,
  });
}

export async function buildAIThemeCandidate(concept: AIThemeConcept): Promise<AIThemeCandidate> {
  const encodedFrames = [
    concept.imageBase64,
    ...(concept.animation ? [concept.animation.spriteSheetBase64] : []),
  ];
  if (concept.animation && !concept.animation.spriteSheetBase64) {
    throw new Error("Animated concepts must contain a sprite sheet.");
  }
  const bitmaps = await Promise.all(encodedFrames.map((value) => conceptBitmap(value, concept.imageContentType)));
  try {
    if (concept.animation) {
      const background = bitmapRGBA(bitmaps[0]!, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT);
      const frames = normalizeAnimationSpriteSheet(bitmaps[1]!, concept.animation.keyColor);
      return buildAIThemeAnimationCandidateFromRGBA(concept, background, frames, concept.animation.fps);
    }
    const rgba = bitmapRGBA(bitmaps[0]!, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT);
    return buildAIThemeCandidateFromRGBA(concept, rgba);
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
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
  return buildCandidate(concept, { [AI_THEME_SCREENMASTER_ASSET_PATH]: asset }, [{
    type: "sprite", x: 0, y: 0, width: 240, height: 128, assetPath: AI_THEME_SCREENMASTER_ASSET_PATH,
  }]);
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
    data: encodeAIThemeCBI1(background, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT),
    encoding: "text",
  };
  const compositedFrames = compositeAnimationFramesOverBackground(background, frames);
  const animationAsset: ThemeStudioAsset = {
    contentType: "text/plain",
    data: encodeAIThemeCBA1(compositedFrames, ANIMATION_FRAME_SIZE, ANIMATION_FRAME_SIZE, fps),
    encoding: "text",
  };
  return buildCandidate(concept, {
    [AI_THEME_SCREENMASTER_ASSET_PATH]: backgroundAsset,
    [AI_THEME_ANIMATION_ASSET_PATH]: animationAsset,
  }, [
    { type: "sprite", x: 0, y: 0, width: 240, height: 128, assetPath: AI_THEME_SCREENMASTER_ASSET_PATH },
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
  ]);
}

function compositeAnimationFramesOverBackground(
  background: ArrayLike<number>,
  frames: ArrayLike<number>[],
): Uint8ClampedArray[] {
  if (background.length !== SCREENMASTER_WIDTH * SCREENMASTER_ART_HEIGHT * 4) {
    throw new Error("Animated concept background must contain exactly 30,720 pixels.");
  }
  const left = Math.round((SCREENMASTER_WIDTH - ANIMATION_FRAME_SIZE) / 2);
  const top = Math.round((SCREENMASTER_ART_HEIGHT - ANIMATION_FRAME_SIZE) / 2);
  return frames.map((frame) => {
    const composited = new Uint8ClampedArray(frame);
    for (let y = 0; y < ANIMATION_FRAME_SIZE; y += 1) {
      for (let x = 0; x < ANIMATION_FRAME_SIZE; x += 1) {
        const frameOffset = (y * ANIMATION_FRAME_SIZE + x) * 4;
        const backgroundOffset = ((top + y) * SCREENMASTER_WIDTH + left + x) * 4;
        const alpha = (composited[frameOffset + 3] ?? 0) / 255;
        for (let channel = 0; channel < 3; channel += 1) {
          composited[frameOffset + channel] = Math.round(
            (composited[frameOffset + channel] ?? 0) * alpha +
              (background[backgroundOffset + channel] ?? 0) * (1 - alpha),
          );
        }
        composited[frameOffset + 3] = 255;
      }
    }
    return composited;
  });
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
      { type: "rect", x: 0, y: 128, width: 240, height: 112, color: style.panelColor, bgColor: style.panelColor, borderColor: style.panelColor, borderRadius: 0 },
      { type: "text", x: 12, y: 134, text: "SESSION", fontSize: 2, color: style.textColor },
      { type: "text", x: 152, y: 134, width: 76, text: "{session}%", align: "right", fontSize: 2, color: style.sessionColor },
      { type: "progress", x: 12, y: 154, width: 216, height: 13, binding: "session", color: style.sessionColor, bgColor: style.backgroundColor, borderColor: style.sessionColor, borderRadius: style.borderRadius, progressStyle: style.progressStyle, segments: style.progressStyle === "segments" ? 10 : undefined, segmentGap: style.progressStyle === "segments" ? 2 : undefined },
      { type: "text", x: 12, y: 170, text: "REMAINING", fontSize: 1, color: style.textColor },
      { type: "text", x: 12, y: 184, text: "WEEKLY", fontSize: 2, color: style.textColor },
      { type: "text", x: 152, y: 184, width: 76, text: "{weekly}%", align: "right", fontSize: 2, color: style.weeklyColor },
      { type: "progress", x: 12, y: 204, width: 216, height: 13, binding: "weekly", color: style.weeklyColor, bgColor: style.backgroundColor, borderColor: style.weeklyColor, borderRadius: style.borderRadius, progressStyle: style.progressStyle, segments: style.progressStyle === "segments" ? 10 : undefined, segmentGap: style.progressStyle === "segments" ? 2 : undefined },
      { type: "text", x: 12, y: 220, text: "REMAINING", fontSize: 1, color: style.textColor },
    ],
  };
  const validation = validateThemeSpec(spec, assets);
  if (validation.errors.length > 0) throw new Error(validation.errors[0]);
  return { assets, notes: style.notes, packName: style.packName, spec };
}

export function encodeAIThemeCBA1(
  frames: ArrayLike<number>[],
  width = ANIMATION_FRAME_SIZE,
  height = ANIMATION_FRAME_SIZE,
  fps = 4,
): string {
  if (frames.length !== ANIMATION_FRAME_COUNT || width !== ANIMATION_FRAME_SIZE || height !== ANIMATION_FRAME_SIZE || !Number.isInteger(fps) || fps < 1 || fps > 30 || frames.some((frame) => frame.length !== width * height * 4)) {
    throw new Error("Animation must contain exactly four 72x72 RGBA frames.");
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
      const color = quantizedColor(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
      frameColors.push(color);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    colors.push(frameColors);
  }
  const palette = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, MAX_COLORS).map(([color]) => color);
  if (palette.length === 0) palette.push("#FFFFFF");
  const rows = colors.flatMap((frame) => Array.from({ length: height }, (_, y) => {
    const tokens = Array.from({ length: width }, (_, x) => {
      const color = frame[y * width + x];
      return color ? paletteToken(nearestColor(color, palette), palette) : ".";
    });
    return encodeRle(tokens);
  }));
  return ["CBA1", `${width} ${height} ${frames.length} ${fps}`, String(palette.length), ...palette, ...rows, ""].join("\n");
}

async function conceptBitmap(value: string, contentType: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: contentType }));
}

function bitmapRGBA(bitmap: ImageBitmap, width: number, height: number): Uint8ClampedArray {
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

function normalizeAnimationSpriteSheet(bitmap: ImageBitmap, keyColor: string): Uint8ClampedArray[] {
  const cellWidths = Array.from({ length: ANIMATION_FRAME_COUNT }, (_, frame) =>
    Math.max(1, Math.round(((frame + 1) * bitmap.width) / ANIMATION_FRAME_COUNT) - Math.round((frame * bitmap.width) / ANIMATION_FRAME_COUNT)),
  );
  const sourceSize = Math.max(1, Math.min(bitmap.height, ...cellWidths));
  const sourceFrames = Array.from({ length: ANIMATION_FRAME_COUNT }, (_, frame) => {
    const cellLeft = Math.round((frame * bitmap.width) / ANIMATION_FRAME_COUNT);
    const cellWidth = cellWidths[frame]!;
    const sourceX = Math.max(0, Math.min(bitmap.width - sourceSize, cellLeft + Math.round((cellWidth - sourceSize) / 2)));
    const sourceY = Math.max(0, Math.round((bitmap.height - sourceSize) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = sourceSize;
    canvas.height = sourceSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The animation sprite sheet could not be prepared.");
    context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, sourceSize, sourceSize);
    return { canvas, image: context.getImageData(0, 0, sourceSize, sourceSize) };
  });
  const key = hexRGB(keyColor);
  const bounds = sourceFrames.reduce((current, frame) => {
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
  }, { bottom: -1, left: sourceSize, right: -1, top: sourceSize });
  if (bounds.right < bounds.left || bounds.bottom < bounds.top) {
    throw new Error("OpenAI returned an empty animation sprite sheet.");
  }
  const padding = Math.max(1, Math.round(sourceSize * 0.015));
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const cropWidth = Math.min(sourceSize - left, bounds.right - bounds.left + 1 + padding * 2);
  const cropHeight = Math.min(sourceSize - top, bounds.bottom - bounds.top + 1 + padding * 2);
  const scale = Math.min(ANIMATION_CONTENT_SIZE / cropWidth, ANIMATION_CONTENT_SIZE / cropHeight);
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
    context.drawImage(frame.canvas, left, top, cropWidth, cropHeight, Math.round((ANIMATION_FRAME_SIZE - targetWidth) / 2), Math.round((ANIMATION_FRAME_SIZE - targetHeight) / 2), targetWidth, targetHeight);
    const normalized = context.getImageData(0, 0, ANIMATION_FRAME_SIZE, ANIMATION_FRAME_SIZE);
    for (let offset = 0; offset < normalized.data.length; offset += 4) {
      if (isKeyPixel(normalized.data, offset, key)) normalized.data[offset + 3] = 0;
    }
    return normalized.data;
  });
}

function hexRGB(value: string): [number, number, number] {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(value);
  if (!match) throw new Error("The animation key color is invalid.");
  return [Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16), Number.parseInt(match[3]!, 16)];
}

function isKeyPixel(data: ArrayLike<number>, offset: number, key: [number, number, number]): boolean {
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  const distance = Math.sqrt((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2);
  return distance < 105 || (r > 170 && b > 170 && g < Math.min(r, b) * 0.72);
}

export function encodeAIThemeCBI1(
  rgba: ArrayLike<number>,
  width = SCREENMASTER_WIDTH,
  height = SCREENMASTER_ART_HEIGHT,
): string {
  if (width !== SCREENMASTER_WIDTH || height !== SCREENMASTER_ART_HEIGHT || rgba.length !== width * height * 4) {
    throw new Error("Concept art must contain exactly 30,720 pixels.");
  }
  const colors: string[] = [];
  const counts = new Map<string, number>();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const color = quantizedColor(rgba[offset] ?? 0, rgba[offset + 1] ?? 0, rgba[offset + 2] ?? 0);
    colors.push(color); counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const palette = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, MAX_COLORS).map(([color]) => color);
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const tokens: string[] = [];
    for (let x = 0; x < width; x += 1) tokens.push(paletteToken(nearestColor(colors[y * width + x] || "#000000", palette), palette));
    rows.push(encodeRle(tokens));
  }
  return ["CBI1", `${width} ${height}`, String(palette.length), ...palette, ...rows, ""].join("\n");
}

function quantizedColor(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value / 17) * 17));
  return `#${[channel(r), channel(g), channel(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function nearestColor(color: string, palette: string[]): string {
  if (palette.includes(color)) return color;
  const rgb = color.match(/[0-9A-F]{2}/g)?.map((value) => Number.parseInt(value, 16)) || [0, 0, 0];
  return palette.reduce((best, candidate) => {
    const value = candidate.match(/[0-9A-F]{2}/g)?.map((part) => Number.parseInt(part, 16)) || [0, 0, 0];
    const distance = value.reduce((sum, channel, index) => sum + (channel - (rgb[index] || 0)) ** 2, 0);
    return distance < best.distance ? { color: candidate, distance } : best;
  }, { color: palette[0] || "#000000", distance: Number.POSITIVE_INFINITY }).color;
}

function paletteToken(color: string, palette: string[]): string { return String.fromCharCode(97 + Math.max(0, palette.indexOf(color))); }
function encodeRle(tokens: string[]): string {
  let output = "";
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index] || "A"; let count = 1;
    while (tokens[index + count] === token) count += 1;
    output += `${count > 1 ? count : ""}${token}`; index += count;
  }
  return output;
}

function themeIdForPack(packName: string): string {
  const slug = packName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `ai-${slug || "screenmaster"}`;
}

export function loadAIThemeHistory(themeId: string, storage: Pick<Storage, "getItem"> | null = browserStorage()): AIThemeMessage[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(historyKey(themeId)) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is AIThemeMessage => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && typeof item.createdAt === "string").slice(-AI_THEME_LOCAL_HISTORY_LIMIT);
  } catch { return []; }
}

export function saveAIThemeHistory(themeId: string, history: AIThemeMessage[], storage: Pick<Storage, "setItem"> | null = browserStorage()): void {
  if (!storage) return;
  const sanitized = history.map((message) => ({ content: message.content.slice(0, 2000), createdAt: message.createdAt, role: message.role })).slice(-AI_THEME_LOCAL_HISTORY_LIMIT);
  storage.setItem(historyKey(themeId), JSON.stringify(sanitized));
}

export function clearAIThemeHistory(themeId: string, storage: Pick<Storage, "removeItem"> | null = browserStorage()): void {
  storage?.removeItem(historyKey(themeId));
}

function historyKey(themeId: string): string { return `${HISTORY_PREFIX}${themeId.replace(/[^a-z0-9_-]/gi, "_")}`; }
function browserStorage(): Storage | null { return typeof window === "undefined" ? null : window.localStorage; }

async function aiRequest<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(companionRequestUrl(path), init);
  const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | T | null;
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload ? payload.error?.code : undefined;
    throw new Error(aiErrorMessage(code));
  }
  return payload as T;
}

function aiErrorMessage(code?: string): string {
  switch (code) {
    case "credential_missing": return "Add and verify your OpenAI key first.";
    case "provider_auth_failed": return "OpenAI rejected this key.";
    case "image_generation_unavailable": return "This OpenAI account does not have access to image generation.";
    case "provider_rate_limited": return "The OpenAI rate limit was reached. Try again later.";
    case "rate_limited_or_busy": return "One concept is already running or the local limit was reached.";
    case "feature_disabled": return "AI Theme Builder is not enabled in this build.";
    case "provider_timeout": return "OpenAI took too long. Try again.";
    case "provider_response_too_large": return "The generated image is too large for VibeTV.";
    case "provider_invalid_response": return "OpenAI returned an invalid concept.";
    case "request_too_large": return "The previous concept image is too large to refine.";
    case "request_invalid": return "The concept request is invalid. Start a new concept and try again.";
    default: return "AI Theme Builder could not complete this request.";
  }
}
