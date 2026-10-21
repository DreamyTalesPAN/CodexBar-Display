// @vitest-environment jsdom
//
// Observed on hardware on 2026-10-07 (Windows app): the window was paired with
// a WiFi VibeTV when the Companion was switched to another VibeTV on the
// cable. /v1/status reported the cable VibeTV as connected and ready, and the
// window still showed "Not connected" under the lost-VibeTV dialog for the
// WiFi one until it was reloaded. The Companion's connected VibeTV wins.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true };
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
      if (url.endsWith("/v1/setup/reset")) {
        return jsonResponse({ ok: true, connectionModeChoiceRequired: true });
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

// A connect error the customer closed must stay closed: each status poll
// rebuilds the pairing rejection for the same active condition (#782).
it("keeps a closed connect error closed across status polls", async () => {
  const window = startWindow();
  await window.wait(10);
  window.companion.device = {
    ...wifi,
    connected: false,
    ready: false,
    stream: { errorCode: "pairing_token_rejected" },
  } as typeof wifi;
  await window.wait(6);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);
  expect(window.text()).toContain("VibeTV could not connect.");

  fireEvent.keyDown(document, { key: "Escape" });
  await window.wait(1);
  expect(window.text()).not.toContain("VibeTV could not connect.");

  await window.wait(15);
  expect(window.companion.requests.filter((request) => request.endsWith("/v1/status")).length).toBeGreaterThan(2);
  expect(window.text()).not.toContain("VibeTV could not connect.");
});

// Settings shows the same connect dialog; its OK must keep it closed the same
// way the Support page does (#782).
it("keeps a connect error closed on Settings and shows a new one", async () => {
  const window = startWindow();
  await window.wait(10);
  const rejected = {
    ...wifi,
    connected: false,
    ready: false,
    stream: { errorCode: "pairing_token_rejected" },
  } as typeof wifi;
  window.companion.device = rejected;
  await window.wait(6);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  expect(window.text()).toContain("VibeTV could not connect.");

  fireEvent.keyDown(document, { key: "Escape" });
  await window.wait(15);
  expect(window.companion.requests.filter((request) => request.endsWith("/v1/status")).length).toBeGreaterThan(2);
  expect(window.text()).not.toContain("VibeTV could not connect.");

  // A new rejection after the VibeTV was healthy again is a new error.
  window.companion.device = wifi;
  await window.wait(6);
  window.companion.device = rejected;
  await window.wait(6);
  expect(window.text()).toContain("VibeTV could not connect.");
});

// The running app's connect dialog offers one way forward: Run setup again.
// No OK and no "Press Connect again" (#782).
it.each(["Settings", "Support"])("starts setup directly from the connect dialog on %s", async (tab) => {
  const window = startWindow();
  await window.wait(10);
  window.companion.device = {
    ...wifi,
    connected: false,
    ready: false,
    stream: { errorCode: "pairing_token_rejected" },
  } as typeof wifi;
  await window.wait(6);
  fireEvent.click(screen.getByRole("button", { name: tab }));
  await window.wait(1);
  const dialog = screen.getByRole("dialog", { name: "VibeTV could not connect." });
  expect(dialog.textContent).toContain(
    "VibeTV no longer accepts this computer. Run setup again to connect it.",
  );
  expect(dialog.textContent).not.toContain("Press Connect again");
  expect(within(dialog).queryByRole("button", { name: "OK" })).toBeNull();

  fireEvent.click(within(dialog).getByRole("button", { name: "Run setup again" }));
  await window.wait(1);
  expect(screen.queryByRole("dialog", { name: "Run setup again?" })).toBeNull();
  expect(screen.queryByRole("dialog", { name: "VibeTV could not connect." })).toBeNull();
  expect(window.companion.requests.filter((request) =>
    request === "POST /api/local-companion/v1/setup/reset",
  )).toHaveLength(1);
});

it("keeps the confirmation for the Settings Run setup again row", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
  expect(screen.getByRole("dialog", { name: "Run setup again?" })).toBeTruthy();
  expect(window.companion.requests).not.toContain("POST /api/local-companion/v1/setup/reset");
});
