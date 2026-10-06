import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildFrameData,
  primitiveUsageSlotVisible,
  renderTextPrimitive,
  themeFirmwareTextMetrics,
  themeTextFittedSize,
  type ThemePrimitive,
  type ThemeRenderPack,
} from "@/components/live-vibetv-preview";
import { importThemeSpec, validateThemeSpec } from "@/lib/theme-studio";

// #412: Pace Meter shows CodexBar's reserve pace for usage windows 1 and 2.
const root = path.resolve(process.cwd(), "../..");
const pack = JSON.parse(
  readFileSync(path.join(root, "dist/theme-packs/render/pace-meter.json"), "utf8"),
) as ThemeRenderPack;
const manifest = JSON.parse(
  readFileSync(path.join(root, "theme-packs/pace-meter/manifest.json"), "utf8"),
);
const texts = (pack.spec?.p || []).filter((p) => p.t === "tx");
const clock = new Date("2026-09-21T08:30:16Z");

function frame(windows: Array<Record<string, unknown>>, label = "Claude") {
  return buildFrameData(
    clock.toISOString(),
    { v: 2, provider: "claude", label, usageMode: "remaining", usageWindows: windows },
    clock,
  );
}
function visibleTexts(data: ReturnType<typeof frame>) {
  return texts
    .filter((p) => primitiveUsageSlotVisible(p, data))
    .map((p: ThemePrimitive) => renderTextPrimitive(p, data));
}

// Recorded CodexBar 0.63.0 Claude windows, as the Companion sends them.
const claude = [
  { id: "session", label: "Session", percent: 92, resetSecs: 11984, pace: { delta: -25, state: "reserve", lasts: true } },
  { id: "weekly", label: "Weekly", percent: 27, resetSecs: 95384, pace: { delta: 14, state: "deficit", lasts: false } },
];

describe("Pace Meter theme pack", () => {
  it("is gated on usage-pace-v1 and passes Theme Studio validation", () => {
    expect(manifest.requiredCapabilities).toEqual(["usage-slots-v1", "usage-pace-v1"]);
    const validation = validateThemeSpec(importThemeSpec(pack.spec), {}, "live");
    expect(validation.errors).toEqual([]);
    expect(texts.filter((p) => p.b === "l")).toHaveLength(1);
  });

  it("shows each window's signed pace and whether it lasts", () => {
    expect(visibleTexts(frame(claude))).toEqual([
      "Claude",
      "Session", "-25%", "lasts until reset",
      "Weekly", "+14%", "runs out",
    ]);
  });

  it("degrades to plain usage when CodexBar has no pace", () => {
    const values = visibleTexts(frame(claude.map((window) => ({ ...window, pace: undefined }))));
    expect(values).toEqual(["Claude", "Session", "", "", "Weekly", "", ""]);
  });

  it("keeps the longest real values inside their lanes and the screen", () => {
    const longest = frame(
      [
        { id: "codex-spark-weekly", label: "Codex Spark Weekly", percent: 100, resetSecs: 60, pace: { delta: 100, state: "deficit", lasts: true } },
        { id: "weekly", label: "Weekly", percent: 0, resetSecs: 60, pace: { delta: -100, state: "on pace", lasts: false } },
      ],
      "Open VibeTV Mac App",
    );
    for (const p of texts) {
      const value = renderTextPrimitive(p, longest);
      const size = themeTextFittedSize(value, p.f ?? 1, p.s ?? 1, p.w ?? 0, true);
      expect(themeFirmwareTextMetrics(value, p.f ?? 1, size)?.width, value).toBeLessThanOrEqual(p.w ?? 0);
      expect((p.y ?? 0) + 16 * (p.s ?? 1), value).toBeLessThanOrEqual(240);
    }
  });
});
