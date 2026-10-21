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
const clock = new Date("2026-10-08T12:00:00Z");
const paceSession = { delta: -6, state: "reserve", lasts: true };

function frame(percent: number, extra: Record<string, unknown> = {}, pace?: Record<string, unknown>) {
  const { updateNotice, ...rest } = extra as { updateNotice?: string };
  const built = buildFrameData(clock.toISOString(), {
    provider: "claude", label: "Claude", usageMode: "remaining",
    usageSlots: [
      { id: "session", label: "Session", percent, resetSecs: 8078, pace },
      { id: "weekly", label: "Weekly", percent: 87, resetSecs: 300000, pace: pace && { delta: -35, state: "reserve" } },
    ],
    ...rest,
  }, clock);
  return updateNotice ? { ...built, updateNotice } : built;
}
function render(data = frame(91)) {
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

describe("Gauge 2.0 theme pack", () => {
  it("is a pace theme that needs the arc, colour stops and usage-pace-v1", () => {
    const validation = validateThemeSpec(importThemeSpec(JSON.parse(rawSpec)), {}, "live");
    expect(validation.errors).toEqual([]);
    expect(arc).toMatchObject({ ps: "arc", b: "usageSlot1Pace", sl: 1, as: 225, aw: 270, at: 16, rc: "#C9F26B", dc: "#E7A3AC" });
    expect(manifest).toMatchObject({ usage: "live", assets: [], minFirmware: "1.0.50", version: "0.2.0" });
    expect(manifest.requiredCapabilities).toEqual(["usage-slots-v1", "color-stops-v1", "progress-arc-v1", "usage-pace-v1"]);
    // Two letters, so no theme a customer saves can share the file name.
    expect(manifest.themeSpec.path).toMatch(/^\/themes\/u\/ga-10-[0-9a-f]{8}\.json$/);
    expect(manifest.themeSpec.bytes).toBe(Buffer.byteLength(rawSpec));
    expect(pack.specPath).toBe(manifest.themeSpec.path);
  });

  it("draws the ring open at the bottom, with the plan tick, the piece and nothing without a pace", () => {
    const geometry = themeProgressArc(arc, 91)!;
    expect(geometry).toMatchObject({ start: 225, sweep: 270, thickness: 16, filled: 245 });
    // No pace: a plain ring of the use, no piece, no tick.
    const plain = render(frame(91));
    expect(ring(plain)).toEqual([[arc.bg, 270], ["#EDEDED", 245]]);
    expect(plain).not.toContain("<line");
    expect(shown(plain)).toBe("Claude91%Session leftresets 2h 14mWeekly 87%");
    // 6% reserve: the ring fills to the plan (85 %) and the green piece runs to the use.
    const reserve = render(frame(91, {}, paceSession));
    expect(ring(reserve)).toEqual([[arc.bg, 270], ["#EDEDED", 229], ["#C9F26B", 16]]);
    expect(reserve).toContain("<line");
    expect(shown(reserve)).toBe("Claude91%Session left6% reservelasts until reset - resets 2h 14mWeekly 87%35% reserve");
    // 14% deficit: the hatched piece runs from the use (38 %) to the plan (52 %).
    const deficit = render(frame(38, {}, { delta: 14, state: "deficit", lasts: false }));
    expect(ring(deficit)).toEqual([[arc.bg, 270], ["#EDEDED", 102], [expect.stringMatching(/^url\(#hatch-/), 38]]);
    expect(shown(deficit)).toContain("14% deficitruns out - resets 2h 14m");
    // On pace: the use itself and the tick, no piece.
    const onPace = render(frame(91, {}, { delta: 0, state: "on pace" }));
    expect(ring(onPace)).toEqual([[arc.bg, 270], ["#EDEDED", 245]]);
    expect(onPace).toContain("<line");
    expect(shown(onPace)).toContain("On pace");
  });

  it("says that the reset time is missing instead of showing a countdown", () => {
    const reset = texts.find((p) => p.b === "usageSlot1PaceFooter")!;
    expect(renderTextPrimitive(reset, frame(42))).toBe("resets 2h 14m");
    expect(renderTextPrimitive(reset, frame(42, noReset))).toBe("Reset unavailable");
    const idle = { usageSlots: [{ id: "session", label: "Session", percent: 100, resetSecs: 0 }], resetTrust: "live", resetSource: "codexbar", resetTrustSecs: 600 };
    expect(renderTextPrimitive(reset, frame(100, idle))).toBe("No active session");
    // With a pace the sentence leads into the countdown.
    expect(renderTextPrimitive(reset, frame(42, {}, { delta: 5, state: "deficit", lasts: false }))).toBe("runs out - resets 2h 14m");
    // The usage itself is still drawn: the ring and the number do not depend on the reset time.
    const markup = render(frame(42, noReset));
    expect(shown(markup)).toBe("Claude42%Session leftReset unavailable");
    expect(ring(markup)).toEqual([[arc.bg, 270], ["#EDEDED", 113]]);
    expect(renderTextPrimitive(number, frame(42, noReset))).toBe("42%");
  });

  it("shows only the provider line without a usage window and the second window only when there is one", () => {
    const none = frame(0, { usageSlots: [], session: 0 });
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, none))).toEqual(
      expect.arrayContaining([texts.find((p) => p.b === "usageProviderName")]),
    );
    expect(render(none)).not.toContain("<circle");
    // A notice during startup or a provider error still shows, under the (absent) ring.
    expect(shown(render({ ...none, updateNotice: "Update available" }))).toBe("ClaudeUpdate available");
    const one = frame(64, { usageSlots: [{ id: "session", label: "Session", percent: 64, resetSecs: 8078 }] });
    expect(shown(render(one))).toBe("Claude64%Session leftresets 2h 14m");
    expect(shown(render(frame(64)))).toContain("Weekly 87%");
  });

  it("keeps every line inside its lane on the device", () => {
    // The name does not show the notice; the footer does.
    expect(texts.filter((p) => p.b === "usageProviderName")).toHaveLength(1);
    expect(texts.filter((p) => p.b === "usageSlot1PaceFooter")).toHaveLength(1);
    const frames = [
      frame(91), frame(91, {}, paceSession), frame(38, {}, { delta: 14, state: "deficit", lasts: false }),
      frame(50, { updateNotice: "Update available" }), frame(50, { updateNotice: "Open VibeTV Mac App" }), frame(50, { label: "Open VibeTV Mac App" }),
      frame(50, noReset), frame(100, { usageMode: "used" }),
      frame(50, { usageSlots: [
        { id: "weekly", label: "Codex Spark Weekly", percent: 100, resetSecs: 604740 },
        { id: "session", label: "Session", percent: 100, resetSecs: 60 },
      ] }),
    ];
    const seen = new Set<string>();
    for (const data of frames) {
      for (const p of texts.filter((t) => t.f !== 4)) {
        const value = renderTextPrimitive(p, data);
        seen.add(value);
        const font = p.f ?? 1;
        const size = themeTextFittedSize(value, font, p.s!, p.w!, true);
        const width = themeFirmwareTextMetrics(value, font, size)!.width;
        expect(width, `${value} in ${p.v ?? p.b}`).toBeLessThanOrEqual(p.w!);
      }
    }
    for (const value of ["Claude", "Open VibeTV Mac App", "Session left", "Session used", "6% reserve", "14% deficit", "lasts until reset - resets 2h 14m", "Reset unavailable"]) {
      expect(seen).toContain(value);
    }
  });

  // A notice replaces the reset line under the ring, never the provider name in it:
  // the name stays inside the hole, and every notice lies wholly outside the ring.
  it("shows the update notice under the ring and keeps the provider name inside it", () => {
    const { cx, cy, radius, thickness } = themeProgressArc(arc, 0)!;
    const hole = radius - thickness / 2;
    const outer = radius + thickness / 2;
    const name = texts.find((p) => p.b === "usageProviderName")!;
    const footer = texts.find((p) => p.b === "usageSlot1PaceFooter")!;
    const box = (p: ThemePrimitive, text: string) => {
      const size = themeTextFittedSize(text, p.f!, p.s!, p.w!, true);
      const width = themeFirmwareTextMetrics(text, p.f!, size)!.width;
      const left = p.x! + (p.w! - width) / 2;
      const height = 16 * size;
      return [[left, p.y!], [left + width, p.y!], [left, p.y! + height], [left + width, p.y! + height]];
    };
    // Names are short: every corner of the name box lies inside the hole, notice or not.
    for (const label of ["Claude", "Codex", "Cursor", "OpenCode Go"]) {
      for (const [x, y] of box(name, renderTextPrimitive(name, frame(91, { label, updateNotice: "Open VibeTV Mac App" })))) {
        expect(Math.hypot(x - cx, y - cy), `${label} corner ${x},${y}`).toBeLessThan(hole);
      }
    }
    expect(renderTextPrimitive(name, frame(91, { updateNotice: "Update available" }))).toBe("Claude");
    for (const updateNotice of ["Update available", "Open VibeTV Mac App"]) {
      const data = frame(91, {}, paceSession);
      const text = renderTextPrimitive(footer, { ...data, updateNotice });
      expect(text).toBe(updateNotice);
      for (const [x, y] of box(footer, text)) {
        expect(Math.hypot(x - cx, y - cy), `${updateNotice} corner ${x},${y}`).toBeGreaterThan(outer + 4);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(240);
      }
      // The reset line is hidden while it shows, and the pace line above stays.
      const shownText = shown(render({ ...data, updateNotice }));
      expect(shownText).not.toContain("resets");
      expect(shownText).toContain(`6% reserve${updateNotice}`);
    }
  });

  it("stays inside the 240 px panel and renders through the production preview", () => {
    const { cx, cy, radius, thickness } = themeProgressArc(arc, 0)!;
    // The ring and its tick (3 px beyond the ring) lie inside the panel.
    expect(cx - radius - thickness / 2 - 3).toBeGreaterThanOrEqual(0);
    expect(cy - radius - thickness / 2 - 3).toBeGreaterThanOrEqual(0);
    for (const p of texts) {
      expect((p.y ?? 0) + (p.h ?? (p.f === 4 ? 26 : 16) * (p.s ?? 1)), `${p.v ?? p.b} bottom`).toBeLessThanOrEqual(240);
    }
    const markup = render();
    expect(markup).toContain('viewBox="0 0 240 240"');
    // A visible preview can be requested explicitly without writes on normal CI runs.
    const previewDir = process.env.VIBETV_THEME_PREVIEW_DIR;
    if (previewDir) {
      mkdirSync(previewDir, { recursive: true });
      const pictures: Array<[string, string]> = [
        ["gauge-plain", markup], ["gauge-reserve", render(frame(91, {}, paceSession))],
        ["gauge-no-reset", render(frame(42, noReset))], ["gauge-catalog", render(THEME_CATALOG_PREVIEW_FRAME)],
      ];
      for (const [name, svg] of pictures) {
        writeFileSync(path.join(previewDir, `${name}.svg`), svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" '));
      }
    }
  });
});
