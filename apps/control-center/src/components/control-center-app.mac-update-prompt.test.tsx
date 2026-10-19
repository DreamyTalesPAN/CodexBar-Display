// @vitest-environment jsdom
//
// Issue #566: nothing tested the automatic Mac App update prompt. In the native
// Mac App, a newer Mac App version opens the app's own update dialog once per
// offered version, also during setup, and never while a firmware update runs,
// in a normal browser, or in the hosted setup shell.
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";
import { openMacAppUpdatePrompt } from "./control-center-runtime";

const runtime = vi.hoisted(() => ({ hostedShell: false }));

vi.mock("./control-center-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./control-center-runtime")>();
  return {
    ...actual,
    openMacAppUpdatePrompt: vi.fn(),
    shouldUseHostedSetupShell: () =>
      runtime.hostedShell || actual.shouldUseHostedSetupShell(),
  };
});

const nativeUserAgent = "VibeTVControlCenter/9.9.9+100";
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
// A window before setup: no VibeTV has been found or paired yet.
const notSetUp = { active: false, connected: false, paired: false, ready: false };
const installing = {
  id: "firmware-1",
  phase: "installing",
  stage: "flash",
  progress: 40,
  startedAt: "2026-10-13T08:00:00Z",
  logs: [],
};
const complete = { ...installing, phase: "complete", progress: 100, finishedAt: "2026-10-13T08:05:00Z" };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// The Companion as this window sees it. Each status read reports the current
// values, so a test changes them between reads.
async function openApp({
  userAgent,
  setupFinished = true,
  firmwareUpdate,
}: {
  userAgent?: string;
  setupFinished?: boolean;
  firmwareUpdate?: typeof installing;
} = {}) {
  const companion = {
    device: setupFinished ? device : notSetUp,
    latestVersion: "9.9.10",
    firmwareUpdate: firmwareUpdate as typeof installing | undefined,
  };
  // A customer who has read "What's new"; it would lie over Overview.
  markWhatsNewSeen();
  vi.useFakeTimers();
  if (userAgent) {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  }
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
      if (url.includes("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: {
            version: "9.9.9",
            installationMode: "dmg",
            app: { version: "9.9.9", installedInApplications: true },
            update: {
              checkedAt: "2026-10-13T08:00:00Z",
              status: "available",
              latestVersion: companion.latestVersion,
              installedVersion: "9.9.9",
              updateAvailable: true,
              message: "A newer Mac App is available.",
            },
          },
          device: companion.device,
          firmwareUpdate: companion.firmwareUpdate,
        });
      }
      // The release check the hosted shell uses instead of the Companion status.
      if (url.includes("/api/companion/latest")) {
        return jsonResponse({
          checkedAt: "2026-10-13T08:00:00Z",
          status: "available",
          installedVersion: "9.9.9",
          latestVersion: companion.latestVersion,
          updateAvailable: true,
          message: "A newer Mac App is available.",
        });
      }
      if (url.includes("/api/firmware/latest")) {
        return jsonResponse({
          checkedAt: "2026-10-13T08:00:00Z",
          installedFirmware: device.firmware,
          latestFirmware: device.firmware,
          updateAvailable: false,
          status: "current",
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
  const wait = async (seconds: number) => {
    for (let second = 0; second < seconds; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
  };
  await wait(10);
  return {
    companion,
    wait,
    text: () => view.container.ownerDocument.body.textContent || "",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(openMacAppUpdatePrompt).mockClear();
  runtime.hostedShell = false;
});

it("opens the Mac App update prompt once when a newer Mac App is offered, during setup", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });

  expect(app.text()).toContain("Welcome to");
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);
});

it("does not open the prompt again for the same version on later status reads", async () => {
  const app = await openApp({ userAgent: nativeUserAgent });
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);

  // Later reads change nothing about the offer. A firmware update that starts
  // and ends reruns the prompt's check; the same version must not prompt again.
  app.companion.firmwareUpdate = installing;
  await app.wait(5);
  app.companion.firmwareUpdate = complete;
  await app.wait(10);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);

  // A newer version is a new offer and prompts once more.
  app.companion.latestVersion = "9.9.11";
  await app.wait(10);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(2);
});

it("does not open the prompt while a firmware update is in progress", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, firmwareUpdate: installing });
  await app.wait(20);

  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});

it("does not open the prompt in a normal browser", async () => {
  await openApp();

  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});

it("does not open the prompt in the hosted setup shell", async () => {
  runtime.hostedShell = true;
  await openApp({ userAgent: nativeUserAgent });

  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});
