// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DisplayModeChoice,
  ROTATION_HOLD_MS,
  type SetupDisplayModePreview,
} from "./setup-display-mode-screen";
import { useThemeRenderPack } from "./setup-display-theme-tiles";

// #821 carousel: the Automatic tile strip rotates, Manual does not.

/** The step loads the theme pack and hands it to the choice, as the wizard does. */
function Choice(
  props: Omit<ComponentProps<typeof DisplayModeChoice>, "themePack">,
) {
  return <DisplayModeChoice {...props} themePack={useThemeRenderPack(THEME)} />;
}

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
    <Choice
      automaticPreview={previews[0] ?? null}
      automaticPreviews={previews}
      calm
      manualPreview={previews[0] ?? null}
      mode={mode}
      onSelectMode={vi.fn()}
      onSelectProvider={vi.fn()}
      providers={previews.map((preview) => ({
        id: preview.providerLabel.toLowerCase(),
        label: preview.providerLabel,
      }))}
      selectedProviderId={previews[0]?.providerLabel.toLowerCase() ?? null}
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

describe("Automatic shows one theme tile that changes provider (#821 single tile)", () => {
  const three = () => [live("Claude", 64), live("Codex", 28), live("Cursor", 12)];

  it("shows ONE tile in Automatic, the same size as Manual", async () => {
    show(three());
    await settle();
    const visible = tiles(0).filter((tile) => tile.dataset.visible === "true");
    expect(visible).toHaveLength(1);
    expect(visible[0]?.dataset.provider).toBe("Claude");
    for (const tile of tiles(0).filter((t) => t.dataset.visible !== "true")) {
      expect(tile.className).toContain("opacity-0");
      expect(tile.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("changes the provider on that tile every 2 s, with its own values", async () => {
    show(three());
    await settle();
    const shown = () => tiles(0).find((tile) => tile.dataset.visible === "true");
    expect(ROTATION_HOLD_MS).toBe(2000);
    expect(shown()?.dataset.provider).toBe("Claude");
    expect(shown()?.textContent).toContain("64");
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS - 1); });
    expect(shown()?.dataset.provider).toBe("Claude");
    act(() => { vi.advanceTimersByTime(1); });
    expect(shown()?.dataset.provider).toBe("Codex");
    expect(shown()?.textContent).toContain("28");
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS * 2); });
    expect(shown()?.dataset.provider).toBe("Claude");
  });

  it("uses the same native-size device frame in every card, with a half-size narrow fallback", async () => {
    show(three());
    await settle();
    const previews = document.querySelectorAll('[data-slot="display-mode-preview"]');
    expect(previews).toHaveLength(2);
    for (const preview of previews) {
      expect(preview.className).toContain("@container");
      const sizing = preview.firstElementChild as HTMLElement;
      expect(sizing.className).toContain("size-[120px]");
      expect(sizing.className).toContain("@min-[240px]:size-[240px]");
      expect(sizing.style.width).toBe("");
      for (const canvas of preview.querySelectorAll("svg")) {
        expect(canvas.getAttribute("viewBox")).toBe("0 0 240 240");
        expect(canvas.getAttribute("class")).toContain("[image-rendering:pixelated]");
      }
    }
    const grid = previews[0].closest("button")?.parentElement;
    expect(grid?.className).toContain("grid-cols-[repeat(auto-fit,minmax(min(100%,256px),1fr))]");
  });

  it("keeps exactly one fully visible Automatic frame at rest before and after each fade", async () => {
    show(three());
    await settle();
    for (const provider of ["Claude", "Codex", "Cursor", "Claude"]) {
      const visible = tiles(0).filter((tile) => tile.classList.contains("opacity-100"));
      expect(visible).toHaveLength(1);
      expect(visible[0].dataset.provider).toBe(provider);
      for (const hidden of tiles(0).filter((tile) => tile !== visible[0])) {
        expect(hidden.classList.contains("opacity-0")).toBe(true);
        expect(hidden.getAttribute("aria-hidden")).toBe("true");
      }
      // Past the fade, well inside the next provider's hold.
      act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS + 200); });
    }
  });

  it("uses the same size while the theme is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    show(three());
    for (const tile of [...tiles(0), ...tiles(1)]) {
      expect(tile.className).toContain("size-[120px]");
      expect(tile.className).toContain("@min-[240px]:size-[240px]");
      expect(tile.parentElement?.className).toContain("@container");
    }
  });

  it("crossfades calmly: opacity only, no movement or size change", async () => {
    show(three());
    await settle();
    for (const tile of tiles(0)) {
      expect(tile.className).toContain("transition-opacity");
      expect(tile.className).toContain("duration-[180ms]");
      expect(tile.style.transform).toBe("");
    }
  });

  it("keeps the same-size grey theme placeholder on a provider's turn without values", async () => {
    show([live("Claude", 64), { providerLabel: "Cursor", resetLabel: null, windows: [] }]);
    await settle();
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    const shown = tiles(0).find((tile) => tile.dataset.visible === "true");
    expect(shown?.dataset.provider).toBe("Cursor");
    expect(shown?.dataset.state).toBe("unavailable");
    expect(shown?.parentElement?.className).toContain("@min-[240px]:size-[240px]");
    expect(shown?.querySelector("svg")).toBeNull();
    expect(shown?.textContent).toBe("");
  });

  it("does not rotate Manual", async () => {
    show(three(), "fixed");
    await settle();
    const manual = () => tiles(1).find((tile) => tile.dataset.visible === "true")?.dataset.provider;
    const first = manual();
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS * 3); });
    expect(manual()).toBe(first);
    expect(tiles(1)).toHaveLength(1);
  });

  it("still changes provider under reduced motion, without the fade", async () => {
    reducedMotion(true);
    show(three());
    await settle();
    act(() => { vi.advanceTimersByTime(ROTATION_HOLD_MS); });
    const shown = tiles(0).find((tile) => tile.dataset.visible === "true");
    expect(shown?.dataset.provider).toBe("Codex");
    for (const tile of tiles(0)) {
      expect(tile.className).not.toContain("transition-opacity");
    }
  });
});
