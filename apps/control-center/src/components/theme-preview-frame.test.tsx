// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  PreviewFrameProvider,
  ThemeSpecPreview,
  type DisplayFrameSnapshot,
  type ThemeRenderPack,
} from "./live-vibetv-preview";

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pack: ThemeRenderPack = {
  spec: { primitives: [{ type: "text", binding: "label", x: 0, y: 0, fontSize: 2 }] },
  assets: {},
};

function shown(snapshot: DisplayFrameSnapshot | null) {
  const { container } = render(
    <PreviewFrameProvider snapshot={snapshot}>
      <ThemeSpecPreview animate={false} pack={pack} status="ready" themeId="t" />
    </PreviewFrameProvider>,
  );
  return container.textContent;
}

const claude: DisplayFrameSnapshot = {
  ok: true,
  savedAt: new Date().toISOString(),
  frame: {
    v: 2,
    provider: "claude",
    label: "Claude",
    session: 40,
    weekly: 10,
    usageSlots: [{ id: "session", label: "Session", percent: 40, resetSecs: 3600 }],
  },
};

it("shows the selected provider from the live frame, not VibeTV", () => {
  expect(shown(claude)).toBe("Claude");
});

it("shows used/remaining for Two at once exactly like the device frame", () => {
  const pair = { ...claude.frame!, provider: "codex+claude", label: "" };
  expect(shown({ ...claude, frame: { ...pair, usageMode: "used" } })).toBe("used");
  cleanup();
  expect(shown({ ...claude, frame: { ...pair, usageMode: "remaining" } })).toBe("remaining");
});

it("has no invented provider without a live frame", () => {
  expect(shown(null)).toBe("");
});
