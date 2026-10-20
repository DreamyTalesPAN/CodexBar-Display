// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DisplayModeChoice,
  type SetupDisplayModePreview,
} from "./setup-display-mode-screen";

const THEME = { id: "claude-creature", specPath: "/themes/u/claude--9-5c74ca.json" };

// One text primitive that names the provider and its first window, so what a
// tile shows is exactly what the frame carried.
const PACK = {
  assets: {},
  spec: {
    p: [{ t: "tx", x: 0, y: 0, w: 240, h: 40, s: 20, c: "#fff", v: "{label} {usage.0.percent}%" }],
  },
  specPath: THEME.specPath,
  themeId: THEME.id,
};

function live(label: string, percent: number): SetupDisplayModePreview {
  return {
    providerLabel: label,
    resetLabel: null,
    windows: [{ label: "Session", percent }],
    frame: {
      v: 1,
      provider: label.toLowerCase(),
      label,
      usageMode: "used",
      usageWindows: [{ id: "session", label: "Session", percent, resetSecs: 3600 }],
    },
    frameAt: new Date().toISOString(),
  };
}

const noValues = (label: string): SetupDisplayModePreview => ({
  providerLabel: label,
  resetLabel: null,
  windows: [],
});

function show(
  previews: SetupDisplayModePreview[],
  manual: SetupDisplayModePreview | null = previews[0] ?? null,
) {
  render(
    <DisplayModeChoice
      automaticPreview={previews[0] ?? null}
      automaticPreviews={previews}
      manualPreview={manual}
      mode="automatic"
      onSelectMode={vi.fn()}
      onSelectProvider={vi.fn()}
      providers={previews.map((preview) => ({
        id: preview.providerLabel.toLowerCase(),
        label: preview.providerLabel,
      }))}
      selectedProviderId={previews[0]?.providerLabel.toLowerCase() ?? null}
      theme={THEME}
    />,
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const tiles = (card: number) =>
  Array.from(
    document.querySelectorAll('[data-slot="display-mode-preview"]')[card]
      ?.querySelectorAll('[data-slot="display-mode-tile"]') ?? [],
  );

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => PACK }) as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Display mode tiles with the active theme", () => {
  it("draws one theme tile per provider in Automatic", async () => {
    show([live("Claude", 64), live("Codex", 28), live("Cursor", 12)]);
    await settle();

    const automatic = tiles(0);
    expect(automatic).toHaveLength(3);
    expect(automatic.map((tile) => tile.getAttribute("data-provider"))).toEqual([
      "Claude",
      "Codex",
      "Cursor",
    ]);
    expect(automatic.every((tile) => tile.getAttribute("data-state") === "live")).toBe(true);
    // Manual is one tile.
    expect(tiles(1)).toHaveLength(1);
  });

  it("passes each provider's live values through to its tile", async () => {
    show([live("Claude", 64), live("Codex", 28)]);
    await settle();

    const [claude, codex] = tiles(0);
    expect(claude.textContent).toContain("Claude");
    expect(claude.textContent).toContain("64");
    expect(codex.textContent).toContain("Codex");
    expect(codex.textContent).toContain("28");
    expect(codex.textContent).not.toContain("64");
    // The picture is the theme renderer's own.
    expect(
      screen.getAllByRole("img", { name: /Rendered VibeTV theme claude-creature showing Claude/i }),
    ).not.toHaveLength(0);
  });

  it("shows the active theme's pack for the revision the device reports", async () => {
    show([live("Claude", 64)]);
    await settle();

    const url = String(vi.mocked(fetch).mock.calls[0]?.[0]);
    expect(url).toContain("claude-creature");
    expect(url).toContain("specPath=");
  });

  it("shows a skeleton instead of numbers for a provider with no values yet", async () => {
    show([live("Claude", 64), noValues("Codex")]);
    await settle();

    const [claude, codex] = tiles(0);
    expect(claude.getAttribute("data-state")).toBe("live");
    expect(codex.getAttribute("data-state")).toBe("skeleton");
    expect(codex.textContent).not.toMatch(/\d/);
    expect(codex.querySelector("svg")).toBeNull();
    expect(screen.getByRole("img", { name: "Codex: no usage yet" })).toBeTruthy();
  });

  it("shows a skeleton for Manual when its provider has no values", async () => {
    show([live("Claude", 64)], null);
    await settle();

    expect(tiles(1)).toHaveLength(1);
    expect(tiles(1)[0].getAttribute("data-state")).toBe("skeleton");
  });

  it("keeps skeleton tiles while the theme is still loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    show([live("Claude", 64), live("Codex", 28)]);

    expect(tiles(0)).toHaveLength(2);
    expect(tiles(0).every((tile) => tile.getAttribute("data-state") === "skeleton")).toBe(true);
    expect(document.body.textContent).not.toContain("64");
  });

  it("falls back to the plain usage tiles when the theme cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    show([live("Claude", 64)]);
    await settle();

    expect(tiles(0)).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="display-mode-preview"]')[0].textContent).toContain("Claude");
  });
});
