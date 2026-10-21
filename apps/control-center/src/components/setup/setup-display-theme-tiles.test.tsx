// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayPreviewsFor, pinnedPreview, type PreviewFrames } from "./setup-display-previews";
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

  it("draws the frames the companion returned, also for an enabled provider without a reading", async () => {
    const payload: PreviewFrames = {
      generatedAt: new Date().toISOString(),
      providers: [
        {
          id: "codex",
          automatic: { v: 2, provider: "codex", label: "Codex", usageWindows: [{ id: "session", label: "Session", percent: 28, resetSecs: 3600 }] },
          pinned: { v: 2, provider: "codex", label: "Codex", usageWindows: [{ id: "session", label: "Session", percent: 31, resetSecs: 3600 }] },
        },
        {
          id: "gemini",
          automatic: { v: 2, provider: "gemini", label: "Gemini", usageUnavailable: true, resetTrust: "stale" },
          pinned: { v: 2, provider: "gemini", label: "Gemini", usageUnavailable: true, resetTrust: "stale" },
        },
      ],
    };
    const fetchFrames = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }) as Response);
    const previews = displayPreviewsFor(
      { providers: [] },
      [{ id: "codex", label: "Codex" }, { id: "gemini", label: "Gemini" }],
      await (await fetchFrames()).json(),
    );
    show(previews, pinnedPreview(previews[0]));
    await settle();

    expect(tiles(0)).toHaveLength(2);
    expect(tiles(0).map((tile) => tile.getAttribute("data-state"))).toEqual(["live", "live"]);
    expect(tiles(0)[0].textContent).toContain("28");
    expect(tiles(0)[1].textContent).toContain("Gemini");
    // Manual draws the frame the host builds with the provider pinned.
    expect(tiles(1)[0].textContent).toContain("31");
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
    // Codex waits behind Claude on the one tile until its turn (#821 single tile).
    expect(screen.getByRole("img", { name: "Codex: no usage yet", hidden: true })).toBeTruthy();
  });

  it("shows a skeleton for Manual when its provider has no values", async () => {
    show([live("Claude", 64)], null);
    await settle();

    expect(tiles(1)).toHaveLength(1);
    expect(tiles(1)[0].getAttribute("data-state")).toBe("skeleton");
  });

  it("keeps a skeleton tile while the theme is still loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    show([live("Claude", 64), live("Codex", 28)]);

    expect(tiles(0)).toHaveLength(1);
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

describe("Display mode tiles keep time-dependent fields moving", () => {
  const NIGHT_PACK = {
    ...PACK,
    spec: {
      p: [
        { t: "tx", x: 0, y: 0, w: 240, h: 20, s: 20, c: "#fff", b: "tm" },
        { t: "tx", x: 0, y: 30, w: 240, h: 20, s: 20, c: "#fff", pl: 1, b: "pv1l" },
        { t: "tx", x: 0, y: 60, w: 240, h: 20, s: 20, c: "#fff", pl: 1, b: "pv1r" },
        { t: "tx", x: 0, y: 90, w: 240, h: 20, s: 20, c: "#fff", pl: 2, b: "pv2l" },
        { t: "tx", x: 0, y: 120, w: 240, h: 20, s: 20, c: "#fff", pl: 2, b: "pv2r" },
      ],
    },
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  function withSlots(): SetupDisplayModePreview {
    const base = live("Claude", 64);
    return {
      ...base,
      frame: {
        ...base.frame!,
        providerSlots: [
          { id: "claude", label: "Claude", percent: 64, resetSecs: 3 * 3600 },
          { id: "codex", label: "Codex", percent: 28, resetSecs: 5 * 3600 },
        ],
      },
    };
  }

  it("draws the provider rows a night-clock style theme binds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => NIGHT_PACK }) as Response),
    );
    show([withSlots()]);
    await settle();

    const text = tiles(0)[0].textContent ?? "";
    expect(text).toContain("Claude");
    expect(text).toContain("Codex");
    expect(text).toContain("3h 0m");
    expect(text).toContain("5h 0m");
  });

  it("counts the reset down as time passes, also under reduced motion", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => NIGHT_PACK }) as Response),
    );
    const preview = withSlots();
    preview.frameAt = "2026-10-20T08:00:00Z";
    show([preview]);
    await settle();

    expect(tiles(0)[0].textContent).toContain("3h 0m");

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    const text = tiles(0)[0].textContent ?? "";
    expect(text).toContain("2h 58m");
    expect(text).toContain("4h 58m");
    expect(text).not.toContain("3h 0m");
  });
});

describe("Display mode tiles retry a theme pack that is not ready yet", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the theme once the Companion answers after failing at first", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    let up = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        up
          ? ({ ok: true, status: 200, json: async () => PACK } as Response)
          : ({ ok: false, status: 503 } as Response),
      ),
    );
    show([live("Claude", 64)]);
    await settle();
    // The plain tile stands in while the theme cannot be read.
    expect(tiles(0)).toHaveLength(0);

    up = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(tiles(0)).toHaveLength(1);
    expect(tiles(0)[0].getAttribute("data-state")).toBe("live");
  });

  it("asks again when the first answer is the previous theme revision", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    let current = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => (current ? PACK : { ...PACK, specPath: "/themes/u/claude--8-old.json" }),
          }) as Response,
      ),
    );
    show([live("Claude", 64)]);
    await settle();
    expect(tiles(0)).toHaveLength(0);

    current = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await settle();

    expect(tiles(0)).toHaveLength(1);
  });
});

describe("Display mode tiles run out their countdown on every clock tick", () => {
  const RESET_PACK = {
    ...PACK,
    spec: {
      p: [{ t: "tx", x: 0, y: 0, w: 240, h: 40, s: 20, c: "#fff", v: "{reset}" }],
    },
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  function withDeadline(frameAt: string, resetSecs: number): SetupDisplayModePreview {
    const base = live("Claude", 0);
    return {
      ...base,
      frameAt,
      frame: {
        ...base.frame!,
        resetSecs,
        resetTrust: "live",
        resetTrustSecs: 5 * 3600,
        resetSource: "claude",
        usageWindows: [{ id: "session", label: "Session", percent: 0, resetSecs }],
      },
    };
  }

  async function open(preview: SetupDisplayModePreview) {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => RESET_PACK }) as Response),
    );
    show([preview]);
    await settle();
  }

  it("says Reset unavailable once the last deadline runs out while the screen is open", async () => {
    await open(withDeadline("2026-10-20T08:00:00Z", 30));
    expect(tiles(0)[0].textContent).not.toContain("Reset unavailable");

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    expect(tiles(0)[0].textContent).toContain("Reset unavailable");
    expect(tiles(0)[0].textContent).not.toContain("No active session");
  });
});
