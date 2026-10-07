import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, primitiveUsageSlotVisible, renderTextPrimitive, THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview, themeFirmwareTextMetrics, themeTextFittedSize,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const pack = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/render/duo.json"), "utf8")) as ThemeRenderPack;
const rawSpec = readFileSync(path.join(root, "theme-packs/duo/theme.json"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(root, "theme-packs/duo/manifest.json"), "utf8"));
const primitives = (pack.spec?.p || []) as ThemePrimitive[];
const texts = primitives.filter((p) => p.t === "tx");
const clock = new Date("2026-10-08T12:00:00Z");
const claude = { id: "claude", label: "Claude", percent: 64, resetSecs: 8078 };
const codex = { id: "codex", label: "Codex", percent: 100, resetSecs: 604740 };
type Frame = ReturnType<typeof buildFrameData>;

function frame(providerSlots: Array<typeof claude>, extra: Record<string, unknown> = {}) {
  return buildFrameData(clock.toISOString(), { provider: "codex", label: "Codex", usageMode: "used", providerSlots, ...extra }, clock);
}
function render(data: Frame) {
  return renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "duo", status: "ready", animate: false, frame: data }));
}
// Every line the production preview draws, in paint order, and the number of dividers.
function screen(data: Frame) {
  const markup = render(data);
  return {
    lines: [...markup.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1].replace(/<[^>]+>/g, "")),
    dividers: markup.split('fill="#333333"').length - 1,
  };
}
// Advance widths of the digits and "%" in TFT_eSPI 2.5.43 Font 4 (Font32rle.c).
const font4Width = (value: string) => Array.from(value).reduce((sum, ch) => sum + (ch === "%" ? 21 : 14), 0);
// The size and width a line gets on the device, and the size the preview picks.
function fitted(p: ThemePrimitive, data: Frame) {
  const value = renderTextPrimitive(p, data);
  const font = p.f ?? 1;
  const size = themeTextFittedSize(value, font, p.s!, p.w!, p.ft === "shrink");
  const width = font === 4 ? font4Width(value) * size : themeFirmwareTextMetrics(value, font, size)!.width;
  return { value, size, width };
}

