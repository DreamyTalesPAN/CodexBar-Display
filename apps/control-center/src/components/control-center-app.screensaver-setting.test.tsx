// @vitest-environment jsdom
//
// Found in review: the screensaver setting comes with the settings, which the
// app read once when it found VibeTV ready and while Settings was open. When
// that one read failed, every screensaver read "Unavailable" until the
// customer happened to open Settings.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

const pack = {
  isFree: true,
  priceLabel: "Free",
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  source: "github-catalog",
};
const themes = [
  {
    ...pack,
    id: "mini-classic",
    themeId: "mini-classic",
    title: "Mini Classic",
    packUrl: "https://example.com/mini.zip",
    themeSpecPath: "/themes/u/mini-cl-8-803dd6.json",
    usage: "live",
  },
  {
    ...pack,
    id: "retro-3d",
    themeId: "retro-3d",
    title: "Retro 3D",
    packUrl: "https://example.com/retro-3d.zip",
    themeSpecPath: "/themes/s/r3-2-0a1b2c.json",
    usage: "screensaver",
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function wait(seconds: number) {
  for (let quarter = 0; quarter < seconds * 4; quarter += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }
}

it.each([
  // The read is tried again by itself once,
  [1, 2],
  // and when that fails too, when Screensavers is opened.
  [2, 3],
])("reads the screensaver setting again after %s failed read(s), without a visit to Settings", async (failures, reads) => {
  let settingsReads = 0;
  window.localStorage.clear();
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
            display: { themeSpec: { active: true, path: themes[0].themeSpecPath } },
            // A VibeTV with the screensaver setting reports its standby state.
            standby: { active: false },
            health: { ok: true },
            capabilities: {
              standby: { supported: true },
              theme: { supportsThemeSpecV1: true },
            },
          },
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
        settingsReads += 1;
        return settingsReads <= failures
          ? jsonResponse({ ok: false, error: { code: "DEVICE_BUSY" } }, 503)
          : jsonResponse({
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
      // With the frame above, what setup's last screen waits for.
      if (url.includes("/api/theme-pack/")) {
        return jsonResponse({
          themeId: "mini-classic",
          spec: { p: [] },
          specPath: themes[0].themeSpecPath,
          assets: {},
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
      createElement(ControlCenterApp, { catalog: { themes } as never }),
    ),
  );
  await wait(10);
  expect(settingsReads).toBe(2);

  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Screensavers" }));
  await wait(2);

  expect(settingsReads).toBe(reads);
  const row = screen
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText("Retro 3D"))!;
  expect((within(row).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("switch", { name: /Show screensaver/ })).toBeTruthy();
});
