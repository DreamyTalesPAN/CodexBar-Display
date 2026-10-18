import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8",
);

// Text of one theme block, from its opening line to the closing brace.
function themeBlock(opening: string): string {
  const start = css.indexOf(opening);
  if (start < 0) throw new Error(`${opening} not found`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(block);
  if (!match) throw new Error(`--${name} not found`);
  return match[1].toUpperCase();
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = themeBlock(":root {");
const dark = themeBlock(".dark {");

describe("keyboard focus ring colour", () => {
  it("uses the ink colour on the light theme", () => {
    expect(token(light, "ring")).toBe(token(light, "foreground"));
  });

  it("uses the ink colour on the dark theme", () => {
    expect(token(dark, "ring")).toBe(token(dark, "foreground"));
  });

  it("keeps at least 3:1 against the page background, in both themes", () => {
    expect(contrast(token(light, "ring"), token(light, "background"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(dark, "ring"), token(dark, "background"))).toBeGreaterThanOrEqual(3);
  });
});
