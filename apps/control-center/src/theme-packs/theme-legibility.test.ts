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

// Issue #258: Mini Classic and Claude Creature must stay readable at normal
// viewing distance, and every percentage - including 100% - must render whole.
// The firmware clips a text primitive to its lane viewport, so a value that is
// wider than the lane loses its trailing "%" instead of wrapping or scaling.
const root = path.resolve(process.cwd(), "../..");
const clock = new Date("2026-09-21T12:00:00Z");
const themes = ["mini-classic", "claude-creature"] as const;

function pack(themeId: string): ThemeRenderPack {
  return JSON.parse(
    readFileSync(path.join(root, "dist/theme-packs/render", themeId + ".json"), "utf8"),
  ) as ThemeRenderPack;
}

function textPrimitives(themeId: string): ThemePrimitive[] {
  const spec = pack(themeId).spec;
  const primitives = (spec?.p ?? spec?.primitives ?? []) as ThemePrimitive[];
  return primitives.filter((p) => (p.t ?? p.type) === "tx" || (p.t ?? p.type) === "text");
}

function frame(
  percent: number,
  {
    label = "Codex",
    usageMode = "used",
    slotLabel = "Session",
    resetSecs = 3600,
  }: { label?: string; usageMode?: string; slotLabel?: string; resetSecs?: number } = {},
) {
  return buildFrameData(
    clock.toISOString(),
    {
      provider: "codex",
      label,
      activity: "idle",
      usageMode,
      usageSlots: [
        { id: "slot1", label: slotLabel, percent, resetSecs },
        { id: "slot2", label: slotLabel, percent, resetSecs },
      ],
    },
    clock,
  );
}

function laneWidth(p: ThemePrimitive): number {
  return (p.w ?? p.width ?? 0) as number;
}

function renderedWidth(p: ThemePrimitive, value: string): number {
  const font = (p.f ?? p.font ?? 1) as number;
  const size = themeTextFittedSize(
    value,
    font,
    (p.s ?? p.fontSize ?? 1) as number,
    laneWidth(p),
    (p.ft ?? p.fit) === "shrink",
  );
  return themeFirmwareTextMetrics(value, font, size)?.width ?? 0;
}

describe.each(themes)("%s legibility and fit (issue #258)", (themeId) => {
  it("renders every percentage from 0% to 100% completely", () => {
    for (const percent of [0, 7, 42, 99, 100]) {
      const data = frame(percent);
      for (const p of textPrimitives(themeId)) {
        const value = renderTextPrimitive(p, data);
        if (!value.endsWith("%")) continue;
        expect(value).toBe(percent + "%");
        // A lane is a hard clip: the whole value has to fit inside it.
        expect(laneWidth(p), value + " needs an explicit lane").toBeGreaterThan(0);
        expect(
          renderedWidth(p, value),
          value + " must fit its " + laneWidth(p) + "px lane",
        ).toBeLessThanOrEqual(laneWidth(p));
      }
    }
  });

  it("keeps every live value inside its lane for realistic frames", () => {
    const frames = [
      frame(64),
      frame(100, { usageMode: "remaining" }),
      frame(100, {
        label: "Open VibeTV Mac App",
        usageMode: "remaining",
        slotLabel: "Codex Spark Weekly",
        resetSecs: 604800,
      }),
      frame(0, { label: "Update available", resetSecs: 0 }),
    ];
    for (const data of frames) {
      for (const p of textPrimitives(themeId)) {
        if (!primitiveUsageSlotVisible(p, data)) continue;
        const value = renderTextPrimitive(p, data);
        expect(
          renderedWidth(p, value),
          JSON.stringify(value) + " in lane " + laneWidth(p),
        ).toBeLessThanOrEqual(laneWidth(p));
      }
    }
  });

  it("stays inside the 240 px panel at its unshrunk height", () => {
    for (const p of textPrimitives(themeId)) {
      const font = (p.f ?? p.font ?? 1) as number;
      const height = (font === 2 ? 16 : 8) * ((p.s ?? p.fontSize ?? 1) as number);
      expect(
        ((p.y ?? 0) as number) + height,
        JSON.stringify(p.v ?? p.b) + " bottom",
      ).toBeLessThanOrEqual(240);
    }
  });

  it("renders the reset line and percentages large enough to read", () => {
    const data = frame(64);
    const values = textPrimitives(themeId).map((p) => [p, renderTextPrimitive(p, data)] as const);
    const reset = values.find(([, value]) => /^Resets? in /.test(value));
    expect(reset, "a reset line must exist").toBeDefined();
    // Font 2 at size 2 is a 32 px cap-height line; the old size-1 Claude
    // Creature reset line was 16 px and unreadable at desk distance.
    const [resetPrimitive, resetValue] = reset!;
    const resetFont = (resetPrimitive.f ?? resetPrimitive.font ?? 1) as number;
    const resetSize = themeTextFittedSize(
      resetValue,
      resetFont,
      (resetPrimitive.s ?? resetPrimitive.fontSize ?? 1) as number,
      laneWidth(resetPrimitive),
      true,
    );
    expect((resetFont === 2 ? 16 : 8) * resetSize).toBeGreaterThanOrEqual(32);

    for (const [p, value] of values) {
      if (!value.endsWith("%")) continue;
      const font = (p.f ?? p.font ?? 1) as number;
      const size = themeTextFittedSize(
        value,
        font,
        (p.s ?? p.fontSize ?? 1) as number,
        laneWidth(p),
        true,
      );
      expect((font === 2 ? 16 : 8) * size, value + " glyph height").toBeGreaterThanOrEqual(48);
    }
  });

  it("ships the layout fix as a new immutable revision", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, "theme-packs", themeId, "manifest.json"), "utf8"),
    );
    const raw = readFileSync(path.join(root, "theme-packs", themeId, "theme.json"), "utf8");
    expect(JSON.parse(raw).rev).toBe(9);
    expect(manifest.themeSpec.path).toContain("-9-");
    expect(manifest.themeSpec.bytes).toBe(Buffer.byteLength(raw));
    // The published render pack has to match the tracked source revision.
    expect(pack(themeId).specPath).toBe(manifest.themeSpec.path);
  });
});
