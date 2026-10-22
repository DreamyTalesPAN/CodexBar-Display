// @vitest-environment jsdom
//
// Setup ends on Overview only when the customer came from Updates. Settings and
// Appearance stay where they are, whatever the wizard did before it finished.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { rememberCompletedSetup } from "@/lib/completed-setup-devices";
import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));
// The wizard is stubbed: its only job here is to hand over to finishSetup.
vi.mock("./setup/setup-wizard", async () => {
  const { createElement } = await import("react");
  return {
    SetupWizard: (props: { onFinished: () => void; onConnectionComplete: () => void }) =>
      createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: props.onConnectionComplete }, "Connection done"),
        createElement("button", { type: "button", onClick: props.onFinished }, "Finish setup"),
      ),
  };
});

const DEVICE_ID = "16199235";
const miniClassic = {
  id: "mini-classic",
  themeId: "mini-classic",
  title: "Mini Classic",
  isFree: true,
  priceLabel: "Free",
  packUrl: "/theme-packs/mini.zip",
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  source: "github-catalog",
  themeSpecPath: "/themes/u/mini-cl-8-803dd6.json",
  usage: "live",
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// The status a connected, ready VibeTV reports. The test sets the job fields.
let statusJobs: Record<string, unknown> = {};

// Mounts the app with a ready device and returns a helper that advances time.
async function mountApp({ initialThemeId }: { initialThemeId?: string } = {}) {
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
            deviceId: DEVICE_ID,
            target: "cable://vibetv",
            board: "esp8266",
            firmware: "9999.0.524",
            activeTheme: "mini-classic",
            display: { themeSpec: { active: true, path: miniClassic.themeSpecPath, renderOk: true } },
            health: { ok: true },
            capabilities: { theme: { supportsThemeSpecV1: true } },
          },
          ...statusJobs,
        });
      }
      if (url.endsWith("/v1/setup/connection-mode")) {
        return jsonResponse({ ok: true, status: "waiting_for_wifi", deviceId: DEVICE_ID });
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
          settings: { standby: { enabled: false, timeoutMinutes: 1, brightnessPercent: 20 } },
          device: { deviceId: DEVICE_ID },
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: DEVICE_ID,
          frame: { v: 2, provider: "codex", label: "Codex", usageSlots: [] },
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
      createElement(ControlCenterApp, {
        catalog: { themes: [miniClassic] } as never,
        initialThemeId,
      }),
    ),
  );
  const wait = async (seconds: number) => {
    for (let quarter = 0; quarter < seconds * 4; quarter += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
    }
  };
  await wait(10);
  return { wait };
}

function activeTab(name: string) {
  const button = screen.getByRole("button", { name });
  return button.getAttribute("aria-current") === "page" || button.getAttribute("data-active") === "true";
}

async function finishSetup(wait: (seconds: number) => Promise<void>) {
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  await wait(1);
}

afterEach(() => {
  cleanup();
  statusJobs = {};
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("ends setup on Overview after a firmware update seen during setup", async () => {
  statusJobs = {
    firmwareUpdate: { id: "fw-1", phase: "installing", progress: 40, logs: [] },
  };
  const page = await mountApp();
  await finishSetup(page.wait);

  expect(activeTab("Overview")).toBe(true);
});

it("keeps Appearance and its failure dialog when a theme install fails during setup", async () => {
  statusJobs = {
    themeInstall: {
      id: "theme-1",
      themeId: "mini-classic",
      themeName: "Mini Classic",
      slot: "live",
      phase: "installing",
      progress: 10,
      logs: [],
    },
  };
  const page = await mountApp();

  statusJobs = {
    themeInstall: {
      id: "theme-1",
      themeId: "mini-classic",
      themeName: "Mini Classic",
      slot: "live",
      phase: "error",
      message: "Theme file is invalid.",
      progress: 10,
      logs: [],
      error: {
        code: "invalid_theme_pack",
        message: "Theme file is invalid.",
        nextAction: "Export the theme again, then retry.",
      },
    },
  };
  await page.wait(12);
  await finishSetup(page.wait);

  expect(activeTab("Appearance")).toBe(true);
  const dialog = screen.getByRole("dialog", { name: "Theme file is invalid." });
  expect(within(dialog).getByText("Export the theme again, then retry.")).toBeTruthy();
});

it("keeps Settings when the WiFi switch in Settings re-enters the wizard", async () => {
  const page = await mountApp();
  await finishSetup(page.wait);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await page.wait(1);

  const modeGroup = screen.getByRole("group", { name: "Connection mode" });
  fireEvent.click(within(modeGroup).getByRole("button", { name: /WiFi/ }));
  fireEvent.click(screen.getByRole("button", { name: "Switch to WiFi" }));
  await page.wait(1);
  expect(screen.getByRole("button", { name: "Finish setup" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Connection done" }));
  await finishSetup(page.wait);

  expect(activeTab("Settings")).toBe(true);
});

it("returns to Settings when a firmware update during a Settings WiFi switch ends setup (#905)", async () => {
  const page = await mountApp();
  await finishSetup(page.wait);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await page.wait(1);

  const modeGroup = screen.getByRole("group", { name: "Connection mode" });
  fireEvent.click(within(modeGroup).getByRole("button", { name: /WiFi/ }));
  fireEvent.click(screen.getByRole("button", { name: "Switch to WiFi" }));
  await page.wait(1);
  // The WiFi switch leaves the device waiting; the firmware update then runs.
  statusJobs = {
    device: { active: true, connected: false, paired: false, ready: false, connectionState: "waiting_for_wifi", deviceId: DEVICE_ID, target: "cable://vibetv" },
    firmwareUpdate: { id: "fw-1", phase: "installing", progress: 40, logs: [] },
  };
  await page.wait(12);
  statusJobs = {};
  await page.wait(12);
  fireEvent.click(screen.getByRole("button", { name: "Connection done" }));
  await finishSetup(page.wait);

  expect(activeTab("Settings")).toBe(true);
});

it("keeps Appearance after a reload that opens a theme, while setup is still open", async () => {
  const page = await mountApp({ initialThemeId: "mini-classic" });

  await finishSetup(page.wait);

  expect(activeTab("Appearance")).toBe(true);
});

it("leaves a theme deep link alone when setup was remembered", async () => {
  rememberCompletedSetup(DEVICE_ID);
  const page = await mountApp({ initialThemeId: "mini-classic" });

  await finishSetup(page.wait);

  expect(activeTab("Appearance")).toBe(true);
});
