import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildFrameData, ThemeSpecPreview, primitiveUsageSlotVisible, renderTextPrimitive,
  themeTextFit, type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { textInk } from "./text-ink";

const root = path.resolve(process.cwd(), "../..");
const themes = ["clippy", "pixel-battery", "synthwave", "tiny-office", "gauge", "pace-meter", "claude-creature", "mini-classic"];
const clock = new Date("2026-10-21T12:00:00Z");

// What the text paints (ink rows, not the whole glyph cell): a pace text may sit in the empty rows under a number.
function textBox(p: ThemePrimitive, text: string) {
  const ink = textInk(p, text);
  expect(ink.w, `${text} must fit its lane`).toBeLessThanOrEqual(p.w || 240 - (p.x ?? 0));
  return { text, x: ink.x, y: ink.y, right: ink.x + ink.w, bottom: ink.y + ink.h };
}

describe.each(themes)("%s Two at once", (themeId) => {
  it.each([["used", "Claude Weekly"], ["remaining", "Claude Weekly"], ["used", "Claude Weekly (Sonnet)"], ["remaining", "Claude Weekly (Sonnet)"]])("shows full %s labels (%s) and disjoint text at 96/59 percent", (usageMode, label) => {
    const pack = JSON.parse(readFileSync(path.join(root, `dist/theme-packs/render/${themeId}.json`), "utf8")) as ThemeRenderPack;
    const frame = buildFrameData(clock.toISOString(), {
      provider: "claude+codex", label: "", usageMode,
      usageWindows: [
        { id: "claude:weekly", label, percent: usageMode === "used" ? 96 : 4, resetSecs: 262800, pace: { delta: 40, state: "deficit", lasts: false } },
        { id: "codex:weekly", label: "Codex Weekly", percent: usageMode === "used" ? 59 : 41, resetSecs: 586800, pace: { delta: -6, state: "reserve", lasts: true } },
      ],
    }, clock);
    const svg = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId, status: "ready", animate: false, frame }));
    const text = svg.replace(/<[^>]*>/g, "");
    expect(text.replaceAll(" ", "")).toContain(label.replaceAll(" ", ""));
    expect(text).toContain("Codex Weekly");
    expect(text.startsWith(usageMode)).toBe(true);
    expect(text.match(new RegExp(usageMode, "g"))).toHaveLength(1);
    const unavailable = { ...frame, usageSlot1Available: false,
      usageWindows: frame.usageWindows.map((window, index) => index === 0 ? { ...window, available: false } : window) };
    const unavailableText = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId, status: "ready", animate: false, frame: unavailable })).replace(/<[^>]*>/g, "");
    expect(unavailableText.replaceAll(" ", "")).toContain(label.replaceAll(" ", ""));
    expect(unavailableText).toContain("--");
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

describe("wording of the usage mode and the Synthwave pair", () => {
  const load = (themeId: string) => JSON.parse(readFileSync(path.join(root, `dist/theme-packs/render/${themeId}.json`), "utf8")) as ThemeRenderPack;
  const single = (usageMode: string) => buildFrameData(clock.toISOString(), {
    provider: "claude", label: "Claude", usageMode,
    usageWindows: [
      { id: "claude:weekly", label: "Session", percent: 41, resetSecs: 262800, pace: { delta: 0, state: "on pace", lasts: true } },
      { id: "codex:weekly", label: "Weekly", percent: 41, resetSecs: 586800, pace: { delta: -6, state: "reserve", lasts: true } },
    ],
  }, clock);

  it("Claude Creature says remaining for what remains, without shrinking the mode word", () => {
    const pack = load("claude-creature");
    const frame = single("remaining");
    const text = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "claude-creature", status: "ready", animate: false, frame })).replace(/<[^>]*>/g, "");
    expect(text).toContain("remaining");
    expect(text).not.toContain("left");
    const modeBoxes = (pack.spec!.p ?? []).filter((p) => p.t === "tx" && p.v === "{usageModeStandalone}");
    expect(modeBoxes).toHaveLength(2);
    for (const p of modeBoxes) {
      const fit = themeTextFit(renderTextPrimitive(p, frame), p.f ?? 1, p.s ?? 1, p.w ?? 0, true, p.h ?? 0);
      expect(fit.font).toBe(p.f);
      expect(fit.size).toBe(p.s);
    }
  });

  it("Synthwave has no USAGE label, in Two at once and for one provider", () => {
    const pack = load("synthwave");
    const pair = buildFrameData(clock.toISOString(), {
      provider: "claude+codex", label: "", usageMode: "remaining",
      usageWindows: [
        { id: "claude:weekly", label: "Claude Weekly", percent: 41, resetSecs: 262800, pace: { delta: 0, state: "on pace", lasts: true } },
        { id: "codex:weekly", label: "Codex Weekly", percent: 41, resetSecs: 586800, pace: { delta: -6, state: "reserve", lasts: true } },
      ],
    }, clock);
    const pairText = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "synthwave", status: "ready", animate: false, frame: pair })).replace(/<[^>]*>/g, "");
    expect(pairText).not.toContain("USAGE");
    expect(pairText.startsWith("remaining")).toBe(true);
    const singleText = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "synthwave", status: "ready", animate: false, frame: single("remaining") })).replace(/<[^>]*>/g, "");
    expect(singleText).not.toContain("USAGE");
  });
});