describe("Duo theme pack", () => {
  it("is an eleven-primitive live theme without assets, inside the device limits", () => {
    const validation = validateThemeSpec(importThemeSpec(JSON.parse(rawSpec)), {}, "live");
    expect(validation.errors).toEqual([]);
    expect(primitives).toHaveLength(11);
    // The smaller of the two device limits: 2048 bytes inline, 4096 bytes stored.
    expect(Buffer.byteLength(rawSpec)).toBeLessThan(2048);
    expect(manifest).toMatchObject({ usage: "live", assets: [], minFirmware: "1.0.42", requiredCapabilities: ["usage-slots-v1", "provider-slots-v1", "text-valign-v1"] });
    expect(manifest.themeSpec.path).toMatch(/^\/themes\/u\/duo-3-[0-9a-f]{8}\.json$/);
    expect(manifest.themeSpec.bytes).toBe(Buffer.byteLength(rawSpec));
    expect(manifest.themeSpec.sha256).toBe(createHash("sha256").update(rawSpec).digest("hex"));
    expect(pack.specPath).toBe(manifest.themeSpec.path);
  });

  it("shows two providers, each with label, percentage, usage mode and reset", () => {
    // A slot carries the provider's fullest window and its soonest reset, so the
    // line names the provider's next reset, not the reset of the number above it.
    expect(screen(frame([claude, codex]))).toEqual({
      lines: ["Codex", "Claude", "64%", "used", "Next reset 2h 14m", "Codex", "100%", "used", "Next reset 6d 23h"],
      dividers: 2,
    });
    // The lower half is the upper half moved down and bound to the second slot.
    const half = (slot: number) => primitives.filter((p) => p.pl === slot && p.t === "tx");
    expect(half(1)).toHaveLength(4);
    expect(half(2)).toEqual(half(1).map((p) => JSON.parse(JSON.stringify({ ...p, y: p.y! + 102, pl: 2 }).replaceAll("pv1", "pv2"))));
  });

  it("names the usage mode the frame carries and shows the percentages as sent", () => {
    // The Companion turns the slot percentages for "remaining"; the theme must not turn them again.
    const data = frame([{ ...claude, percent: 36 }, { ...codex, percent: 0 }], { usageMode: "remaining" });
    expect(screen(data).lines).toEqual(["Codex", "Claude", "36%", "remaining", "Next reset 2h 14m", "Codex", "0%", "remaining", "Next reset 6d 23h"]);
  });

  it("leaves the lower half empty below its divider with one provider", () => {
    expect(screen(frame([codex]))).toEqual({ lines: ["Codex", "Codex", "100%", "used", "Next reset 6d 23h"], dividers: 2 });
  });

  it("shows only the provider line without a provider slot", () => {
    expect(screen(frame([]))).toEqual({ lines: ["Codex"], dividers: 1 });
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, frame([])))).toHaveLength(2);
  });

  it("collapses a slot countdown the device cannot stand behind", () => {
    expect(screen(frame([{ ...claude, resetSecs: 0 }])).lines).toEqual(["Codex", "Claude", "64%", "used", "Reset unavailable"]);
  });

  it("keeps every line inside its lane and the main lines at full size", () => {
    expect(texts.filter((p) => p.b === "l")).toHaveLength(1);
    const slot = (label: string, percent: number, resetSecs: number) => ({ id: label.toLowerCase(), label, percent, resetSecs });
    const frames = [
      frame([claude, codex]),
      frame([slot("Cursor", 0, 17940), slot("Copilot", 7, 300)], { usageMode: "remaining", label: "Update available" }),
      frame([slot("Gemini", 42, 0), slot("Factory", 99, 59)], { label: "Open VibeTV Mac App" }),
      frame([slot("OpenRouter", 100, 86340), slot("Antigravity", 100, 2591940)], { usageMode: "remaining" }),
    ];
    const sizes = new Map<string, number[]>();
    for (const data of frames) {
      for (const p of texts.filter((p) => primitiveUsageSlotVisible(p, data))) {
        const { value, size, width } = fitted(p, data);
        expect(width, `${value} in its ${p.w} px lane`).toBeLessThanOrEqual(p.w!);
        sizes.set(value, [size, p.s!]);
      }
    }
    // Only the long update notice, long provider names and the two widest countdowns drop a
    // size: two-digit hours with two-digit minutes need 244 px at full size, two-digit days
    // with two-digit hours 242 px, both more than the panel has.
    const shrunk = [...sizes].filter(([, [size, full]]) => size < full).map(([value]) => value);
    expect(shrunk.sort()).toEqual(["Antigravity", "Next reset 23h 59m", "Next reset 29d 23h", "Open VibeTV Mac App", "OpenRouter"]);
    for (const value of ["Update available", "Copilot", "Factory", "0%", "100%", "remaining", "Next reset 4h 59m", "Next reset 6d 23h", "Reset unavailable"]) {
      expect(sizes.has(value), value).toBe(true);
    }
  });

  it("stays inside the 240 px panel and renders the catalog preview", () => {
    for (const p of texts) {
      // The firmware clips a line to its font height plus four pixels.
      const height = { 1: 8, 2: 16, 4: 26 }[p.f ?? 1]! * p.s! + 4;
      expect(p.y! + Math.max(p.h ?? 0, height), `${p.v ?? p.b} bottom`).toBeLessThanOrEqual(240);
      expect(p.x! + p.w!, `${p.v ?? p.b} right edge`).toBeLessThanOrEqual(240);
    }
    const markup = render(THEME_CATALOG_PREVIEW_FRAME);
    expect(markup).toContain('viewBox="0 0 240 240"');
    expect(markup).toContain("64%");
    // A visible preview can be requested explicitly without writes on normal CI runs.
    const previewDir = process.env.VIBETV_THEME_PREVIEW_DIR;
    if (previewDir) {
      mkdirSync(previewDir, { recursive: true });
      const states = { "duo-catalog": THEME_CATALOG_PREVIEW_FRAME, duo: frame([claude, codex]), "duo-one": frame([codex]), "duo-none": frame([]) };
      for (const [name, data] of Object.entries(states)) {
        writeFileSync(path.join(previewDir, `${name}.svg`), render(data).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" '));
      }
    }
  });
});
