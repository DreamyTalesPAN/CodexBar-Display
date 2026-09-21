import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { agentStatusText } from "@/lib/agent-theme-state";
import {
  themeFirmwareTextMetrics,
  themeTextFittedSize,
  type ThemeRenderPack,
} from "@/components/live-vibetv-preview";

describe("status labels in real theme slots", () => {
  for (const id of [
    "tiny-office",
    "mini-classic",
    "claude-creature",
    "pixel-battery",
    "synthwave",
  ]) {
    it(`${id} fits observed Codex and Claude status text without changing usage lanes`, () => {
      const pack = JSON.parse(
        readFileSync(`../../dist/theme-packs/render/${id}.json`, "utf8"),
      ) as ThemeRenderPack;
      const labels = (pack.spec!.p || pack.spec!.primitives || []).filter(
        (p) =>
          p.b === "l" ||
          p.binding === "label" ||
          p.v === "{label}" ||
          p.text === "{label}",
      );
      expect(labels).toHaveLength(1);
      const p = labels[0],
        width = p.w || p.width || 240,
        font = p.f || p.font || 1;
      for (const phase of [
        "working",
        "waiting_for_answer",
        "done",
        "error",
        "idle",
        "unavailable",
      ]) {
        for (const name of ["Codex", "Claude Code"]) {
          const text = agentStatusText(phase, name);
          const size = themeTextFittedSize(
            text,
            font,
            p.s || p.fontSize || 1,
            width,
            true,
          );
          expect(
            themeFirmwareTextMetrics(text, font, size)!.width,
            text,
          ).toBeLessThanOrEqual(width);
        }
      }
    });
  }
});
