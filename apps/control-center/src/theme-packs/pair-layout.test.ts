import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildFrameData, ThemeSpecPreview, primitiveUsageSlotVisible, renderTextPrimitive,
  themeFirmwareTextMetrics, themeTextFittedSize, themeTextAlignedY, themeTextValignBoxHeight,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";

const root = path.resolve(process.cwd(), "../..");
const themes = ["clippy", "pixel-battery", "synthwave", "tiny-office", "gauge", "pace-meter", "claude-creature", "mini-classic"];
const clock = new Date("2026-10-21T12:00:00Z");

function textBox(p: ThemePrimitive, text: string) {
  const font = p.f ?? 1, maxSize = p.s ?? 1, lane = p.w ?? 0;
  const size = themeTextFittedSize(text, font, maxSize, lane, p.ft === "shrink");
  const height = (font === 4 ? 26 : font === 2 ? 16 : 8) * size;
  const width = themeFirmwareTextMetrics(text, font, size)?.width ?? text.length * height * 0.6;
  expect(width, `${text} must fit its lane`).toBeLessThanOrEqual(lane || 240 - (p.x ?? 0));
  const x = (p.x ?? 0) + (p.al === "right" ? lane - width : p.al === "center" ? (lane - width) / 2 : 0);
  const y = themeTextAlignedY(p.y ?? 0, themeTextValignBoxHeight(p.h ?? 0, font, maxSize), height, p.va);
  return { text, x, y, right: x + width, bottom: y + height };
}

describe.each(themes)("%s Two at once", (themeId) => {
  it.each(["used", "remaining"])("shows the full labels, %s header and disjoint text at 96/59 percent", (usageMode) => {
    const pack = JSON.parse(readFileSync(path.join(root, `dist/theme-packs/render/${themeId}.json`), "utf8")) as ThemeRenderPack;
    const frame = buildFrameData(clock.toISOString(), {
      provider: "claude+codex", label: "", usageMode,
      usageWindows: [
        { id: "claude:weekly", label: "Claude Weekly", percent: usageMode === "used" ? 96 : 4, resetSecs: 262800, pace: { delta: 40, state: "deficit", lasts: false } },
        { id: "codex:weekly", label: "Codex Weekly", percent: usageMode === "used" ? 59 : 41, resetSecs: 586800, pace: { delta: -6, state: "reserve", lasts: true } },
      ],
    }, clock);
    const svg = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId, status: "ready", animate: false, frame }));
    const text = svg.replace(/<[^>]*>/g, "");
    expect(text).toContain("Claude Weekly");
    expect(text).toContain("Codex Weekly");
    expect(text.startsWith(usageMode)).toBe(true);
    const boxes = (pack.spec!.p ?? []).filter((p) => p.t === "tx" && primitiveUsageSlotVisible(p, frame))
      .map((p) => textBox(p, renderTextPrimitive(p, frame))).filter((b) => b.text.trim());
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.right).toBeLessThanOrEqual(240);
      expect(a.bottom).toBeLessThanOrEqual(240);
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
        expect(overlap, `${a.text} overlaps ${b.text}`).toBe(false);
      }
    }
  });
});
