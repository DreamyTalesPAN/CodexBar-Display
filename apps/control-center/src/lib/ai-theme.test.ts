import { describe, expect, it } from "vitest";
import {
  AI_THEME_LOCAL_HISTORY_LIMIT,
  AI_THEME_ANIMATION_ASSET_PATH,
  AI_THEME_SCREENMASTER_ASSET_PATH,
  buildAIThemeAnimationCandidateFromRGBA,
  buildAIThemeCandidateFromRGBA,
  clearAIThemeHistory,
  encodeAIThemeCBI1,
  encodeAIThemeCBA1,
  loadAIThemeHistory,
  saveAIThemeHistory,
  type AIThemeMessage,
} from "./ai-theme";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("AI theme history", () => {
  it("keeps only 20 non-secret chat messages per theme", () => {
    const storage = new MemoryStorage();
    const history: AIThemeMessage[] = Array.from({ length: 24 }, (_, index) => ({
      content: `message-${index}`,
      createdAt: new Date(index * 1000).toISOString(),
      role: index % 2 ? "assistant" : "user",
    }));
    saveAIThemeHistory("theme-a", history, storage);
    expect(loadAIThemeHistory("theme-a", storage)).toHaveLength(
      AI_THEME_LOCAL_HISTORY_LIMIT,
    );
    expect([...storage.values.values()].join(" ")).not.toContain("apiKey");
  });

  it("isolates history by theme id", () => {
    const storage = new MemoryStorage();
    saveAIThemeHistory("one", [{ content: "one", createdAt: "now", role: "user" }], storage);
    expect(loadAIThemeHistory("two", storage)).toEqual([]);
  });

  it("clears local history for a fresh AI draft", () => {
    const storage = new MemoryStorage();
    saveAIThemeHistory("one", [{ content: "old cat prompt", createdAt: "now", role: "user" }], storage);
    clearAIThemeHistory("one", storage);
    expect(loadAIThemeHistory("one", storage)).toEqual([]);
  });

  it("converts exactly 30,720 pixels into a maximum 26-color CBI1 screenmaster", () => {
    const rgba = new Uint8ClampedArray(240 * 128 * 4);
    for (let pixel = 0; pixel < 240 * 128; pixel += 1) {
      rgba[pixel * 4] = pixel % 256;
      rgba[pixel * 4 + 1] = (pixel * 3) % 256;
      rgba[pixel * 4 + 2] = (pixel * 7) % 256;
      rgba[pixel * 4 + 3] = 255;
    }
    const encoded = encodeAIThemeCBI1(rgba);
    const lines = encoded.split("\n");
    expect(lines[0]).toBe("CBI1");
    expect(lines[1]).toBe("240 128");
    const paletteSize = Number(lines[2]);
    expect(paletteSize).toBeLessThanOrEqual(26);
    expect(lines.slice(3 + paletteSize, 3 + paletteSize + 128)).toHaveLength(128);
    expect(lines.slice(3 + paletteSize, 3 + paletteSize + 128).every((row) => /^[0-9a-z.]+$/.test(row))).toBe(true);
  });

  it("builds both Remaining bars and percentage labels without changing the concept", () => {
    const imageBase64 = "not-persisted-image";
    const candidate = buildAIThemeCandidateFromRGBA({
      imageBase64,
      imageContentType: "image/png",
      style: {
        animationMode: "static", animationPrompt: "", artPrompt: "A large cat.", environmentPrompt: "A moonlit clearing.", backgroundColor: "#081426", borderRadius: 3,
        notes: "Moon cat", packName: "Moon Cat", panelColor: "#101F36",
        progressStyle: "segments", sessionColor: "#F6B85F", textColor: "#FFF3CF",
        title: "CAT MODE", weeklyColor: "#EF6A8A",
      },
    }, new Uint8ClampedArray(240 * 128 * 4));
    expect(candidate.spec.primitives.filter((item) => item.type === "progress").map((item) => item.binding)).toEqual(["session", "weekly"]);
    expect(candidate.spec.primitives.filter((item) => item.type === "text").map((item) => item.text)).toContain("{session}%");
    expect(candidate.spec.primitives.filter((item) => item.type === "text").map((item) => item.text)).toContain("{weekly}%");
    expect(candidate.spec.primitives.filter((item) => item.type === "text").map((item) => item.text)).not.toContain("CAT MODE");
    expect(Object.values(candidate.assets)[0]?.data.startsWith("CBI1\n240 128\n")).toBe(true);
    expect(JSON.stringify(candidate)).not.toContain(imageBase64);
  });

  it("creates an editable CBA1 sprite with exactly four 72x72 frames", () => {
    const frames = Array.from({ length: 4 }, (_, frame) => {
      const rgba = new Uint8ClampedArray(72 * 72 * 4);
      const offset = ((28 + frame) * 72 + 34) * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 128;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 255;
      return rgba;
    });
    const background = new Uint8ClampedArray(240 * 128 * 4);
    background.fill(255);
    const concept = {
      animation: { spriteSheetBase64: "four-frame-sheet", fps: 4, keyColor: "#FF00FF" },
      imageBase64: "background",
      imageContentType: "image/png" as const,
      style: {
        animationMode: "four_frame" as const,
        animationPrompt: "The cat swishes its tail.",
        artPrompt: "A large orange cat.",
        environmentPrompt: "A moonlit clearing with no animals.",
        backgroundColor: "#081426",
        borderRadius: 3,
        notes: "Moon cat",
        packName: "Moon Cat",
        panelColor: "#101F36",
        progressStyle: "segments" as const,
        sessionColor: "#F6B85F",
        textColor: "#FFF3CF",
        title: "CAT MODE",
        weeklyColor: "#EF6A8A",
      },
    };
    const encoded = encodeAIThemeCBA1(frames);
    expect(encoded).toMatch(/^CBA1\n72 72 4 4\n/);
    expect(encoded.split("\n").filter((line) => line.includes(".")).length).toBeGreaterThan(0);
    const candidate = buildAIThemeAnimationCandidateFromRGBA(concept, background, frames);
    expect(candidate.assets[AI_THEME_ANIMATION_ASSET_PATH]?.data).toMatch(/^CBA1\n72 72 4 4\n/);
    expect(candidate.assets[AI_THEME_ANIMATION_ASSET_PATH]?.data).toBe(encoded);
    expect(candidate.assets[AI_THEME_SCREENMASTER_ASSET_PATH]?.data.startsWith("CBI1\n240 128\n")).toBe(true);
    expect(candidate.spec.primitives[0]).toMatchObject({
      assetPath: AI_THEME_SCREENMASTER_ASSET_PATH,
      height: 128,
      type: "sprite",
      width: 240,
    });
    expect(candidate.spec.primitives[1]).toMatchObject({
      assetPath: AI_THEME_ANIMATION_ASSET_PATH,
      fps: 4,
      frameCount: 4,
      height: 72,
      sheetColumns: 4,
      type: "sprite",
      width: 72,
      x: 84,
      y: 28,
    });
  });
});
