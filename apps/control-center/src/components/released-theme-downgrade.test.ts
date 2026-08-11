import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildFrameData,
  primitiveUsageSlotVisible,
  progressPercent,
  renderTextPrimitive,
  type ThemePrimitive,
} from "./live-vibetv-preview";

// Warm start puts every existing customer through a window where the Mac App is
// already the candidate but the VibeTV still runs public firmware 1.0.39 with
// the theme revision the public release installed. The live preview draws that
// stored revision, not the one this build ships, so two things must hold:
//
//  1. the exact revision on the customer's device is still retrievable, and
//  2. it still renders real numbers from a candidate Companion frame.
//
// Fail either one and the customer updates the Mac App, opens it, and looks at
// a blank or "Preview unavailable" VibeTV.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

// Device paths and revisions as installed by public release v1.0.52. Read them
// back with:
//   git show v1.0.52:theme-packs/<id>/manifest.json
type ReleasedTheme = {
  themeId: string;
  devicePath: string;
  renderPack: string;
};

const releasedThemes: ReleasedTheme[] = [
  {
    themeId: "mini-classic",
    devicePath: "/themes/u/mini-cl-1-e4fe6b.json",
    renderPack: "dist/theme-packs/render/mini-classic/mini-cl-1-e4fe6b.json",
  },
  {
    themeId: "claude-creature",
    devicePath: "/themes/u/claude--1-623de0.json",
    renderPack: "dist/theme-packs/render/claude-creature/claude--1-623de0.json",
  },
  {
    themeId: "clippy",
    devicePath: "/themes/u/clippy-1-caafce.json",
    renderPack: "dist/theme-packs/render/clippy/clippy-1-caafce.json",
  },
  {
    themeId: "synthwave",
    devicePath: "/themes/u/synthwa-1-6b39a3.json",
    renderPack: "dist/theme-packs/render/synthwave/synthwa-1-6b39a3.json",
  },
  {
    themeId: "cozy-meadow",
    devicePath: "/themes/u/cm.json",
    renderPack: "dist/theme-packs/render/cozy-meadow/cm.json",
  },
];

// What the candidate Companion puts on the wire for a two-window provider: the
// generic usageWindows plus the legacy projection that firmware 1.0.39 reads.
// Pinned on the Go side by TestV2WireFrameStaysReadableByPublicFirmware1039.
const candidateFrame = {
  v: 2,
  provider: "codex",
  label: "Codex",
  session: 42,
  weekly: 7,
  resetSecs: 15480,
  usageMode: "used",
  usageWindows: [
    { id: "secondary", label: "Weekly", percent: 42, resetSecs: 15480 },
    { id: "codex-spark-weekly", label: "Codex Spark Weekly", percent: 7, resetSecs: 604800 },
  ],
};

describe("released theme revisions survive a newer Mac App", () => {
  it.each(releasedThemes)(
    "$themeId keeps the revision installed at $devicePath retrievable",
    ({ devicePath, renderPack, themeId }) => {
      const absolute = path.join(repoRoot, renderPack);
      expect(
        existsSync(absolute),
        `no render pack for the revision customers already run: ${renderPack}`,
      ).toBe(true);
      const pack = JSON.parse(readFileSync(absolute, "utf8"));
      expect(pack.themeId).toBe(themeId);
      expect(pack.specPath).toBe(devicePath);
    },
  );

  it.each(releasedThemes)(
    "$themeId still renders live numbers from a candidate frame",
    ({ renderPack }) => {
      const pack = JSON.parse(readFileSync(path.join(repoRoot, renderPack), "utf8"));
      const frame = buildFrameData("2026-08-07T12:00:00Z", candidateFrame);
      const primitives: ThemePrimitive[] = (pack.spec.primitives || pack.spec.p || []).filter(
        (primitive: ThemePrimitive) => primitiveUsageSlotVisible(primitive, frame),
      );
      const kind = (primitive: ThemePrimitive) => primitive.type || primitive.t;
      const texts = primitives
        .filter((primitive) => kind(primitive) === "text" || kind(primitive) === "tx")
        .map((primitive) => renderTextPrimitive(primitive, frame));

      // Nothing may collapse to an unresolved placeholder.
      for (const text of texts) {
        expect(text).not.toMatch(/\{[a-zA-Z0-9_.-]+\}/);
      }
      const joined = texts.join(" | ");
      expect(joined).toContain("Codex");

      // Every released revision shows the first usage lane, some as text and
      // some as a progress bar. Whichever it uses must carry the projected
      // window value rather than falling back to zero.
      const bars = primitives
        .filter((primitive) => kind(primitive) === "progress" || kind(primitive) === "p")
        .map((primitive) => progressPercent(primitive, frame));
      const shown = [...texts, ...bars.map(String)].join(" | ");
      expect(shown, `no live usage value survived: ${shown}`).toMatch(/\b42\b/);
    },
  );
});
