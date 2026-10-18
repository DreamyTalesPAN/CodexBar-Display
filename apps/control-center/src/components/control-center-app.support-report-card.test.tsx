// @vitest-environment jsdom
//
// Support › Run diagnostics collects the same snapshot as Create report, but
// only Create report may switch the Support report card to Copy / Download.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function startApp() {
  window.localStorage.clear();
  // A customer who has read "What's new"; it would lie over Support.
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
          companion: {
            version: "9.9.9",
            installationMode: "dmg",
            features: { themeInstallEnabled: true },
          },
          device: {
            active: true,
            connected: true,
            paired: true,
            ready: true,
            connectionState: "ready",
            deviceId: "16199235",
            target: "cable://vibetv",
            board: "esp8266",
            firmware: "9999.0.524",
            activeTheme: "mini-classic",
            display: { themeSpec: { active: true, renderOk: true } },
            health: { ok: true },
          },
        });
      }
      if (url.includes("/v1/diagnostics")) {
        return jsonResponse({
          ok: true,
          generatedAt: "2026-10-18T06:00:00.000Z",
          checks: [],
        });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({
          ok: true,
          selection: { mode: "automatic", providerIds: [], configured: true, valid: true },
        });
      }
      if (url.includes("/v1/preferences?section=")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/settings")) {
        return jsonResponse({
          ok: true,
          settings: { standby: { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 } },
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: "16199235",
          frame: {
            v: 2,
            provider: "codex",
            label: "Codex",
            usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
          },
        });
      }
      if (url.includes("/v1/usage")) {
        return jsonResponse({ ok: true, usageMode: "used", providers: [] });
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
}

async function wait(seconds: number) {
  for (let quarter = 0; quarter < seconds * 4; quarter += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }
}

it("keeps Create report on the Support report card after Run diagnostics, and Create report changes it", async () => {
  startApp();
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);

  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  await wait(3);
  // Run diagnostics filled the shared snapshot; the card still offers Create report.
  expect(screen.getByRole("button", { name: "Create report" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Create report" }));
  await wait(3);
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create again" })).toBeTruthy();
});
