import { companionOrigin } from "@/components/control-center-runtime";
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
  artPrompt: string;
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
const SCREENMASTER_WIDTH = 240;
const SCREENMASTER_ART_HEIGHT = 128;
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
      previous: input.previous,
    }),
    headers: { "Content-Type": "application/json" }, method: "POST", signal,
  });
}

export async function buildAIThemeCandidate(concept: AIThemeConcept): Promise<AIThemeCandidate> {
  const bytes = Uint8Array.from(atob(concept.imageBase64), (value) => value.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: concept.imageContentType }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SCREENMASTER_WIDTH;
    canvas.height = SCREENMASTER_ART_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The concept image could not be prepared.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT);
    const rgba = context.getImageData(0, 0, SCREENMASTER_WIDTH, SCREENMASTER_ART_HEIGHT).data;
    return buildAIThemeCandidateFromRGBA(concept, rgba);
  } finally {
    bitmap.close();
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
  const style = concept.style;
  const spec: ThemeStudioSpec = {
    themeSpecVersion: 1,
    themeId: themeIdForPack(style.packName),
    themeRev: 1,
    bgColor: style.backgroundColor,
    primitives: [
      { type: "sprite", x: 0, y: 0, width: 240, height: 128, assetPath: AI_THEME_SCREENMASTER_ASSET_PATH },
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
  const assets = { [AI_THEME_SCREENMASTER_ASSET_PATH]: asset };
  const validation = validateThemeSpec(spec, assets);
  if (validation.errors.length > 0) throw new Error(validation.errors[0]);
  return { assets, notes: style.notes, packName: style.packName, spec };
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
  const response = await fetch(`${companionOrigin()}${path}`, init);
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
