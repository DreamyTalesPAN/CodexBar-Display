import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, primitiveUsageSlotVisible, renderTextPrimitive, THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview, themeFirmwareTextMetrics, themeProgressArc, themeTextFittedSize,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const pack = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/render/gauge.json"), "utf8")) as ThemeRenderPack;
const rawSpec = readFileSync(path.join(root, "theme-packs/gauge/theme.json"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(root, "theme-packs/gauge/manifest.json"), "utf8"));
const primitives = (pack.spec?.p || []) as ThemePrimitive[];
const texts = primitives.filter((p) => p.t === "tx");
const arc = primitives.find((p) => p.t === "p")!;
const number = texts.find((p) => p.v === "{usageSlot1Percent}%")!;
const reset = texts.find((p) => p.v?.includes("{usageSlot1Reset}"))!;
const clock = new Date("2026-10-08T12:00:00Z");

function frame(percent: number, extra: Record<string, unknown> = {}) {
  return buildFrameData(clock.toISOString(), {
    provider: "claude", label: "Claude", usageMode: "used",
    usageSlots: [{ id: "session", label: "Session", percent, resetSecs: 8078 }],
    ...extra,
  }, clock);
}
function render(data = frame(50)) {
  return renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "gauge", status: "ready", animate: false, frame: data }));
}
// What a rendered picture says: its text without the markup around each glyph.
const shown = (markup: string) => markup.replace(/<[^>]*>/g, "");
const noReset = { usageSlots: [{ id: "session", label: "Session", percent: 42, resetSecs: 0 }] };
// The colours and lengths of the ring's strokes in a rendered picture, in degrees.
function ring(markup: string) {
  const radius = themeProgressArc(arc, 0)!.radius;
  return [...markup.matchAll(/<circle[^>]*stroke="([^"]+)"[^>]*stroke-dasharray="([\d.]+) /g)]
    .map(([, color, length]) => [color, Math.round(Number(length) / ((radius * Math.PI) / 180))]);
}

