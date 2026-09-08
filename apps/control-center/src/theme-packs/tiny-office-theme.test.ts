import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData, primitiveUsageSlotVisible, renderTextPrimitive,
  ThemeSpecPreview, themeFirmwareTextMetrics, themeTextFittedSize,
  type ThemePrimitive, type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

const root = path.resolve(process.cwd(), "../..");
const pack = JSON.parse(readFileSync(path.join(root, "dist/theme-packs/render/tiny-office.json"), "utf8")) as ThemeRenderPack;
const rawSpec = readFileSync(path.join(root, "theme-packs/tiny-office/theme.json"), "utf8");
const primitives = pack.spec?.primitives || pack.spec?.p || [];
const clock = new Date("2026-09-07T12:00:00Z");
const slots = [
  { id: "session", label: "Session", percent: 76, resetSecs: 8078 },
  { id: "weekly", label: "Weekly", percent: 42, resetSecs: 86400 },
];
function frame(activity = "idle", usageSlots = slots, usageMode = "used", label = "Claude") {
  return buildFrameData(clock.toISOString(), { provider: "claude", label, activity, usageMode, usageSlots }, clock);
}
function text(primitive: ThemePrimitive, data = frame()) {
  return renderTextPrimitive(primitive, data);
}
function render(data = frame()) {
  return renderToStaticMarkup(createElement(ThemeSpecPreview, { pack, themeId: "tiny-office", status: "ready", animate: false, frame: data }));
}

describe("Tiny Office theme pack", () => {
  it("passes Theme Studio validation with bounded streamed assets", () => {
    const parsed = importThemeSpec(JSON.parse(rawSpec));
    const validation = validateThemeSpec(parsed, pack.assets || {}, "live");
    expect(validation.errors).toEqual([]);
    expect(primitives).toHaveLength(12);
    expect(Buffer.byteLength(rawSpec)).toBeLessThan(2048);
    let animated = 0;
    for (const asset of Object.values(pack.assets || {})) {
      const lines = asset.data.trim().split("\n");
      expect(["CBI1", "CBA1"]).toContain(lines[0]);
      const [w, h, frames = 1, fps = 0] = lines[1].split(" ").map(Number);
      if (lines[0] === "CBA1") {
        animated += 1;
        // Firmware CBA buffer is capped at 80x80 target pixels; sources draw at 2x.
        expect(w * 2).toBeLessThanOrEqual(80);
        expect(h * 2).toBeLessThanOrEqual(80);
        expect(frames).toBeGreaterThan(1);
        expect(fps).toBeGreaterThan(0);
        expect(fps).toBeLessThanOrEqual(8);
        expect(w * h * frames).toBeLessThanOrEqual(32768);
      } else {
        expect(w * h).toBeLessThan(10000);
      }
      expect(Number(lines[2])).toBeLessThanOrEqual(26);
    }
    expect(animated).toBe(2);
    expect(primitives.filter((p) => p.b === "usageMode" || p.binding === "usageMode")).toHaveLength(0);
  });

  it("uses the provider display/update-notice binding exactly once", () => {
    const labels = primitives.filter((p) => p.b === "l" || p.binding === "label");
    expect(labels).toHaveLength(1);
    for (const label of ["Claude", "OpenAI Codex", "Update available", "Open VibeTV Mac App"]) {
      expect(text(labels[0], frame("idle", slots, "used", label))).toBe(label);
    }
  });

  it("keeps percentages and actual slot names live", () => {
    const texts = primitives.filter((p) => p.t === "tx" || p.type === "text");
    const values = texts.map((p) => text(p));
    expect(values).toContain("Session");
    expect(values).toContain("Weekly");
    expect(values).not.toContain("used");
    expect(values).toContain("76%");
    expect(values).toContain("42%");
    const changed = frame("coding", [{ id: "weekly", label: "Codex Spark Weekly", percent: 100, resetSecs: 60 }], "remaining");
    const visible = texts.filter((p) => primitiveUsageSlotVisible(p, changed)).map((p) => text(p, changed));
    expect(visible).toContain("Codex Spark Weekly");
    expect(visible).toContain("100%");
    expect(visible).not.toContain("Weekly");
    const unavailable = frame("idle", []);
    expect(primitives.filter((p) => primitiveUsageSlotVisible(p, unavailable))).toHaveLength(4);
  });

  it("shows unavailable reset once instead of inventing a countdown", () => {
    const data = frame("idle", [{ id: "s", label: "Session", percent: 0, resetSecs: 0 }]);
    const values = primitives.filter((p) => p.t === "tx" || p.type === "text").map((p) => text(p, data));
    expect(values).toContain("Reset unavailable");
    expect(values).not.toContain("Reset Reset unavailable");
  });

  it("keeps every text primitive inside the 240 px panel at its unshrunk height", () => {
    // The firmware clips vertically instead of shrinking: font 2 is 16 px per size step.
    for (const p of primitives.filter((p) => p.t === "tx")) {
      const height = (p.f === 2 ? 16 : 8) * (p.s ?? 1);
      expect(p.y + height, `${p.v ?? p.b} bottom`).toBeLessThanOrEqual(240);
    }
  });

  it("keeps live text inside its lane, shrinking long values instead of clipping", () => {
    // Lanes use font 2 at size 2 with fit shrink. The firmware cannot shrink
    // below size 1 and clips to the lane, so the longest real values must fit
    // at size 1: contracted CodexBar window names, 100%, a week-long reset,
    // the renderer's unavailable text and the firmware update notices.
    const spark = frame("coding", [{ id: "codex-spark-weekly", label: "Codex Spark Weekly", percent: 100, resetSecs: 604800 }], "remaining", "Open VibeTV Mac App");
    const unavailable = frame("idle", [{ id: "s", label: "Session", percent: 0, resetSecs: 0 }]);
    for (const data of [frame(), spark, unavailable]) {
      for (const p of primitives.filter((p) => p.t === "tx" || p.type === "text")) {
        if (!primitiveUsageSlotVisible(p, data)) continue;
        const width = p.w ?? p.width ?? 0;
        const font = p.f ?? p.font ?? 1;
        const size = themeTextFittedSize(text(p, data), font, p.s ?? p.fontSize ?? 1, width, true);
        const measured = themeFirmwareTextMetrics(text(p, data), font, size)?.width;
        expect(measured, `${text(p, data)} in lane ${width}`).toBeLessThanOrEqual(width);
      }
    }
    expect(primitives.filter((p) => p.t === "tx").map((p) => text(p, spark))).toContain("Codex Spark Weekly");
    expect(primitives.filter((p) => p.t === "tx").map((p) => text(p, unavailable))).toContain("Reset unavailable");
  });

  it("renders different idle/coding art through the production component", () => {
    const idle = render(frame("idle"));
    const coding = render(frame("coding"));
    expect(idle).toContain('viewBox="0 0 240 240"');
    expect(coding).not.toEqual(idle);
    // A visible preview can be requested explicitly without writes on normal CI runs.
    const previewDir = process.env.VIBETV_THEME_PREVIEW_DIR;
    if (previewDir) {
      mkdirSync(previewDir, { recursive: true });
      for (const [name, markup] of Object.entries({ idle, coding })) {
        writeFileSync(path.join(previewDir, `${name}.svg`), markup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" '));
      }
    }
  });
});
