// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DisplayModeChoice,
  ROTATION_HOLD_MS,
  type SetupDisplayModePreview,
} from "./setup-display-mode-screen";

// #821 carousel: the Automatic tile strip rotates, Manual does not.

const THEME = { id: "claude-creature", specPath: "/themes/u/claude--9-5c74ca.json" };
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

function show(previews: SetupDisplayModePreview[], mode: "automatic" | "fixed" = "automatic") {
  render(
    <DisplayModeChoice
      automaticPreview={previews[0] ?? null}
      automaticPreviews={previews}
      manualPreview={previews[0] ?? null}
      mode={mode}
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
  ) as HTMLElement[];

/** Providers from the front tile to the back, by each tile's place in line. */
const order = (card: number) =>
  [...tiles(card)]
    .sort((a, b) => Number(a.dataset.position) - Number(b.dataset.position))
    .map((tile) => tile.dataset.provider);

function reducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => PACK }) as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Automatic theme tiles rotate as a carousel (#821 carousel)", () => {
  const three = () => [live("Claude", 64), live("Codex", 28), live("Cursor", 12)];

  it("changes the provider in front after 2 s", async () => {
    show(three());
    await settle();

    const front = () => tiles(0).find((tile) => tile.dataset.position === "0");
    expect(ROTATION_HOLD_MS).toBe(2000);
    expect(front()?.dataset.provider).toBe("Claude");
    expect(front()?.textContent).toContain("64");

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS - 1); });
    expect(front()?.dataset.provider).toBe("Claude");

    act(() => { vi.advanceTimersByTime(1); });
    expect(front()?.dataset.provider).toBe("Codex");
    expect(front()?.textContent).toContain("28");
  });

  it("rotates the order, the one that was in front going to the back", async () => {
    show(three());
    await settle();
    expect(order(0)).toEqual(["Claude", "Codex", "Cursor"]);

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(order(0)).toEqual(["Codex", "Cursor", "Claude"]);

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(order(0)).toEqual(["Cursor", "Claude", "Codex"]);

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(order(0)).toEqual(["Claude", "Codex", "Cursor"]);
  });

  it("moves tiles with transform and opacity only, sized 104 px in front and 84 px behind", async () => {
    show(three());
    await settle();
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });

    const [claude, codex] = tiles(0);
    expect(codex.className).toContain("transition-[transform,opacity]");
    expect(codex.className).toContain("duration-500");
    expect(codex.className).toContain("ease-out");
    expect(codex.className).toContain("opacity-100");
    expect(codex.style.transform).toBe("translateX(0px) scale(1)");
    expect(codex.style.width).toBe("104px");
    expect(claude.className).toContain("opacity-30");
    // Claude is now last: 104 + 10 gap + 84 + 10 gap, then scaled to 84 px.
    expect(claude.style.transform).toContain("translateX(208px)");
    expect(claude.style.transform).toContain(`scale(${84 / 104})`);
    // It fades out where it stood and in at the back instead of sliding across the others.
    expect(claude.style.animation).toContain("vibetv-tile-wrap");
    expect(claude.style.getPropertyValue("--tile-to")).toBe(claude.style.transform);
    expect(claude.style.transitionProperty).toBe("opacity");
  });

  it("keeps a provider without values as a grey placeholder while rotating", async () => {
    show([live("Claude", 64), { providerLabel: "Codex", resetLabel: null, windows: [] }]);
    await settle();
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });

    const front = tiles(0).find((tile) => tile.dataset.position === "0");
    expect(front?.dataset.provider).toBe("Codex");
    expect(front?.dataset.state).toBe("skeleton");
  });

  it("shows at most three tiles; further providers wait invisibly and rotate into view", async () => {
    // Paul, 20.10.2026: front + two behind, nothing cut off or shrunk.
    show([live("Claude", 64), live("Codex", 28), live("Cursor", 18), live("Gemini", 50), live("Copilot", 12)]);
    await settle();
    const visible = () =>
      tiles(0)
        .filter((tile) => tile.getAttribute("aria-hidden") !== "true")
        .sort((a, b) => Number(a.dataset.position) - Number(b.dataset.position))
        .map((tile) => tile.dataset.provider);
    expect(visible()).toEqual(["Claude", "Codex", "Cursor"]);
    for (const tile of tiles(0).filter((t) => Number(t.dataset.position) >= 3)) {
      expect(tile.className).toContain("opacity-0");
      expect(tile.style.transform).toBe(
        tiles(0).find((t) => t.dataset.position === "2")?.style.transform,
      );
    }
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(visible()).toEqual(["Codex", "Cursor", "Gemini"]);
  });

  it("does not rotate Manual", async () => {
    show(three(), "fixed");
    await settle();
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS * 3); });

    expect(tiles(1)).toHaveLength(1);
    expect(tiles(1)[0].dataset.position).toBe("0");
    expect(tiles(1)[0].dataset.provider).toBe("Claude");
  });

  it("still rotates under reduced motion, without a transition", async () => {
    reducedMotion(true);
    show(three());
    await settle();
    expect(order(0)).toEqual(["Claude", "Codex", "Cursor"]);

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(order(0)).toEqual(["Codex", "Cursor", "Claude"]);

    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    expect(order(0)).toEqual(["Cursor", "Claude", "Codex"]);

    for (const tile of tiles(0)) {
      expect(tile.className).not.toMatch(/transition|duration|ease-/);
      expect(tile.style.animation).toBe("");
    }
  });
});
