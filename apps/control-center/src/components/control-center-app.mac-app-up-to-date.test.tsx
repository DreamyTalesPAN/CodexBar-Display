// @vitest-environment jsdom
//
// Codex review on #784: when the hosted release check runs without an installed
// Mac App version, it still answers "available" with no update. Overview then
// said "Up to date" although nothing was compared. Only a known installed
// version may show that line.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { rememberCompletedSetup } from "@/lib/completed-setup-devices";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

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
  display: { themeSpec: { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true } },
  health: { ok: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// A Companion that reports no app version, or 9.9.9 installed in Applications.
// The default hosted check only echoes a version when the request sent one.
// Failure cases reproduce an independent hosted download check beside the runtime.
async function openOverview({
  installedVersion,
  hostedFailure = false,
  installedInApplications = true,
  runtimeFailure = false,
}: {
  installedVersion?: string;
  hostedFailure?: boolean;
  installedInApplications?: boolean;
  runtimeFailure?: boolean;
}) {
  markWhatsNewSeen();
  rememberCompletedSetup(device.deviceId);
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
      if (url.includes("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: {
            installationMode: "dmg",
            ...(installedVersion
              ? {
                  version: installedVersion,
                  app: { version: installedVersion, installedInApplications },
                  ...(hostedFailure ? { update: {
                    checkedAt: "2026-10-21T08:00:00Z",
                    status: runtimeFailure ? "check_failed" : "available",
                    latestVersion: installedVersion,
                    installedVersion,
                    updateAvailable: false,
                    message: runtimeFailure ? "Mac App check failed." : "Mac App is up to date.",
                  } } : {}),
                }
              : {}),
          },
          device,
        });
      }
      if (url.includes("/api/companion/latest")) {
        if (hostedFailure) return jsonResponse({ checkedAt: "2026-10-21T08:00:00Z", status: "check_failed", dmgDownloadStatus: "check_failed", updateAvailable: false, message: "Mac App check failed." });
        return jsonResponse({
          checkedAt: "2026-10-21T08:00:00Z",
          status: "available",
          latestVersion: "9.9.9",
          installedVersion,
          updateAvailable: false,
          message: "Mac App is up to date.",
        });
      }
      if (url.includes("/v1/updates/install")) {
        return jsonResponse({ ok: true, job: { id: "test-update", phase: "complete", message: "Update complete.", logs: [] } });
      }
      if (url.includes("/api/firmware/latest") || url.includes("/v1/updates/latest")) {
        if (hostedFailure) return jsonResponse({ checkedAt: "2026-10-21T08:00:00Z", status: "update_available", installedFirmware: device.firmware, latestFirmware: "9999.0.525", updateAvailable: true });
        return jsonResponse({ checkedAt: "2026-10-21T08:00:00Z", status: "check_failed", updateAvailable: false });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({ ok: true, deviceId: device.deviceId, frame: { v: 2, provider: "codex", label: "Codex", usageSlots: [] } });
      }
      if (url.includes("/api/theme-pack/")) {
        return jsonResponse({ themeId: "codex", spec: { p: [] }, specPath: "/themes/codex/spec-v7.json", specHash: "hash-v7", assets: {} });
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
  for (let second = 0; second < 10; second += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("does not call the Mac App up to date when no installed version was compared", async () => {
  await openOverview({});
  expect(document.body.textContent).toContain("Mac App");
  expect(document.body.textContent).not.toContain("Up to date");
});

it("calls the Mac App up to date when its installed version was compared", async () => {
  await openOverview({ installedVersion: "9.9.9" });
  expect(document.body.textContent).toContain("Up to date");
});


it("starts the firmware update from the healthy installed runtime even when the hosted DMG check fails", async () => {
  await openOverview({ installedVersion: "9.9.9", hostedFailure: true });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Updates" })); });
  expect(document.body.textContent).not.toContain("Update check failed");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Update" })); });
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes("/v1/updates/install") && init?.method === "POST")).toBe(true);
});

it("keeps the hosted download failure blocking outside the installed runtime path", async () => {
  await openOverview({ installedVersion: "9.9.9", hostedFailure: true, installedInApplications: false });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Updates" })); });
  expect(document.body.textContent).toContain("Update check failed");
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes("/v1/updates/install") && init?.method === "POST")).toBe(false);
});


it("keeps a failed installed runtime check blocking the firmware update", async () => {
  await openOverview({ installedVersion: "9.9.9", hostedFailure: true, runtimeFailure: true });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Updates" })); });
  expect(document.body.textContent).toContain("Update check failed");
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes("/v1/updates/install") && init?.method === "POST")).toBe(false);
});
