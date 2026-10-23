import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  THEME_CATALOG_PREVIEW_FRAME,
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "../../../apps/control-center/src/components/live-vibetv-preview";

const directory = path.dirname(fileURLToPath(import.meta.url));
const packDirectory = path.join(directory, "pack");
const outputDirectory = path.join(directory, "out");

it("renders Fuel at 0, 50 and 100 percent in the Control Center preview component", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(packDirectory, "manifest.json"), "utf8"),
  ) as {
    name: string;
    themeSpec: { file: string };
    assets: Array<{ path: string; file: string; contentType?: string }>;
  };
  const pack: ThemeRenderPack = {
    ok: true,
    themeId: "fuel",
    name: manifest.name,
    spec: JSON.parse(readFileSync(path.join(packDirectory, manifest.themeSpec.file), "utf8")),
    assets: Object.fromEntries(manifest.assets.map((asset) => [asset.path, {
      contentType: asset.contentType ?? "text/plain",
      data: readFileSync(path.join(packDirectory, asset.file), "utf8"),
      encoding: "text" as const,
    }])),
  };
  const sections = [0, 50, 100].map((percent) => {
    const frame = {
      ...THEME_CATALOG_PREVIEW_FRAME,
      provider: "codex",
      label: "Codex",
      session: percent,
      usageWindows: THEME_CATALOG_PREVIEW_FRAME.usageWindows.map((window, index) =>
        index === 0 ? { ...window, percent } : window),
      usageSlot1Percent: percent,
      usageSlot1Available: true,
    };
    const svg = renderToStaticMarkup(
      createElement(ThemeSpecPreview, { animate: false, frame, pack, status: "ready", themeId: "fuel" }),
      { identifierPrefix: `fuel-${percent}-` },
    );
    const angle = percent === 0 ? 270 : percent === 50 ? 0 : 90;
    expect(svg).toContain(`rotate(${angle} 120 150)`);
    expect(svg).toContain("Codex");
    expect(svg.replace(/<[^>]*>/g, "")).toContain(`Codex${percent}%`);
    return `<section><h2>${percent}% used</h2>${svg}</section>`;
  }).join("");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(path.join(outputDirectory, "control-center.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Fuel — Control Center preview component</title>
<style>
body{margin:0;padding:32px;background:#e9e9e7;color:#222;font:16px system-ui}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#555}
main{display:flex;gap:24px}section{width:360px}h2{font-size:16px;font-weight:500}
section>svg{display:block;width:360px;height:360px;image-rendering:pixelated}
</style><h1>Fuel · Control Center preview component</h1>
<p>Browser fixture from existing v1.15.0 ZIP · provider codex · label Codex · 0 / 50 / 100% used</p>
<main>${sections}</main></html>`);
});
