import { readdirSync, readFileSync } from "node:fs";
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
  // Paul, 20.10.2026 (via the communicator): the ring is the template's olive
  // (--ring in "Calm Redesign - alle Screens": #506600 light, #CCFF00 dark).
  it("uses the template's olive on the light theme", () => {
    expect(token(light, "ring")).toBe("#506600");
  });

  it("uses the template's lime on the dark theme", () => {
    expect(token(dark, "ring")).toBe("#CCFF00");
  });

  it("keeps at least 3:1 against the page background, in both themes", () => {
    expect(contrast(token(light, "ring"), token(light, "background"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(dark, "ring"), token(dark, "background"))).toBeGreaterThanOrEqual(3);
  });

  // Paul, 20.10.2026 (7197 review): an invalid field shows the full RED ring,
  // under the keyboard too, and as thick as the ink ring (2 px).
  it("shows the full red ring on invalid inputs with keyboard focus, in both themes", () => {
    const input = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "ui", "input.tsx"),
      "utf8",
    );
    expect(input).toContain("aria-invalid:focus-visible:ring-destructive");
    expect(input).not.toContain("aria-invalid:focus-visible:ring-ring");
    expect(contrast(token(light, "destructive"), token(light, "background"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(dark, "destructive"), token(dark, "background"))).toBeGreaterThanOrEqual(3);
  });

  // 7197 review point 4: border + a 1 px ring = 2 px, never the old 3 px halo.
  it("draws the keyboard focus ring and the invalid ring 2 px thick on the shared controls", () => {
    const uiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "ui");
    for (const name of ["input", "textarea", "select", "checkbox", "switch", "button", "tabs", "input-group"]) {
      const text = readFileSync(path.join(uiDir, `${name}.tsx`), "utf8");
      expect(text, name).not.toMatch(/focus-visible:ring-(?:2|3|\[3px\])\b/);
      expect(text, name).not.toMatch(/(?:^|[\s"])(?:aria-invalid:ring-(?:2|3)|dark:aria-invalid:ring-)/);
      expect(text, name).toMatch(/ring-1/);
    }
  });

  it("draws the default outline of native controls at full strength", () => {
    expect(css).not.toMatch(/outline-ring\/\d+/);
  });

  it("uses the light ink on the always-dark sidebar, in both themes", () => {
    expect(token(light, "sidebar-ring")).toBe(token(light, "sidebar-foreground"));
    expect(token(dark, "sidebar-ring")).toBe(token(dark, "sidebar-foreground"));
  });

  it("renders no focus ring at reduced opacity in any component", () => {
    const componentsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) files.push(full);
      }
    };
    walk(componentsDir);
    // A focus variant (focus, focus-visible, focus-within, or has-[...focus...])
    // with a ring colour that carries an opacity: the focus ring is drawn faint.
    const faintFocus =
      /^(?:focus|focus-visible|focus-within|has-\[[^\s"]*focus[^\s"]*\]|aria-invalid:focus-visible)[^\s"]*:ring-(?:ring|foreground|sidebar-ring|destructive)\/\d+$/;
    // A bare ring colour with opacity, in a class string that sets a focus ring:
    // the focus ring takes that colour, so it is faint too.
    const faintBaseRing = /^ring-(?:ring|foreground|sidebar-ring|destructive)\/\d+$/;
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const tokens = line.split(/[\s"'`{}]+/).filter(Boolean);
        for (const token of tokens) {
          if (faintFocus.test(token)) offenders.push(`${path.basename(file)}: ${token}`);
          if (line.includes("focus-visible:ring-") && faintBaseRing.test(token)) {
            offenders.push(`${path.basename(file)}: ${token} (focus base)`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the sidebar ring at least 3:1 against the sidebar, in both themes", () => {
    expect(contrast(token(light, "sidebar-ring"), token(light, "sidebar"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token(dark, "sidebar-ring"), token(dark, "sidebar"))).toBeGreaterThanOrEqual(3);
  });
});
