import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, renderTextPrimitive, THEME_CATALOG_PREVIEW_FRAME, ThemeSpecPreview, themeTextWidth,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const packDir = path.join(root, "theme-packs/retro-3d");
const pack = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/render/retro-3d.json"), "utf8")) as ThemeRenderPack;
const rawSpec = readFileSync(path.join(packDir, "theme.json"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(packDir, "manifest.json"), "utf8"));
const primitives = (pack.spec?.p || []) as ThemePrimitive[];
const texts = primitives.filter((p) => p.t === "tx");

// Decodes the CBA into one palette-index array per frame.
const lines = pack.assets!["/themes/s/r3d-spin.cba"].data.trim().split("\n");
const [width, height, frameCount, fps] = lines[1].split(" ").map(Number);
const paletteSize = Number(lines[2]);
const palette = lines.slice(3, 3 + paletteSize);
const frames = Array.from({ length: frameCount }, (_, frame) =>
  lines.slice(3 + paletteSize + frame * height, 3 + paletteSize + (frame + 1) * height).flatMap((row) =>
    [...row.matchAll(/(\d*)([a-z.])/g)].flatMap(([, count, token]) => Array(Number(count || 1)).fill(token.charCodeAt(0) - 97))));
const luminance = (hex: string) =>
  (0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16)) / 255;

describe("Retro 3D screensaver pack", () => {
  it("is a screensaver pack inside the device limits", () => {
    const validation = validateThemeSpec(importThemeSpec(JSON.parse(rawSpec)), pack.assets || {}, "screensaver");
    expect(validation.errors).toEqual([]);
    expect(primitives).toHaveLength(3);
    expect(Buffer.byteLength(rawSpec)).toBeLessThan(2048);
    expect(manifest.usage).toBe("screensaver");
    expect(manifest.requiredCapabilities).toEqual(["usage-slots-v1"]);
    expect(manifest.themeSpec.path).toMatch(/^\/themes\/s\/r3d-2-[0-9a-f]{8}\.json$/);
    expect(pack.specPath).toBe(manifest.themeSpec.path);
    for (const entry of [manifest.themeSpec, ...manifest.assets]) {
      const bytes = readFileSync(path.join(packDir, entry.file));
      expect(entry.path.startsWith("/themes/s/") && entry.path.length <= 31, entry.path).toBe(true);
      expect(entry.bytes).toBe(bytes.byteLength);
      expect(entry.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("animates one sprite that fits the firmware frame buffer", () => {
    const sprites = primitives.filter((p) => p.t === "sp");
    expect(sprites).toHaveLength(1);
    expect(lines[0]).toBe("CBA1");
    // Firmware CBA buffer is capped at 80x80 target pixels; the source draws at 2x.
    expect([sprites[0].w, sprites[0].h]).toEqual([width * 2, height * 2]);
    expect(width * 2).toBeLessThanOrEqual(80);
    expect(height * 2).toBeLessThanOrEqual(80);
    expect(frameCount).toBeGreaterThanOrEqual(16);
    expect(fps).toBeGreaterThan(0);
    expect(fps).toBeLessThanOrEqual(8);
    expect(width * height * frameCount).toBeLessThanOrEqual(32768);
    expect(paletteSize).toBeLessThanOrEqual(26);
    // Opaque black background: the device would paint transparent pixels with a clear colour anyway.
    expect(palette[0]).toBe("#000000");
    for (const frame of frames) {
      expect(frame).toHaveLength(width * height);
      expect(Math.min(...frame)).toBe(0);
      expect(Math.max(...frame)).toBeLessThan(paletteSize);
    }
  });

  it("loops without a jump and leaves no sprite pixel unchanged", () => {
    const step = (from: number[], to: number[]) => from.reduce((sum, value, i) => sum + Math.abs(value - to[i]), 0);
    const steps = frames.map((frame, i) => step(frame, frames[(i + 1) % frameCount]));
    // The step from the last frame back to the first is an ordinary step.
    expect(steps[frameCount - 1]).toBeLessThanOrEqual(Math.max(...steps.slice(0, -1)));
    expect(Math.min(...steps)).toBeGreaterThan(0);
    for (let pixel = 0; pixel < width * height; pixel++) {
      const values = frames.map((frame) => frame[pixel]);
      if (Math.max(...values) > 0) {
        expect(new Set(values).size, `pixel ${pixel}`).toBeGreaterThan(1);
      }
    }
  });

  it("keeps the static text dim and inside its lanes", () => {
    const data = buildFrameData("2026-10-07T12:00:00Z", { provider: "openrouter", label: "OpenRouter", session: 10 }, new Date("2026-10-07T12:00:00Z"));
    const values = texts.map((p) => renderTextPrimitive(p, data));
    expect(values[0]).toMatch(/^\d\d:\d\d$/);
    // The screensaver shows the provider key; the label binding would let the update notice take it over.
    expect(values[1]).toBe("openrouter");
    texts.forEach((p, i) => {
      // Font 4 is 26 px per size step and has no width table in the preview;
      // the preview estimate is wider than the device font, so it is the bound.
      expect(p.f).toBe(4);
      expect(themeTextWidth(values[i], 26 * p.s!), values[i]).toBeLessThanOrEqual(p.w!);
      expect((p.y ?? 0) + 26 * p.s!, `${values[i]} bottom`).toBeLessThanOrEqual(240);
      expect(luminance(p.c!), `${values[i]} colour`).toBeLessThan(0.55);
    });
    // The provider line never changes, so it is the dimmest element.
    expect(luminance(texts[1].c!)).toBeLessThan(luminance(texts[0].c!));
  });

  it("renders through the production preview component", () => {
    const markup = renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "retro-3d", status: "ready", animate: false, frame: THEME_CATALOG_PREVIEW_FRAME }));
    expect(markup).toContain('viewBox="0 0 240 240"');
    expect(markup).toContain("12:00");
    // A visible preview can be requested explicitly without writes on normal CI runs.
    const previewDir = process.env.VIBETV_THEME_PREVIEW_DIR;
    if (previewDir) {
      mkdirSync(previewDir, { recursive: true });
      writeFileSync(path.join(previewDir, "retro-3d.svg"), markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" '));
    }
  });
});
