// @vitest-environment jsdom
//
// Issue #544: after Refresh on the Usage page, "Refreshing usage" has to go
// within a few seconds of the Mac App having the new values, not on the next
// 30 s usage read.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterApp } from "./control-center-app";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7" };
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

it("ends Refreshing usage within seconds of the new values", async () => {
  // The Mac App: a manual refresh stays "refreshing" until the new snapshot.
  const companion = { refreshing: false, providerReads: 0 };
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
  fireEvent.click(screen.getByRole("button", { name: "Refresh token usage" }));
  await wait(1);
  expect(text()).toContain("Refreshing usage");

  // Only usage is read faster meanwhile. Each provider read past its 10 s
  // cache starts a scan in the usage engine.
  const providerReads = companion.providerReads;
  await wait(12);
  expect(companion.providerReads - providerReads).toBeLessThanOrEqual(1);

  companion.refreshing = false;
  await wait(4);
  expect(text()).not.toContain("Refreshing usage");
});
