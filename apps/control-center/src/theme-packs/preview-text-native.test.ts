import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildFrameData, primitiveUsageSlotVisible, renderTextPrimitive, themeGlyphPlacement, ThemeSpecPreview,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { textInk } from "./text-ink";

// The preview sets the device's bitmap fonts in the system monospace font. Its tallest glyphs must be exactly as tall as
// the device's and stand on the device's baseline, or the preview loses the gap the device keeps between a
// number and the line under it (B4 of the 7216 review: 0.6-2 px in the app against 4-5 px on the device).
const root = path.resolve(process.cwd(), "../..");
const catalogIds: string[] = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/vibetv-theme-packs-v2.json"), "utf8")).themes.map((theme: { id: string }) => theme.id);
const clock = new Date("2026-10-22T12:00:00Z");
// Height of the tallest glyphs of the preview's font in em, as the test environment (no canvas) assumes it; Menlo measures 0.76.
const TALL_GLYPH_HEIGHT = 0.76;

const windows = (usageMode: string, ids: string[]) => ids.map((id, index) => ({
  id, label: id.endsWith("session") ? "Session" : "Weekly", percent: usageMode === "used" ? 6 + index * 17 : 94 - index * 71, resetSecs: 262800,
  pace: index ? { delta: 38, state: "deficit", lasts: false } : { delta: -7, state: "reserve", lasts: true },
}));
const frames = {
  one: buildFrameData(clock.toISOString(), { provider: "claude", label: "Claude", usageMode: "remaining", usageWindows: windows("remaining", ["claude:session", "claude:weekly"]) }, clock),
  two: buildFrameData(clock.toISOString(), { provider: "claude+codex", label: "", usageMode: "remaining", usageWindows: windows("remaining", ["claude:weekly", "codex:weekly"]) }, clock),
};

// Rows of the TFT_eSPI 2.5.43 glyphs at size 1, measured with the firmware's own rasteriser: how many rows the tallest
// glyphs (capitals, digits, ascenders) cover and the row they stand on.
describe("themeGlyphPlacement", () => {
  it.each([[1, 7, 7], [2, 10, 13], [4, 18, 19]])("puts the font %i tallest glyphs on the device's rows at every size and in every system font", (font, tallRows, baselineRow) => {
    for (const size of [1, 2, 3, 4]) {
      for (const tallHeight of [0.64, 0.72, TALL_GLYPH_HEIGHT]) {
        const glyph = themeGlyphPlacement(font, size, tallHeight)!;
        expect(glyph.baseline).toBe(baselineRow * size);
        expect(glyph.baseline - glyph.fontSize * tallHeight).toBeCloseTo((baselineRow - tallRows) * size, 6);
      }
    }
  });

  it("leaves the fonts the device does not draw from tables alone", () => {
    expect(themeGlyphPlacement(6, 1, TALL_GLYPH_HEIGHT)).toBeNull();
  });
});

describe.each(catalogIds)("%s preview text against the device", (themeId) => {
  it.each(Object.entries(frames))("stands on the device's baseline and reaches its top line within 1 px (%s provider)", (_mode, frame) => {
    const pack = JSON.parse(readFileSync(path.join(root, `dist/theme-packs/render/${themeId}.json`), "utf8")) as ThemeRenderPack;
    const texts = (pack.spec!.p ?? []).filter((p) => p.t === "tx" && primitiveUsageSlotVisible(p, frame) && [2, 4].includes(p.f ?? 1));
    for (const p of texts as ThemePrimitive[]) {
      const text = renderTextPrimitive(p, frame);
      if (!text.trim()) continue;
      const native = textInk(p, text);
      const svg = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack: { ...pack, spec: { ...pack.spec!, p: [p] } }, themeId, status: "ready", animate: false, frame }));
      const placed = [...svg.matchAll(/<text\b[^>]*?font-size="([\d.]+)"[^>]*?\sy="([\d.]+)"/g)].map((m) => ({ fontSize: Number(m[1]), baseline: Number(m[2]) }));
      if (!placed.length) continue;
      // Ink rows of the preview: the top line of its tallest glyphs, and the baseline (descenders hang below it).
      if (!/[gjpqy,;()[\]{}|]/.test(text)) {
        expect(Math.abs(placed.at(-1)!.baseline - (native.y + native.h)), `${text} baseline`).toBeLessThanOrEqual(1);
      }
      if (/[^aceimnorsuvwxz ]/.test(text)) {
        expect(Math.abs(placed[0].baseline - placed[0].fontSize * TALL_GLYPH_HEIGHT - native.y), `${text} top line`).toBeLessThanOrEqual(1);
      }
    }
  });
});
