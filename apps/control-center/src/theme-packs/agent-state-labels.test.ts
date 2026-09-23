import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { agentStatusText } from "@/lib/agent-theme-state";
import {
  themeFirmwareTextMetrics,
  themeTextFittedSize,
  type ThemeRenderPack,
} from "@/components/live-vibetv-preview";

const root = path.resolve(process.cwd(), "../..");
const animatedStates = ["idle", "coding", "needs_you", "done", "error"] as const;

describe("status labels in real theme slots", () => {
  for (const id of [
    "tiny-office",
    "mini-classic",
    "claude-creature",
    "clippy",
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
      if (id === "clippy") {
        // The drawn window buttons begin at x=193 in cp-bg.cbi.
        expect((p.x || 0) + width).toBeLessThanOrEqual(190);
      }
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

describe.each(["claude-creature", "clippy"])("%s animated agent states", (id) => {
  it("ships five distinct, moving states in the current catalog revision", () => {
    const catalog = JSON.parse(readFileSync(
      path.join(root, "dist/theme-packs/vibetv-theme-packs-v2.json"), "utf8",
    )) as { themes: { id: string; version: string; themeRev: number; themeSpecPath: string }[] };
    const current = catalog.themes.find((theme) => theme.id === id);
    const manifest = JSON.parse(readFileSync(
      path.join(root, "theme-packs", id, "manifest.json"), "utf8",
    )) as { version: string; themeSpec: { path: string }; assets: { path: string }[] };
    const sourceSpec = JSON.parse(readFileSync(
      path.join(root, "theme-packs", id, "theme.json"), "utf8",
    )) as { rev: number };
    const pack = JSON.parse(readFileSync(
      path.join(root, "dist/theme-packs/render", `${id}.json`), "utf8",
    )) as ThemeRenderPack;

    expect(current).toBeDefined();
    expect(pack.spec?.rev).toBe(current!.themeRev);
    expect(sourceSpec.rev).toBe(current!.themeRev);
    expect(pack.specPath).toBe(current!.themeSpecPath);
    expect(manifest.themeSpec.path).toBe(current!.themeSpecPath);
    expect(manifest.version).toBe(current!.version);

    const sprites = (pack.spec?.p || pack.spec?.primitives || []).filter((p) => p.t === "sp" && p.sa);
    expect(sprites).toHaveLength(1);
    const stateAssets = sprites[0].sa || {};
    const paths: string[] = [];
    const contents: string[] = [];
    for (const state of animatedStates) {
      const assetPath = stateAssets[state];
      expect(assetPath, `${id} ${state} needs its own asset`).toBeTruthy();
      expect(manifest.assets.some((asset) => asset.path === assetPath)).toBe(true);
      const asset = pack.assets?.[assetPath];
      expect(asset, `${id} ${state} must exist in the render pack`).toBeDefined();
      const lines = asset!.data.trimEnd().split("\n");
      expect(lines[0], `${id} ${state} must be animated`).toBe("CBA1");
      const [width, height, frameCount, fps] = lines[1].split(" ").map(Number);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(frameCount).toBeGreaterThan(1);
      expect(fps).toBeGreaterThan(0);
      const paletteSize = Number(lines[2]);
      const rows = lines.slice(3 + paletteSize);
      expect(rows).toHaveLength(height * frameCount);
      const frames = Array.from({ length: frameCount }, (_, index) =>
        rows.slice(index * height, (index + 1) * height).join("\n"),
      );
      expect(new Set(frames).size, `${id} ${state} must visibly move`).toBeGreaterThan(1);
      paths.push(assetPath);
      contents.push(asset!.data);
    }
    expect(new Set(paths).size, `${id} must not reuse an idle path`).toBe(animatedStates.length);
    expect(new Set(contents).size, `${id} must not reuse idle art`).toBe(animatedStates.length);
  });
});
