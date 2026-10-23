// @vitest-environment jsdom
//
// #787: "Not now" on the "We couldn't find your VibeTV" dialog must hold for
// the whole outage. A short "starting" or inconclusive status in between is
// not a VibeTV that was found, so the dialog stays closed. Only a connected
// VibeTV ends the outage and lets the dialog come back.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true };
const connected = {
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
// The same reconnecting VibeTV in both: only the probe result differs. An
// inconclusive probe has no error code, so it is not "not found" either.
const notFound = {
  ...connected,
  connected: false,
  ready: false,
  connectionState: "reconnecting",
  stream: { errorCode: "device_not_found" },
};
const inconclusive = {
  ...connected,
  connected: false,
  ready: false,
  connectionState: "reconnecting",
  stream: { healthy: false, running: true },
};

// The companion's anti-flap grace (status.go withConfiguredConnectionState):
// a recently seen cable VibeTV stays connected: true while reconnecting.
const graceConnected = {
  ...connected,
  connected: true,
  ready: false,
  connectionState: "reconnecting",
  stream: { healthy: false, running: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

function startWindow() {
  // selectable: the Companion finds and reconnects the VibeTV on request.
  const companion = {
    device: connected as Record<string, unknown>,
    requests: [] as string[],
    selectable: false,
    selectResponseLost: false,
    selectUpdatesStatus: false,
  };
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
          deviceId: connected.deviceId,
          frame: {
            v: 2,
            provider: "codex",
            label: "Codex",
            usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
          },
        });
      }
      if (companion.selectable && url.endsWith("/v1/device/search")) {
        return jsonResponse({
          ok: true,
          devices: [{ ...connected, known: true, networkMode: "station", transport: "wifi" }],
        });
      }
      if (companion.selectable && url.endsWith("/v1/device/select")) {
        if (companion.selectUpdatesStatus) companion.device = graceConnected;
        if (companion.selectResponseLost) throw new TypeError("Failed to fetch");
        return jsonResponse({ ok: true, device: graceConnected });
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
    wait: async (seconds: number) => {
      for (let second = 0; second < seconds; second += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
    },
    container: view.container,
  };
}

const notFoundDialog = () => screen.queryByRole("dialog", { name: "We couldn't find your VibeTV" });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps Not now through an inconclusive probe of the same outage", async () => {
  const app = startWindow();
  await app.wait(10);
  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();

  fireEvent.click(within(notFoundDialog()!).getByRole("button", { name: "Not now" }));
  await app.wait(1);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = inconclusive;
  await app.wait(5);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).toBeNull();
});

it("keeps Not now through a grace-connected reconnect of the same outage", async () => {
  const app = startWindow();
  await app.wait(10);
  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();

  fireEvent.click(within(notFoundDialog()!).getByRole("button", { name: "Not now" }));
  await app.wait(1);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = graceConnected;
  await app.wait(5);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).toBeNull();
});

it("shows the not-found dialog again once VibeTV was connected and is lost again", async () => {
  const app = startWindow();
  await app.wait(10);
  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();

  fireEvent.click(within(notFoundDialog()!).getByRole("button", { name: "Not now" }));
  await app.wait(1);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = connected;
  await app.wait(10);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();
});

it("shows the not-found dialog again after a successful select reconnects VibeTV", async () => {
  const app = startWindow();
  app.companion.selectable = true;
  await app.wait(10);
  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();

  fireEvent.click(within(notFoundDialog()!).getByRole("button", { name: "Not now" }));
  await app.wait(1);
  expect(notFoundDialog()).toBeNull();

  app.companion.device = graceConnected;
  await app.wait(5);
  expect(app.companion.requests).toContain("POST /api/local-companion/v1/device/select");
  expect(notFoundDialog()).toBeNull();

  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();
});

async function dismissOutage() {
  const app = startWindow();
  await app.wait(10);
  app.companion.device = notFound;
  await app.wait(30);
  expect(notFoundDialog()).not.toBeNull();
  fireEvent.click(within(notFoundDialog()!).getByRole("button", { name: "Not now" }));
  await app.wait(1);
  expect(notFoundDialog()).toBeNull();
  return app;
}

it("a different device first seen in grace gets its own not-found notice", async () => {
  const app = await dismissOutage();
  const other = { deviceId: "16199235", target: "cable://vibetv" };
  app.companion.device = { ...graceConnected, ...other };
  await app.wait(10);
  expect(screen.getByText("VibeTV is connected")).toBeTruthy();
  expect(screen.getByText(other.deviceId)).toBeTruthy();
  app.companion.device = { ...notFound, ...other };
  await app.wait(30);
  expect(screen.getByText("Not connected")).toBeTruthy();
  expect(screen.queryAllByRole("dialog").filter(d => d !== notFoundDialog())).toHaveLength(0);
  expect(notFoundDialog()).not.toBeNull();
});

it.each([false, true])("selection resets the dismissal (response lost: %s)", async (responseLost) => {
  const app = await dismissOutage();
  app.companion.device = graceConnected;
  await app.wait(5);
  app.companion.selectable = true;
  app.companion.selectResponseLost = responseLost;
  app.companion.selectUpdatesStatus = true;
  app.companion.device = notFound;
  await app.wait(30);
  expect(app.companion.requests.filter((r) => r.endsWith("/v1/device/select"))).toHaveLength(1);
  expect(screen.getByText("VibeTV is connected")).toBeTruthy();
  app.companion.selectable = false;
  app.companion.device = notFound;
  await app.wait(5);
  expect(screen.getByText("Not connected")).toBeTruthy();
  expect(screen.queryAllByRole("dialog").filter(d => d !== notFoundDialog())).toHaveLength(0);
  expect(notFoundDialog()).not.toBeNull();
});
