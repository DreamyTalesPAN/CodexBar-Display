// @vitest-environment jsdom

import type { UsageSnapshot } from "../control-center-types";

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayPreviewsFor, pinnedPreview, type PreviewFrames } from "./setup-display-previews";
import {
  DisplayModeChoice,
  SetupDisplayModeScreen,
  type SetupDisplayModePreview,
} from "./setup-display-mode-screen";
import { useThemeRenderPack } from "./setup-display-theme-tiles";

/** The step loads the theme pack and hands it to the choice, as the wizard does. */
function Choice(
  props: Omit<ComponentProps<typeof DisplayModeChoice>, "themePack">,
) {
  return <DisplayModeChoice {...props} themePack={useThemeRenderPack(THEME)} />;
}

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
  const frame = {
    v: 1,
    provider: label.toLowerCase(),
    label,
    usageMode: "used",
    usageWindows: [{ id: "session", label: "Session", percent, resetSecs: 3600 }],
  };
  return {
    providerLabel: label,
    resetLabel: null,
    windows: [{ label: "Session", percent }],
    frame,
    pinnedFrame: frame,
    frameAt: new Date().toISOString(),
  };
}

// The companion answered with no values for this provider: an error frame, so
// the card does not wait on it.
const noValues = (label: string): SetupDisplayModePreview => ({
  providerLabel: label,
  resetLabel: null,
  windows: [],
  frame: { v: 1, error: "no usage yet" },
});

function show(
  previews: SetupDisplayModePreview[],
  manual: SetupDisplayModePreview | null = previews[0] ?? null,
) {
  render(
    <Choice
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
  it("renders Companion-retained values after collection fails", async () => {
    const sent = live("Codex", 31);
    const retained = { ...sent.frame!, resetTrust: "offline", resetTrustSecs: 600, resetSource: "codex:primary" };
    show(displayPreviewsFor(
      { providers: [{ id: "codex", label: "Codex", session: 0, weekly: 0, stale: true, usageUnavailable: true }] } as UsageSnapshot,
      [{ id: "codex", label: "Codex" }],
      { generatedAt: sent.frameAt, providers: [{ id: "codex", automatic: retained, pinned: retained }] },
    ));
    await settle();
    for (const card of [0, 1]) {
      expect(tiles(card)[0].getAttribute("data-state")).toBe("live");
      expect(tiles(card)[0].textContent).toContain("31");
    }
  });

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

  it("leaves a provider without values unavailable instead of loading forever", async () => {
    show([live("Claude", 64), noValues("Codex")]);
    await settle();

    const [claude, codex] = tiles(0);
    expect(claude.getAttribute("data-state")).toBe("live");
    expect(codex.getAttribute("data-state")).toBe("unavailable");
    expect(codex.textContent).not.toMatch(/\d/);
    expect(codex.querySelector("svg")).toBeNull();
    // Codex waits behind Claude on the one tile until its turn (#821 single tile).
    expect(screen.getByRole("img", { name: "Codex: no usage yet", hidden: true })).toBeTruthy();
  });

  it("shows the existing no-usage state for Manual when its provider has no values", async () => {
    show([live("Claude", 64)], null);
    await settle();

    expect(tiles(1)).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="display-mode-preview"]')[1].textContent).toContain("No usage yet");
  });

  it("shows final unavailable state, not a loading skeleton, for an error frame", async () => {
    // The companion sends an error frame when every provider is unavailable
    // and no last-good frame exists (#858).
    show([{ ...noValues("Claude"), frame: { v: 1, error: "no usage yet" } }]);
    await settle();

    const [claude] = tiles(0);
    expect(claude.getAttribute("data-state")).toBe("unavailable");
    expect(claude.textContent).not.toMatch(/\d/);
    expect(screen.getAllByRole("img", { name: "Claude: no usage yet", hidden: true })).not.toHaveLength(0);
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

  it("loads on supported WebKit versions without AbortSignal.any", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any")!;
    Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
    try {
      show([live("Claude", 64)]);
      await settle();
      expect(tiles(0)[0]?.getAttribute("data-state")).toBe("live");
    } finally {
      Object.defineProperty(AbortSignal, "any", descriptor);
    }
  });

  it.each(["response", "body"])("releases Continue when the pack %s hangs, then retries", async (phase) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    let ready = false;
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      if (ready) return Promise.resolve({ ok: true, json: async () => PACK } as Response);
      requestSignal = init?.signal;
      const pending = new Promise<never>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(
          phase === "body" ? new DOMException("Body aborted", "AbortError") : requestSignal?.reason,
        ), { once: true });
      });
      return phase === "response"
        ? pending
        : Promise.resolve(Object.assign(new Response(), { json: () => pending }));
    }));
    const preview = live("Claude", 64);
    const { unmount } = render(<SetupDisplayModeScreen
      automaticPreview={preview}
      automaticPreviews={[preview]}
      manualPreview={preview}
      mode="automatic"
      onContinue={vi.fn()}
      onSelectMode={vi.fn()}
      onSelectProvider={vi.fn()}
      providers={[{ id: "claude", label: "Claude" }]}
      selectedProviderId="claude"
      theme={THEME}
    />);
    const continueButton = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(continueButton().disabled).toBe(true);
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    expect(requestSignal?.aborted).toBe(true);
    expect(document.querySelector('[data-state="skeleton"]')).toBeNull();
    expect(continueButton().disabled).toBe(false);

    // A retry that also hangs must not put the step back behind a skeleton.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(continueButton().disabled).toBe(false);
    expect(document.querySelector('[data-state="skeleton"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    ready = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    expect(tiles(0)[0].getAttribute("data-state")).toBe("live");
    expect(continueButton().disabled).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending request on unmount without scheduling a retry", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
      });
    }));
    show([live("Claude", 64)]);
    cleanup();
    await settle();

    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
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
