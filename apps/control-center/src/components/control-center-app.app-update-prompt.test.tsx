// @vitest-environment jsdom
//
// A newer app on offer. The Mac App opens Sparkle's dialog by itself, once per
// version, and the customer answers it there. The Windows App installs behind
// the same link without a question, so it must not be sent there unasked: it
// installs at launch (#565), on Update or from the tray item.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

const CHECK_FOR_UPDATES = "vibetv://check-for-updates";
// Since #619 the Mac App's automatic prompt asks for the quiet check (#570).
const CHECK_FOR_UPDATES_IN_BACKGROUND = "vibetv://check-for-updates-in-background";
const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true };
const claude = {
  id: "codexbar.providers.claude.enabled",
  section: "providers",
  owner: "codexbar",
  type: "boolean",
  label: "Claude",
  providerId: "claude",
  value: true,
  effectiveValue: true,
  allowsDefault: false,
  availability: { state: "available" },
  health: { state: "healthy", service: "operational", message: "Provider is working." },
  writeStrategy: "codexbar_command",
  writable: true,
};
const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// Every address the page sends the window to; jsdom navigates nowhere.
function watchNavigation(): string[] {
  const opened: string[] = [];
  const page = new URL(window.location.href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new Proxy(page, {
      get: (target, key) => {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set: (target, key, value) => {
        if (key === "href") {
          opened.push(String(value));
          return true;
        }
        return Reflect.set(target, key, value);
      },
    }),
  });
  return opened;
}

// The app window, installed in the native shell, with 1.0.65 published while
// 1.0.64 runs.
function startApp(os: "darwin" | "windows") {
  markWhatsNewSeen();
  const opened = watchNavigation();
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "VibeTVControlCenter/1.0.64+1064",
  });
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
            version: "1.0.64",
            installationMode: "dmg",
            app: { version: "1.0.64", installedInApplications: true },
            runtime: { os },
            update: {
              checkedAt: "2026-10-14T12:00:00Z",
              status: "available",
              release: "v1.0.65",
              latestVersion: "1.0.65",
              installedVersion: "1.0.64",
              updateAvailable: true,
              message: "Mac App update is available.",
            },
          },
          setup: { providerSelectionRequired: false, providerSelectionComplete: true },
          device: {
            active: true,
            connected: true,
            paired: true,
            ready: true,
            connectionState: "ready",
            deviceId: "16199235",
            target: "cable://vibetv",
            board: "esp8266",
            firmware: "1.0.64",
            activeTheme: "codex",
            display: { themeSpec },
            health: { ok: true },
          },
        });
      }
      if (url.includes("/api/firmware/latest")) {
        return jsonResponse({
          checkedAt: "2026-10-14T12:00:00Z",
          installedFirmware: "1.0.64",
          latestFirmware: "1.0.64",
          updateAvailable: false,
          status: "current",
        });
      }
      if (url.endsWith("/v1/preferences?section=providers")) {
        return jsonResponse({ ok: true, items: [claude] });
      }
      if (url.endsWith("/v1/preferences?section=display")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({
          ok: true,
          selection: { mode: "fixed", providerIds: ["claude"], configured: true, valid: true },
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: "16199235",
          frame: {
            v: 2,
            provider: "claude",
            label: "Claude",
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
      if (url.includes("/v1/usage")) {
        return jsonResponse({
          ok: true,
          usageMode: "used",
          providers: [
            { id: "claude", label: "Claude", session: 12, weekly: 34, resetSecs: 0, usageMode: "used" },
          ],
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
  return {
    opened,
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
  window.localStorage.clear();
  if (originalLocation) {
    Object.defineProperty(window, "location", originalLocation);
  }
  if (originalUserAgent) {
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  } else {
    Reflect.deleteProperty(navigator, "userAgent");
  }
});

it("asks the Mac App for its quiet update check once for the offered version", async () => {
  const app = startApp("darwin");
  await app.wait(15);
  expect(app.opened).toEqual([CHECK_FOR_UPDATES_IN_BACKGROUND]);
});

it("installs nothing in the Windows App until the customer clicks Update", async () => {
  const app = startApp("windows");
  await app.wait(15);
  expect(app.opened).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  await app.wait(1);
  const update = screen.getByRole("link", { name: "Update" });
  expect(update.getAttribute("href")).toBe(CHECK_FOR_UPDATES);
});
