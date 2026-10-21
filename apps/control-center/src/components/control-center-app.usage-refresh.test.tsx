// @vitest-environment jsdom
//
// Issue #544: after Refresh on the Usage page, the "Refreshing" mark has to go
// within a few seconds of the Mac App having the new values, not on the next
// 30 s usage read.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";
import type { UsageSnapshot } from "./control-center-types";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true };
const device = {
  active: true,
  connected: true,
  paired: true,
  ready: true,
  connectionState: "ready",
  deviceId: "16199235",
  target: "cable://vibetv",
  board: "esp8266",
  firmware: "9999.0.524",
  activeTheme: "codex",
  display: { themeSpec },
  health: { ok: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["unavailable", "pending"])("keeps the history notice dismissed through a temporary %s answer", async (interruption) => {
  const missingHistory: UsageSnapshot = {
    ok: true,
    tokenUsageReady: true,
    currentProvider: "codex",
    providers: [{ id: "codex", label: "Codex", session: 12, weekly: 34, usageMode: "used" }],
  };
  let snapshot: UsageSnapshot | null = missingHistory;
  let usageReads = 0;
  markWhatsNewSeen();
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/status")) {
      return jsonResponse({ ok: true, companion: { version: "9.9.9", installationMode: "dmg" }, device });
    }
    if (url.endsWith("/v1/display-frame/latest")) {
      return jsonResponse({ ok: true, deviceId: device.deviceId,
        frame: { v: 2, provider: "codex", label: "Codex", usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }] } });
    }
    if (url.includes("/api/theme-pack/")) {
      return jsonResponse({ themeId: "codex", spec: { p: [] }, specPath: themeSpec.path, specHash: themeSpec.hash, assets: {} });
    }
    if (url.includes("/v1/preferences")) return jsonResponse({ ok: true, items: [] });
    if (url.endsWith("/v1/provider-display")) {
      return jsonResponse({ ok: true, selection: { mode: "automatic", providerIds: [], configured: true, valid: true } });
    }
    if (url.includes("/v1/usage")) {
      usageReads += 1;
      return snapshot ? jsonResponse(snapshot)
        : jsonResponse({ ok: false, error: { code: "usage_unavailable", message: "Usage is unavailable." } }, 503);
    }
    return jsonResponse({ ok: false, error: { code: "HTTP_404" } }, 404);
  }));
  render(createElement(TooltipProvider, null,
    createElement(ControlCenterApp, { catalog: { themes: [] } as never })));
  const poll = async () => {
    const previousReads = usageReads;
    for (let second = 0; second < 31; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    }
    expect(usageReads).toBeGreaterThan(previousReads);
  };
  const notice = () => screen.queryByRole("dialog", { name: "Token history is unavailable" });

  await poll();
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  fireEvent.click(within(notice()!).getByRole("button", { name: "OK" }));
  expect(notice()).toBeNull();

  snapshot = interruption === "unavailable" ? null : { ...missingHistory, tokenUsageReady: false };
  await poll();
  expect(notice()).toBeNull();
  expect(screen.getByText(interruption === "unavailable" ? "Loading usage" : "Token history is loading")).toBeTruthy();

  snapshot = missingHistory;
  await poll();
  expect(notice()).toBeNull();

  // A real history resolves the cause; losing it afterwards is a new incident.
  snapshot = { ...missingHistory, providers: missingHistory.providers.map((provider) => ({
    ...provider, cost: { daily: [] },
  })) };
  await poll();
  expect(notice()).toBeNull();
  snapshot = missingHistory;
  await poll();
  expect(notice()).not.toBeNull();
});

