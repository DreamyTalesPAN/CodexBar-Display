import { describe, expect, it } from "vitest";
import { createBlankThemeSpec, validateThemeSpec, type ThemeStudioPrimitive } from "@/lib/theme-studio";
import { AI_THEME_SCREENMASTER_ASSET_PATH } from "@/lib/ai-theme";
import { createDesignElement, LIVE_READINGS, moveLayer, readingKey, setReading, swapRowPositions, usageSectionIndices } from "./design-controls";

const text = (value: string, y: number): ThemeStudioPrimitive => ({ type: "text", x: 12, y, text: value, fontSize: 1 });

describe("design element catalog", () => {
  it.each(["text", "progress", "rect", "time", "reset", "session", "weekly", "usageMode", "reading"] as const)("adds a valid %s", (type) => {
    const p = createDesignElement(type, 2);
    expect(validateThemeSpec({ ...createBlankThemeSpec(), primitives: [p] }).errors).toEqual([]);
  });
  it.each(LIVE_READINGS)("supports the %s live reading", (key, _label, template) => {
    const p = { ...text("Old", 20), binding: "weekly", slot: 2 as const, providerSlot: 2 as const, usageIndex: 7 };
    setReading(p, key);
    expect(p.text).toBe(template);
    expect(readingKey(p)).toBe(key);
    expect(p.binding).toBeUndefined();
    expect(p.usageIndex).toBeUndefined();
    expect(validateThemeSpec({ ...createBlankThemeSpec(), primitives: [p] }).errors).toEqual([]);
  });
});

describe("position and layer ordering", () => {
  it("moves generated usage labels, bars and direction together, leaving artwork alone", () => {
    const all: ThemeStudioPrimitive[] = [
      { type: "rect", x: 0, y: 128, width: 240, height: 112 },
      text("SESSION", 134), text("{session}%", 134), { type: "progress", x: 12, y: 154, width: 216, height: 13, binding: "session" }, text("{usageMode}", 170),
      text("WEEKLY", 184), text("{weekly}%", 184), { type: "progress", x: 12, y: 204, width: 216, height: 13, binding: "weekly" }, text("{usageMode}", 220), text("My note", 140),
    ];
    const groups = usageSectionIndices(all);
    expect(groups.map((group) => [...group].sort())).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    expect(swapRowPositions(all, groups[0], groups[1])).toBe(true);
    expect(all.map((p) => p.y)).toEqual([128, 184, 184, 204, 220, 134, 134, 154, 170, 140]);
    expect(swapRowPositions(all, groups[0], groups[1])).toBe(true);
    expect(all[1].y).toBe(134);
  });
  it("rejects off-display swaps without partially moving a group", () => {
    const all = [text("a", 10), text("b", 30), text("c", 230)];
    const before = structuredClone(all);
    expect(swapRowPositions(all, [0, 1], [2])).toBe(false);
    expect(all).toEqual(before);
  });
  it("changes layer order without changing positions", () => {
    const all = [text("a", 10), text("b", 20), text("c", 30)];
    expect(moveLayer(all, 0, 2)).toBe(true);
    expect(all.map((p) => [p.text, p.y])).toEqual([["b", 20], ["c", 30], ["a", 10]]);
  });
  it("keeps attached scene artwork pinned", () => {
    const all: ThemeStudioPrimitive[] = [
      { type: "sprite", x: 0, y: 0, width: 240, height: 128, assetPath: AI_THEME_SCREENMASTER_ASSET_PATH },
      { type: "sprite", x: 10, y: 10, width: 32, height: 32, assetPath: "/themes/u/ai-scene-loop.cba" },
      text("note", 150),
    ];
    expect(moveLayer(all, 2, 0)).toBe(false);
    expect(swapRowPositions(all, [0], [2])).toBe(false);
    expect(swapRowPositions(all, [1], [2])).toBe(false);
  });
});