describe("Gauge theme pack", () => {
  it("is a six-primitive live theme without assets that needs the arc", () => {
    const validation = validateThemeSpec(importThemeSpec(JSON.parse(rawSpec)), {}, "live");
    expect(validation.errors).toEqual([]);
    expect(primitives).toHaveLength(6);
    expect(primitives.filter((p) => p.t === "p")).toEqual([expect.objectContaining({ ps: "arc", b: "us1p", sl: 1 })]);
    expect(manifest).toMatchObject({ usage: "live", assets: [], minFirmware: "1.0.42" });
    expect(manifest.requiredCapabilities).toEqual(["usage-slots-v1", "color-stops-v1", "text-valign-v1", "progress-arc-v1"]);
    // Two letters, so no theme a customer saves can share the file name: an
    // own theme is sent under the first seven characters of an id of three or more.
    expect(manifest.themeSpec.path).toMatch(/^\/themes\/u\/ga-2-[0-9a-f]{8}\.json$/);
    expect(manifest.themeSpec.bytes).toBe(Buffer.byteLength(rawSpec));
    expect(pack.specPath).toBe(manifest.themeSpec.path);
  });

  it("draws 0 %, 50 % and 100 % as an empty, a half-filled and a full half-ring and names the percentage", () => {
    // Advance widths of the digits and % in TFT_eSPI 2.5.43 Font 4 (Font32rle.c).
    const deviceWidth = (value: string) =>
      Array.from(value).reduce((sum, ch) => sum + (ch === "%" ? 21 : 14), 0) * number.s!;
    const track = arc.bg!;
    const cases: Array<[number, string, Array<[string, number]>]> = [
      [0, "0%", [[track, 180]]],
      [50, "50%", [[track, 180], ["#FACC15", 90]]],
      [100, "100%", [[track, 180], ["#EF4444", 180]]],
      // Values outside 0 to 100 are shown as the nearest end.
      [140, "100%", [[track, 180], ["#EF4444", 180]]],
      [-5, "0%", [[track, 180]]],
    ];
    for (const [percent, expected, strokes] of cases) {
      const data = frame(percent);
      const markup = render(data);
      expect(renderTextPrimitive(number, data)).toBe(expected);
      expect(ring(markup), expected).toEqual(strokes);
      expect(shown(markup)).toContain("Reset in 2h 14m");
      expect(deviceWidth(expected), expected).toBeLessThanOrEqual(number.w!);
    }
    // The ring starts at 9 o'clock and runs over the top to 3 o'clock.
    expect(themeProgressArc(arc, 50)).toMatchObject({ start: 270, sweep: 180, filled: 90 });
    // In remaining mode the same ring shows what is left, in the colour for that share.
    expect(ring(render(frame(80, { usageMode: "remaining" })))).toEqual([[track, 180], ["#22C55E", 144]]);
  });

  it("says that the reset time is missing instead of showing a countdown", () => {
    expect(renderTextPrimitive(reset, frame(42))).toBe("Reset in 2h 14m");
    expect(renderTextPrimitive(reset, frame(42, noReset))).toBe("Reset unavailable");
    const idle = { usageSlots: [{ id: "session", label: "Session", percent: 0, resetSecs: 0 }], resetTrust: "live", resetSource: "codexbar", resetTrustSecs: 600 };
    expect(renderTextPrimitive(reset, frame(0, idle))).toBe("No active session");
    // The usage itself is still drawn: the ring and the number do not depend on the reset time.
    const markup = render(frame(42, noReset));
    expect(shown(markup)).toBe("Claude42%Session usedReset unavailable");
    expect(ring(markup)).toEqual([[arc.bg, 180], ["#FACC15", 75]]);
    expect(renderTextPrimitive(number, frame(42, noReset))).toBe("42%");
  });

  it("shows only the provider line without a usage window and the second window only when there is one", () => {
    const none = frame(0, { usageSlots: [], session: 0 });
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, none))).toEqual([texts.find((p) => p.b === "l")]);
    expect(render(none)).not.toContain("<circle");
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, frame(50)))).toHaveLength(5);
    const two = frame(64, { usageSlots: [
      { id: "session", label: "Session", percent: 64, resetSecs: 8078 },
      { id: "weekly", label: "Weekly", percent: 28, resetSecs: 300000 },
    ] });
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, two))).toHaveLength(6);
    expect(texts.map((p) => renderTextPrimitive(p, two))).toEqual(["Claude", "64%", "Session used", "Weekly 28%", "Reset in 2h 14m"]);
  });

  it("keeps every line inside its lane on the device", () => {
    expect(texts.filter((p) => p.b === "l")).toHaveLength(1);
    const frames = [
      frame(50), frame(50, { label: "Update available" }), frame(50, { label: "Open VibeTV Mac App" }),
      frame(50, noReset), frame(100, { usageMode: "remaining" }),
      frame(50, { usageSlots: [
        { id: "weekly", label: "Codex Spark Weekly", percent: 100, resetSecs: 604740 },
        { id: "session", label: "Session", percent: 100, resetSecs: 60 },
      ] }),
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
    for (const value of ["Claude", "Open VibeTV Mac App", "Session used", "Session remaining", "Codex Spark Weekly used", "Session 100%", "Reset in 6d 23h", "Reset unavailable"]) {
      expect(seen).toContain(value);
    }
  });

  it("stays inside the 240 px panel, keeps the number clear of the ring and renders through the production preview", () => {
    const { cx, cy, radius, thickness } = themeProgressArc(arc, 0)!;
    expect([arc.x! + arc.w!, arc.y! + arc.h!].every((edge) => edge <= 240)).toBe(true);
    // The number's widest box, "100%" in Font 4, lies inside the hole of the ring.
    const hole = radius - thickness / 2;
    for (const [x, y] of [[cx - 63, number.y!], [cx + 63, number.y!], [cx - 63, number.y! + 52], [cx + 63, number.y! + 52]]) {
      expect(Math.hypot(x - cx, y - cy)).toBeLessThan(hole);
    }
    for (const p of texts) {
      expect((p.y ?? 0) + (p.h ?? (p.f === 4 ? 26 : 16) * (p.s ?? 1)), `${p.v ?? p.b} bottom`).toBeLessThanOrEqual(240);
    }
    const markup = render();
    expect(markup).toContain('viewBox="0 0 240 240"');
    expect(shown(markup)).toBe("Claude50%Session usedReset in 2h 14m");
    // A visible preview can be requested explicitly without writes on normal CI runs.
    const previewDir = process.env.VIBETV_THEME_PREVIEW_DIR;
    if (previewDir) {
      mkdirSync(previewDir, { recursive: true });
      const pictures: Array<[string, string]> = [
        ["gauge-000", render(frame(0))], ["gauge-050", markup], ["gauge-100", render(frame(100))],
        ["gauge-no-reset", render(frame(42, noReset))], ["gauge-catalog", render(THEME_CATALOG_PREVIEW_FRAME)],
      ];
      for (const [name, svg] of pictures) {
        writeFileSync(path.join(previewDir, `${name}.svg`), svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" '));
      }
    }
  });
});
