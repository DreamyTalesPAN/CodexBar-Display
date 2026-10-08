import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, primitiveUsageSlotVisible, renderTextPrimitive, THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview, themeFirmwareTextMetrics, themeTextFittedSize,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const pack = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/render/token-counter.json"), "utf8")) as ThemeRenderPack;
const rawSpec = readFileSync(path.join(root, "theme-packs/token-counter/theme.json"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(root, "theme-packs/token-counter/manifest.json"), "utf8"));
const primitives = (pack.spec?.p || []) as ThemePrimitive[];
const texts = primitives.filter((p) => p.t === "tx");
const number = texts.find((p) => p.b === "st")!;
const clock = new Date("2026-10-07T12:00:00Z");

function frame(sessionTokens?: number, extra: Record<string, unknown> = {}) {
  return buildFrameData(clock.toISOString(), {
    provider: "claude", label: "Claude", usageMode: "used",
    usageSlots: [{ id: "session", label: "Session", percent: 42, resetSecs: 8078 }],
    ...(sessionTokens === undefined ? {} : { sessionTokens }),
    ...extra,
  }, clock);
}
function render(data = frame(38_400_000)) {
  return renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "token-counter", status: "ready", animate: false, frame: data }));
}

describe("Token Counter theme pack", () => {
  it("is a five-primitive live theme without assets", () => {
    const validation = validateThemeSpec(importThemeSpec(JSON.parse(rawSpec)), {}, "live");
    expect(validation.errors).toEqual([]);
    expect(primitives).toHaveLength(5);
    expect(manifest.assets).toEqual([]);
    expect(manifest.minFirmware).toBe("1.0.42");
    expect(manifest.requiredCapabilities).toEqual(["usage-slots-v1", "text-valign-v1"]);
    expect(manifest.themeSpec.path).toMatch(/^\/themes\/u\/tc-2-[0-9a-f]{8}\.json$/);
    expect(manifest.themeSpec.bytes).toBe(Buffer.byteLength(rawSpec));
    expect(pack.specPath).toBe(manifest.themeSpec.path);
  });

  it("shows every token magnitude at the same full size", () => {
    // Advance widths of the token alphabet in TFT_eSPI 2.5.43 Font 4 (Font32rle.c).
    const deviceWidth = (value: string) =>
      Array.from(value).reduce((sum, ch) => sum + ({ ".": 7, "-": 8, K: 17, M: 21, B: 17 }[ch] ?? 14), 0) * number.s!;
    const cases: Array<[number | undefined, string]> = [
      [0, "0"], [999, "999"], [1_400_000, "1.4M"], [38_400_000, "38.4M"], [88_800_000, "88.8M"],
      [142_000_000, "142M"], [1_070_000_000, "1.07B"], [undefined, "--"],
    ];
    for (const [tokens, expected] of cases) {
      const value = renderTextPrimitive(number, frame(tokens));
      expect(value).toBe(expected);
      // The preview has no Font 4 table and estimates wider than the device,
      // so the lane has to hold both without shrinking either.
      expect(themeTextFittedSize(value, number.f!, number.s!, number.w!, true), value).toBe(number.s);
      expect(deviceWidth(value), value).toBeLessThanOrEqual(number.w!);
    }
  });

  it("keeps the provider line, update notice and reset line inside their lanes", () => {
    expect(texts.filter((p) => p.b === "l")).toHaveLength(1);
    const idle = { usageSlots: [{ id: "session", label: "Session", percent: 0, resetSecs: 0 }], resetTrust: "live", resetSource: "codexbar", resetTrustSecs: 600 };
    const frames = [
      frame(1), frame(1, { label: "Update available" }), frame(1, { label: "Open VibeTV Mac App" }),
      frame(1, { usageSlots: [{ id: "weekly", label: "Weekly", percent: 42, resetSecs: 86340 }] }),
      frame(1, { usageSlots: [{ id: "session", label: "Session", percent: 42, resetSecs: 0 }] }), frame(1, idle),
    ];
    const seen = new Set<string>();
    for (const data of frames) {
      for (const p of texts.filter((p) => p.f === 2)) {
        const value = renderTextPrimitive(p, data);
        seen.add(value);
        const size = themeTextFittedSize(value, 2, p.s!, p.w!, true);
        expect(themeFirmwareTextMetrics(value, 2, size)!.width, value).toBeLessThanOrEqual(p.w!);
      }
    }
    for (const value of ["Claude", "Open VibeTV Mac App", "Reset in 2h 14m", "Reset in 23h 59m", "Reset unavailable", "No active session"]) {
      expect(seen).toContain(value);
    }
  });

  it("drops the reset line and its divider when no usage window exists", () => {
    const data = frame(1, { usageSlots: [], session: 0 });
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, data))).toHaveLength(3);
  });

  it("stays inside the 240 px panel and renders through the production preview", () => {
    for (const p of texts) {
      expect((p.y ?? 0) + (p.h ?? (p.f === 4 ? 26 : 16) * (p.s ?? 1)), `${p.v ?? p.b} bottom`).toBeLessThanOrEqual(240);
    }
    const markup = render();
    expect(markup).toContain('viewBox="0 0 240 240"');
    expect(markup).toContain("38.4M");
    // A visible preview can be requested explicitly without writes on normal CI runs.
    const previewDir = process.env.VIBETV_THEME_PREVIEW_DIR;
    if (previewDir) {
      mkdirSync(previewDir, { recursive: true });
      for (const [name, svg] of [["token-counter", markup], ["token-counter-catalog", render(THEME_CATALOG_PREVIEW_FRAME)]]) {
        writeFileSync(path.join(previewDir, `${name}.svg`), svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" '));
      }
    }
  });
});
