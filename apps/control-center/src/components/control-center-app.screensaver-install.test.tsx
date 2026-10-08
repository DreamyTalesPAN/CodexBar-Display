// @vitest-environment jsdom
//
// Issue #558, seen on the Windows app on 2026-10-08: Install on Retro 3D under
// Appearance > Screensavers read "Preparing theme install.", and Support filed
// it under Recent activity as "Theme install started".
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
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
    id: "synthwave",
    themeId: "synthwave",
    title: "Synthwave",
    packUrl: "https://example.com/synthwave.zip",
    themeSpecPath: "/themes/u/synthw-2-4d5e6f.json",
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

const job = { id: "job-1", phase: "installing", progress: 40 };

// The app beside a connected VibeTV. `install` is an install the Mac App names
// with its status, as it does for one that runs when the window is opened.
function startApp(install?: Record<string, unknown>) {
  // The Mac App answers an install from this window only once the test lets it.
  let answerInstall: (response: Response) => void = () => {};
  const app = {
    answerInstall: (response: Response) => answerInstall(response),
    // What the Mac App says about the named install when it is asked.
    install,
    wait: async (seconds: number) => {
      for (let quarter = 0; quarter < seconds * 4; quarter += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250);
        });
      }
    },
  };
  window.localStorage.clear();
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
            health: { ok: true },
            capabilities: {
              standby: { supported: true },
              theme: { supportsThemeSpecV1: true },
            },
          },
          themeInstall: app.install,
        });
      }
      if (url.includes("/v1/themes/install/status")) {
        // An install from this window ends without the Mac App saying why.
        return jsonResponse({ ok: true, job: app.install ?? { ...job, phase: "error" } });
      }
      if (url.includes("/v1/themes/install")) {
        return new Promise<Response>((resolve) => {
          answerInstall = resolve;
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
        return jsonResponse({
          ok: true,
          settings: { standby: { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 } },
        });
      }
      // What setup's last screen waits for before it hands over to the app.
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
  return app;
}

it.each([
  ["Screensavers", "Retro 3D", "Screensaver", "Theme"],
  ["Themes", "Synthwave", "Theme", "Screensaver"],
])("words an install under %s for what it installs", async (section, title, noun, other) => {
  const { answerInstall, wait } = startApp();
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: section }));
  await wait(2);

  const row = screen
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(title))!;
  fireEvent.click(within(row).getByRole("button", { name: "Install" }));
  await wait(1);
  expect(screen.getByText(`Preparing ${noun.toLowerCase()} install.`)).toBeTruthy();

  answerInstall(jsonResponse({ ok: true, job }, 202));
  await wait(3);
  const failed = screen.getByRole("dialog", { name: `${noun} install failed.` });
  fireEvent.click(within(failed).getByRole("button", { name: "Close" }));
  await wait(1);

  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);
  expect(screen.getByText(`${noun} install started`)).toBeTruthy();
  expect(screen.getByText(`${noun} install needs attention`)).toBeTruthy();
  expect(screen.queryByText(new RegExp(`${other} install`))).toBeNull();
});

// The Mac App names an install that is still running when the window is opened
// again, and the page follows it from there.
it.each([
  ["screensaver", "retro-3d", "Screensaver", "Theme"],
  ["live", "synthwave", "Theme", "Screensaver"],
])("words an install picked up again in the %s slot for what it installs", async (slot, themeId, noun, other) => {
  const app = startApp({ ...job, slot, themeId });
  await app.wait(10);
  // The start screen shows the install's lines until it has ended.
  expect(screen.getByText(`> Preparing ${noun.toLowerCase()} install.`)).toBeTruthy();

  // It ends without the Mac App saying why.
  app.install = { ...app.install, phase: "error" };
  await app.wait(6);
  const failed = screen.getByRole("dialog", { name: `${noun} install failed.` });
  expect(
    within(failed).getByText(
      `Keep VibeTV connected and try installing the ${noun.toLowerCase()} again.`,
    ),
  ).toBeTruthy();
  fireEvent.click(within(failed).getByRole("button", { name: "Close" }));

  // The next one runs longer than the seven and a half minutes the page asks
  // about it, and then finishes.
  app.install = { ...job, id: "job-2", slot, themeId };
  await act(async () => {
    await vi.advanceTimersByTimeAsync(460_000);
  });
  app.install = { ...app.install, phase: "complete" };
  await app.wait(2);

  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await app.wait(2);
  expect(screen.getAllByText(`${noun} install needs attention`)).toHaveLength(2);
  expect(
    screen.getByText(`Keep VibeTV powered on, then check the ${noun.toLowerCase()} again.`),
  ).toBeTruthy();
  expect(screen.getByText(`${noun} installed`)).toBeTruthy();
  expect(screen.queryByText(new RegExp(`${other} install`))).toBeNull();
});
