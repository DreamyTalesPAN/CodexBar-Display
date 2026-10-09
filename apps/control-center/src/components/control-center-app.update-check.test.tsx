// @vitest-environment jsdom
//
// Observed on hardware on 2026-10-07 (Windows app): "Check for updates" moved
// the VibeTV card's "Last checked" and left the app card's where it was. The
// app's own release is read with the status, which repeats its answer for six
// hours; only a read that says the customer asked gets a new one.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { expectKeepsFocus } from "@/test/focus";
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
const firstCheck = "2026-10-07T12:05:31Z";
const secondCheck = "2026-10-07T12:34:59Z";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function lastChecked(value: string): string {
  return `Last checked ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value))}`;
}

// The Mac App as this window sees it: its release answer only changes when a
// status read asks for a new one.
async function openUpdates() {
  const companion = {
    releaseCheckedAt: firstCheck,
    statusReads: [] as string[],
    statusReadsInFlight: 0,
    statusReadMs: 0,
    firmwareChecks: 0,
  };
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
      if (url.includes("/v1/status")) {
        companion.statusReads.push(url.slice(url.indexOf("/v1/status")));
        if (url.endsWith("?checkAppUpdate=1")) {
          companion.releaseCheckedAt = secondCheck;
        }
        const checkedAt = companion.releaseCheckedAt;
        companion.statusReadsInFlight += 1;
        await new Promise((resolve) => setTimeout(resolve, companion.statusReadMs));
        companion.statusReadsInFlight -= 1;
        return jsonResponse({
          ok: true,
          companion: {
            version: "9.9.9",
            installationMode: "dmg",
            app: { version: "9.9.9", installedInApplications: true },
            update: {
              checkedAt,
              status: "available",
              latestVersion: "9.9.9",
              installedVersion: "9.9.9",
              updateAvailable: false,
              message: "Mac App is up to date.",
            },
          },
          device,
        });
      }
      if (url.includes("/api/firmware/latest")) {
        companion.firmwareChecks += 1;
        return jsonResponse({
          checkedAt: "2026-10-07T12:34:07Z",
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
  const window = {
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
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  await window.wait(6);
  expect(window.text()).toContain(lastChecked(firstCheck));
  expect(companion.statusReads).not.toContain("/v1/status?checkAppUpdate=1");
  return window;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("Check for updates asks the app for its own release again", async () => {
  const window = await openUpdates();

  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  await window.wait(1);
  expect(window.text()).toContain(lastChecked(secondCheck));
  expect(window.text()).not.toContain(lastChecked(firstCheck));

  // Only the click asks. The reads every few seconds stay plain, so the
  // release source is not asked on each of them.
  window.companion.statusReads.length = 0;
  await window.wait(12);
  expect(window.companion.statusReads.length).toBeGreaterThan(0);
  expect(window.companion.statusReads).not.toContain("/v1/status?checkAppUpdate=1");
});

it("a click during a status read is answered by the next status read", async () => {
  const window = await openUpdates();
  window.companion.statusReadMs = 3000;
  while (window.companion.statusReadsInFlight === 0) {
    await window.wait(1);
  }

  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  await window.wait(10);
  expect(window.text()).toContain(lastChecked(secondCheck));
});

// Issue #558, seen in the Windows app: the button was disabled during its own
// check. That dropped keyboard focus to the page.
it("Check for updates keeps keyboard focus during the check and after it", async () => {
  const window = await openUpdates();
  window.companion.statusReadMs = 3000;
  const button = screen.getByRole("button", { name: "Check for updates" });
  button.focus();
  const checksBefore = window.companion.firmwareChecks;

  fireEvent.click(button);
  await window.wait(1);
  expect(button.textContent).toBe("Checking updates");
  expectKeepsFocus(button);

  // A second press during the check starts no second check.
  fireEvent.click(button);
  await window.wait(1);
  expect(window.companion.firmwareChecks).toBe(checksBefore + 1);

  await window.wait(10);
  expect(button.textContent).toBe("Check for updates");
  expectKeepsFocus(button);
});