it("ends the Refreshing mark within seconds of the new values", async () => {
  // The Mac App: a manual refresh stays "refreshing" until the new snapshot.
  const companion = { refreshing: false, providerReads: 0 };
  // A customer who has read "What's new"; it would lie over Overview.
  markWhatsNewSeen();
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: { version: "9.9.9", installationMode: "dmg" },
          device,
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: device.deviceId,
          frame: {
            v: 2,
            provider: "codex",
            label: "Codex",
            usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
          },
        });
      }
      if (url.includes("/api/theme-pack/")) {
        return jsonResponse({
          themeId: "codex",
          spec: { p: [] },
          specPath: themeSpec.path,
          specHash: themeSpec.hash,
          assets: {},
        });
      }
      if (url.includes("/v1/preferences")) {
        if (url.endsWith("section=providers")) {
          companion.providerReads += 1;
        }
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({
          ok: true,
          selection: { mode: "automatic", providerIds: [], configured: true, valid: true },
        });
      }
      if (url.includes("/v1/usage")) {
        if (url.endsWith("?refresh=1")) {
          companion.refreshing = true;
        }
        return jsonResponse({
          ok: true,
          usageMode: "used",
          tokenUsageReady: true,
          currentProvider: "codex",
          refresh: { state: companion.refreshing ? "refreshing" : "fresh" },
          providers: [{ id: "codex", label: "Codex", session: 12, weekly: 34, usageMode: "used" }],
        });
      }
      return jsonResponse({ ok: false, error: { code: "HTTP_404" } }, 404);
    }),
  );
  const view = render(
    createElement(
      TooltipProvider,
      null,
      createElement(ControlCenterApp, { catalog: { themes: [] } as never }),
    ),
  );
  const text = () => view.container.ownerDocument.body.textContent || "";
  const wait = async (seconds: number) => {
    for (let second = 0; second < seconds; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
  };

  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await wait(1);
  const notice = () => within(screen.getByRole("dialog", { name: "Token history is unavailable" }));
  fireEvent.click(notice().getByRole("button", { name: "Refresh" }));
  await wait(1);
  // The Refresh button of the notice dialog says "Refreshing" and is closed while it waits.
  expect(
    (screen.getByRole("button", { name: "Refreshing" }) as HTMLButtonElement).disabled,
  ).toBe(true);

  // Only usage is read faster meanwhile. Each provider read past its 10 s
  // cache starts a scan in the usage engine.
  const providerReads = companion.providerReads;
  await wait(12);
  expect(companion.providerReads - providerReads).toBeLessThanOrEqual(1);

  companion.refreshing = false;
  await wait(4);
  expect(
    (notice().getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

// OK closes a usage error once. A different error that a later read puts in
// its place shows again; the same error stays closed.
it("shows a different usage error again after OK closed the earlier one", async () => {
  let usageFailure: { code: string; message: string; nextAction: string } | null = null;
  let usageReads = 0;
  markWhatsNewSeen();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/status")) {
        return jsonResponse({ ok: true, companion: { version: "9.9.9", installationMode: "dmg" }, device });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: device.deviceId,
          frame: { v: 2, provider: "codex", label: "Codex", usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }] },
        });
      }
      if (url.includes("/api/theme-pack/")) {
        return jsonResponse({ themeId: "codex", spec: { p: [] }, specPath: themeSpec.path, specHash: themeSpec.hash, assets: {} });
      }
      if (url.includes("/v1/preferences")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({
          ok: true,
          selection: { mode: "automatic", providerIds: [], configured: true, valid: true },
        });
      }
      if (url.includes("/v1/usage")) {
        usageReads += 1;
        if (usageFailure) {
          return jsonResponse({ ok: false, error: usageFailure }, 500);
        }
        return jsonResponse({
          ok: true,
          usageMode: "used",
          tokenUsageReady: true,
          currentProvider: "codex",
          providers: [{ id: "codex", label: "Codex", session: 12, weekly: 34, usageMode: "used", cost: { daily: [{ day: "2026-07-22", totalTokens: 9 }] } }],
        });
      }
      return jsonResponse({ ok: false, error: { code: "HTTP_404" } }, 404);
    }),
  );
  render(
    createElement(
      TooltipProvider,
      null,
      createElement(ControlCenterApp, { catalog: { themes: [] } as never }),
    ),
  );

  fireEvent.click(await screen.findByRole("button", { name: "Usage" }));
  const refresh = await screen.findByRole("button", { name: "Refresh" });

  usageFailure = { code: "USAGE_READ_FAILED", message: "Usage read failed.", nextAction: "Try again." };
  fireEvent.click(refresh);
  const first = await screen.findByRole("dialog", { name: "Usage read failed." });
  fireEvent.click(within(first).getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog")).toBeNull();

  // The same error on the next read stays closed.
  const readsBefore = usageReads;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(usageReads).toBeGreaterThan(readsBefore));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(screen.queryByRole("dialog")).toBeNull();

  // A different error replaces it: it shows.
  usageFailure = { code: "USAGE_PROVIDER_FAILED", message: "Codex usage is unavailable.", nextAction: "Try again." };
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("dialog", { name: "Codex usage is unavailable." })).toBeTruthy();
});

function usageBody(session: number, weekly: number, refresh = "fresh") {
  return {
    ok: true,
    usageMode: "used",
    tokenUsageReady: true,
    currentProvider: "codex",
    refresh: { state: refresh },
    providers: [{ id: "codex", label: "Codex", session, weekly, usageMode: "used" }],
  };
}

type UsageRoute = (url: string) => Response | Promise<Response>;

