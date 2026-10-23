// @vitest-environment jsdom
//
// Found on 2026-10-23 in the real app (acceptance 7216, FAIL 4.10): after
// "Theme is active on VibeTV." the setup's Install button read "Install" again,
// enabled, for about a second until Display mode appeared. The install action
// reads the settings and the VibeTV once more before the step moves on, and the
// settings read took the app's one busy state away from the install.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

const miniClassic = {
  id: "mini-classic",
  themeId: "mini-classic",
  title: "Mini Classic",
  isFree: true,
  priceLabel: "Free",
  packUrl: "https://vibetv.shop/theme-packs/mini.zip",
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  source: "github-catalog",
  themeSpecPath: "/themes/u/mini-cl-8-803dd6.json",
  usage: "live",
};
const job = {
  id: "job-1",
  themeId: "mini-classic",
  themeName: "Mini Classic",
  slot: "live",
  phase: "complete",
  message: "Theme is active on VibeTV.",
  progress: 100,
  logs: ["Theme is active on VibeTV."],
  result: {
    themeId: "mini-classic",
    packId: "mini-classic",
    name: "Mini Classic",
    activePath: miniClassic.themeSpecPath,
    themeRev: 8,
  },
};
// The VibeTV before it draws the theme, and after it confirmed it.
const waiting = {
  active: true,
  connected: true,
  paired: true,
  ready: false,
  connectionState: "connected",
  deviceId: "16199235",
  target: "cable://vibetv",
  board: "esp8266",
  firmware: "9999.0.7216",
  activeTheme: "theme-missing",
  display: { themeSpec: { active: false } },
  health: { ok: true },
  capabilities: { theme: { supportsThemeSpecV1: true } },
};
const confirmed = {
  ...waiting,
  ready: true,
  activeTheme: "mini-classic",
  display: {
    themeSpec: { active: true, path: miniClassic.themeSpecPath, renderOk: true },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// The Mac App as the window sees it, with the two reads that follow a finished
// install held until the test lets them answer.
async function installFromSetup() {
  const answers = { device: waiting as typeof waiting | typeof confirmed };
  const held = { settings: Promise.withResolvers<void>(), device: Promise.withResolvers<void>() };
  let installed = false;
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
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: {
            version: "9.9.9",
            installationMode: "dmg",
            features: { themeInstallEnabled: true },
          },
          device: waiting,
        });
      }
      if (url.includes("/v1/themes/install/status")) {
        installed = true;
        return jsonResponse({ ok: true, job });
      }
      if (url.includes("/v1/themes/install") && init?.method === "POST") {
        return jsonResponse({ ok: true, job: { ...job, phase: "installing", result: undefined } }, 202);
      }
      if (url.endsWith("/v1/settings")) {
        if (installed) {
          await held.settings.promise;
        }
        return jsonResponse({
          ok: true,
          settings: { standby: { enabled: false, timeoutMinutes: 1, brightnessPercent: 20 } },
          device: { deviceId: waiting.deviceId },
        });
      }
      if (url.endsWith("/v1/device")) {
        await held.device.promise;
        return jsonResponse({ ok: true, device: answers.device });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: waiting.deviceId,
          frame: {
            v: 2,
            provider: "codex",
            label: "Codex",
            usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
          },
        });
      }
      if (url.includes("/v1/preferences?section=")) {
        return jsonResponse({ ok: true, items: [] });
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
      createElement(ControlCenterApp, { catalog: { themes: [miniClassic] } as never }),
    ),
  );
  const wait = async (milliseconds: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  };
  await wait(10_000);
  expect(screen.getByText("Choose your theme")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Mini Classic/ }));
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  // The install job answers "complete"; the settings and the VibeTV are being
  // read for the confirmation.
  await wait(1_000);
  expect(screen.getByText(/Theme is active on VibeTV\./)).toBeTruthy();
  return { answers, held, wait };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps the button installing from the finished install until VibeTV confirms the theme", async () => {
  const { answers, held, wait } = await installFromSetup();
  const button = () => screen.getByRole("button", { name: "Installing" }) as HTMLButtonElement;
  expect(button().disabled).toBe(true);

  held.settings.resolve();
  await wait(100);
  expect(button().disabled).toBe(true);

  answers.device = confirmed;
  held.device.resolve();
  await wait(100);
  expect(screen.queryByText("Choose your theme")).toBeNull();
});

it("offers Install again when VibeTV does not confirm the theme", async () => {
  const { held, wait } = await installFromSetup();
  expect((screen.getByRole("button", { name: "Installing" }) as HTMLButtonElement).disabled).toBe(true);

  held.settings.resolve();
  held.device.resolve();
  await wait(100);
  const button = screen.getByRole("button", { name: "Install" }) as HTMLButtonElement;
  expect(button.disabled).toBe(false);
});
