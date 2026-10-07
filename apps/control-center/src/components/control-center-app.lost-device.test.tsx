// @vitest-environment jsdom
//
// Observed on hardware on 2026-10-07 (Windows app): the window was paired with
// a WiFi VibeTV when the Companion was switched to another VibeTV on the
// cable. /v1/status reported the cable VibeTV as connected and ready, and the
// window still showed "Not connected" under the lost-VibeTV dialog for the
// WiFi one until it was reloaded. The Companion's connected VibeTV wins.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterApp } from "./control-center-app";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7" };
const wifi = {
  active: true,
  connected: true,
  paired: true,
  ready: true,
  connectionState: "ready",
  deviceId: "16198106",
  target: "http://192.168.178.183",
  board: "esp8266",
  firmware: "9999.0.524",
  activeTheme: "codex",
  display: { themeSpec },
  health: { ok: true },
};
const wifiLost = { ...wifi, connected: false, ready: false };
const cable = { ...wifi, deviceId: "16199235", target: "cable://vibetv" };
const notFound = {
  code: "device_not_found",
  message: "No VibeTV device was found.",
  nextAction:
    "Restart VibeTV, wait until it shows WiFi connected, then run setup again.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

// The Companion as this window sees it: only `device` changes during a test.
function startWindow() {
  const companion = { device: wifi, requests: [] as string[] };
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
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      companion.requests.push(`${init?.method || "GET"} ${url}`);
      if (url.endsWith("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: { version: "9.9.9", installationMode: "dmg" },
          device: companion.device,
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: companion.device.deviceId,
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
      if (url.endsWith("/v1/device/search")) {
        return jsonResponse({
          ok: true,
          devices: [
            { ...wifi, known: true, networkMode: "station", transport: "wifi" },
            { ...cable, transport: "cable" },
          ],
        });
      }
      if (url.endsWith("/v1/device/select")) {
        return jsonResponse({ ok: false, error: notFound }, 404);
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
  return {
    companion,
    text: () => view.container.ownerDocument.body.textContent || "",
    wait: async (seconds: number) => {
      for (let second = 0; second < seconds; second += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("closes the lost-VibeTV dialog once status reports a connected cable VibeTV", async () => {
  const window = startWindow();
  await window.wait(10);
  expect(window.text()).toContain("VibeTV is connected");

  window.companion.device = wifiLost;
  await window.wait(30);
  expect(window.companion.requests).toContain(
    "POST /api/local-companion/v1/device/select",
  );
  expect(window.text()).toContain(notFound.message);
  expect(window.text()).toContain("Previously connected");
  expect(window.text()).not.toContain("VibeTV is connected");

  window.companion.device = cable;
  await window.wait(10);
  expect(window.text()).toContain("VibeTV is connected");
  expect(window.text()).not.toContain(notFound.message);
  expect(window.text()).not.toContain("Previously connected");

  // Settings and Support read the same error and must not show the failed
  // connect over the connected VibeTV either.
  for (const tab of ["Settings", "Support"]) {
    fireEvent.click(screen.getByRole("button", { name: tab }));
    await window.wait(1);
    expect(window.text()).not.toContain(notFound.message);
  }
});

it("follows a connection changed to another VibeTV without calling the first one lost", async () => {
  const window = startWindow();
  await window.wait(10);
  expect(window.text()).toContain("VibeTV is connected");

  window.companion.device = cable;
  await window.wait(30);
  expect(window.text()).toContain("VibeTV is connected");
  expect(window.companion.requests).not.toContain(
    "POST /api/local-companion/v1/device/search",
  );
});