// Mounts the app on a Mac App stub whose /v1/usage reads are answered by `usage`.
function mountApp(usage: UsageRoute, onProviderRead = () => {}) {
  // A customer who has read "What's new"; it would lie over Overview.
  markWhatsNewSeen();
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: { version: "9.9.9", installationMode: "dmg" },
          device,
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: device.deviceId,
          frame: {
            v: 2,
            provider: "codex",
            label: "Codex",
            usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
          },
        });
      }
      if (url.includes("/api/theme-pack/")) {
        return jsonResponse({
          themeId: "codex",
          spec: { p: [] },
          specPath: themeSpec.path,
          specHash: themeSpec.hash,
          assets: {},
        });
      }
      if (url.includes("/v1/preferences")) {
        if (url.endsWith("section=providers")) {
          onProviderRead();
        }
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({
          ok: true,
          selection: { mode: "automatic", providerIds: [], configured: true, valid: true },
        });
      }
      if (url.includes("/v1/usage")) {
        return usage(url);
      }
      return jsonResponse({ ok: false, error: { code: "HTTP_404" } }, 404);
    }),
  );
  const view = render(
    createElement(
      TooltipProvider,
      null,
      createElement(ControlCenterApp, { catalog: { themes: [] } as never }),
    ),
  );
  const text = () => view.container.ownerDocument.body.textContent || "";
  const wait = async (seconds: number) => {
    for (let second = 0; second < seconds; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
  };
  return { text, wait };
}


it("reads the setup preview frames with the usage, not from a second request", async () => {
  const frames = { generatedAt: "2026-08-13T12:00:00Z", providers: [{ id: "codex" }] };
  const { wait } = mountApp((url) =>
    jsonResponse(url.includes("previewFrames=1") ? { ...usageBody(12, 34), previewFrames: frames } : usageBody(12, 34)),
  );
  await wait(10);

  const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
  expect(urls.filter((url) => url.includes("/v1/usage")).every((url) => url.includes("previewFrames=1"))).toBe(true);
  expect(urls.some((url) => url.includes("preview-frames"))).toBe(false);
});

it("keeps the newest usage when an older read resolves last", async () => {
  let releaseOlder: (response: Response) => void = () => {};
  const { text, wait } = mountApp((url) =>
    url.includes("refresh=1")
      ? new Promise<Response>((resolve) => {
          releaseOlder = resolve;
        })
      : jsonResponse(usageBody(12, 77)),
  );
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await wait(1);
  // The customer's refresh starts first and answers last, after the poll read.
  fireEvent.click(screen.getByRole("button", { name: "Refresh token usage" }));
  await wait(35);
  expect(text()).toContain("77%");
  await act(async () => {
    releaseOlder(jsonResponse(usageBody(12, 11)));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(text()).toContain("77%");
  expect(text()).not.toContain("11%");
});

it.each([
  "usage_unavailable",
  "usage_read_failed",
  "COMPANION_UNREACHABLE",
  "LOCAL_NETWORK_ACCESS_REQUIRED",
])("ignores a superseded usage failure (%s) after a newer successful poll", async (code) => {
  let releaseOlder: (response: Response) => void = () => {};
  const { text, wait } = mountApp((url) =>
    url.includes("refresh=1")
      ? new Promise<Response>((resolve) => { releaseOlder = resolve; })
      : jsonResponse(usageBody(12, 77)),
  );
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh token usage" }));
  await wait(35);
  expect(text()).toContain("77%");
  await act(async () => {
    releaseOlder(jsonResponse({ ok: false, error: { code, message: "Obsolete usage failure", nextAction: "Obsolete recovery" } }, 503));
  });
  expect(text()).toContain("77%");
  expect(text()).not.toContain("Obsolete usage failure");
  expect(screen.getByRole("button", { name: "Refresh token usage" }).getAttribute("aria-busy")).toBe("false");
});

it("keeps a newer usage error when a superseded refresh succeeds", async () => {
  let releaseOlder: (response: Response) => void = () => {};
  let pollFails = false;
  const { text, wait } = mountApp((url) => {
    if (url.includes("refresh=1")) {
      return new Promise<Response>((resolve) => { releaseOlder = resolve; });
    }
    return pollFails
      ? jsonResponse({ ok: false, error: { code: "usage_read_failed", message: "Current usage failure", nextAction: "Current recovery" } }, 503)
      : jsonResponse(usageBody(12, 77));
  });
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh token usage" }));
  pollFails = true;
  await wait(35);
  expect(text()).toContain("Current usage failure");
  await act(async () => { releaseOlder(jsonResponse(usageBody(12, 11))); });
  expect(text()).toContain("Current usage failure");
  expect(text()).not.toContain("11%");
});

it("lets only the newest usage request finish refreshing", async () => {
  const manualReads: ((response: Response) => void)[] = [];
  const { wait } = mountApp((url) =>
    url.includes("refresh=1")
      ? new Promise<Response>((resolve) => { manualReads.push(resolve); })
      : jsonResponse(usageBody(12, 77)),
  );
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh token usage" }));
  await wait(35);
  expect(screen.getByRole("button", { name: "Refresh token usage" }).getAttribute("aria-busy")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Refresh token usage" }));
  expect(manualReads).toHaveLength(2);
  await act(async () => { manualReads[0](jsonResponse(usageBody(12, 11))); });
  expect(screen.getByRole("button", { name: "Refresh token usage" }).getAttribute("aria-busy")).toBe("true");
  await act(async () => { manualReads[1](jsonResponse(usageBody(12, 88))); });
  expect(screen.getByRole("button", { name: "Refresh token usage" }).getAttribute("aria-busy")).toBe("false");
});
