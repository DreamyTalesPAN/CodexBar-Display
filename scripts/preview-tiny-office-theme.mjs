#!/usr/bin/env node
// Capture SVGs emitted by the real ThemeSpecPreview component, not a mock renderer.
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/control-center/package.json"));
const { chromium } = require("playwright");
const source = path.join(root, "tmp/tiny-office-preview");
const destination = path.join(root, "docs/assets/tiny-office");
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 360 }, deviceScaleFactor: 2 });
  const states = await Promise.all(["idle", "coding"].map(async (state) => ({
    state, svg: await readFile(path.join(source, `${state}.svg`), "utf8"),
  })));
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; } body { margin: 0; background: #0b0b14; color: #ead1a0; font: 14px monospace; }
    main { width: 600px; padding: 24px; } h1 { font-size: 18px; margin: 0 0 20px; }
    section { display: flex; gap: 32px; } figure { margin: 0; } figcaption { margin-top: 10px; color: #b59cc8; }
    svg { width: 240px; height: 240px; display: block; background: #101020; image-rendering: pixelated; }
    p { color: #b59cc8; font-size: 11px; }
    </style></head><body><main><h1>Tiny Office</h1><section>${states.map(({ state, svg }) =>
      `<figure id="${state}">${svg}<figcaption>${state === "idle" ? "Idle" : "Coding"}</figcaption></figure>`
    ).join("")}</section><p>240 x 240 render preview / example data / hardware test pending</p></main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  for (const { state } of states) {
    await page.locator(`#${state} svg`).screenshot({ path: path.join(destination, `${state}-preview.png`) });
  }
  await page.locator("main").screenshot({ path: path.join(destination, "preview.png") });
  console.log("Captured both 240x240 states with the production ThemeSpecPreview renderer.");
} finally {
  await browser.close();
}
