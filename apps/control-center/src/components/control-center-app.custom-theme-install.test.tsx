// @vitest-environment jsdom
//
// Found on 2026-10-08 on the Windows app: Appearance > Themes > Install on a
// theme from Theme Studio that the Mac App refuses left no message on the
// page. The theme held one imported picture as CBI1 under a .cba name.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { ThemeStudioSpec } from "@/lib/theme-studio";
import { ControlCenterApp } from "./control-center-app";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

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
// The install that finished earlier in this session; /v1/status keeps naming it.
const earlierInstall = {
  id: "job-earlier",
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

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// A connected VibeTV and the Themes page with one saved Theme Studio theme.
// Returns the theme installs this window asked the Mac App for.
async function openThemesWithSavedTheme(
  primitive: ThemeStudioSpec["primitives"][number],
  assets: Record<string, unknown> = {},
) {
  const installs: string[] = [];
  window.localStorage.clear();
  window.localStorage.setItem(
    "vibetv.controlCenter.userThemes",
    JSON.stringify({
      schemaVersion: 1,
      themes: [
        {
          id: "my-theme",
          updatedAt: "2026-10-07T00:00:00Z",
          document: {
            assets,
            packName: "My Theme",
            spec: {
              themeSpecVersion: 1,
              themeId: "my-theme",
              themeRev: 1,
              bgColor: "#000000",
              primitives: [primitive],
            },
          },
        },
      ],
    }),
  );
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
            display: { themeSpec: { active: true, path: miniClassic.themeSpecPath } },
            health: { ok: true },
            capabilities: { theme: { supportsThemeSpecV1: true } },
          },
          themeInstall: earlierInstall,
        });
      }
      if (url.includes("/v1/themes/install")) {
        installs.push(url);
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "invalid_theme_pack",
              message: "Theme file is invalid.",
              nextAction: "Export the theme again, then retry.",
            },
          },
          400,
        );
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
        });
      }
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
          specPath: miniClassic.themeSpecPath,
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
      createElement(ControlCenterApp, { catalog: { themes: [miniClassic] } as never }),
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
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Themes" }));
  await wait(2);
  return { installs, wait };
}

async function installSavedTheme(wait: (seconds: number) => Promise<void>) {
  const ownRow = screen
    .getAllByRole("listitem")
    .find((row) => within(row).queryByText("Custom"))!;
  fireEvent.click(within(ownRow).getByRole("button", { name: "Install" }));
  // Longer than the 5 second status read.
  await wait(12);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Themes saved before a single picture was named .cbi still hold it as .cba.
it("says what to do with a saved theme whose single picture is named .cba", async () => {
  const assetPath = "/themes/u/face-on-magenta.cba";
  const page = await openThemesWithSavedTheme(
    { type: "sprite", x: 176, y: 26, width: 2, height: 2, assetPath },
    {
      [assetPath]: {
        contentType: "text/plain",
        data: "CBI1\n2 2\n1\n#FF00FF\n2a\n2a\n",
        encoding: "text",
      },
    },
  );

  await installSavedTheme(page.wait);

  expect(screen.getByText("Theme action failed")).toBeTruthy();
  expect(
    screen.getByText(
      `Element 1: ${assetPath} is a single picture saved as an animation. Remove this element and import the sprite again.`,
    ),
  ).toBeTruthy();
  // The Mac App would refuse this theme file, so it is not sent at all.
  expect(page.installs).toEqual([]);
});

// The refusal never becomes an install job, and /v1/status keeps naming the
// earlier one. Needs defect2-control-center-app.patch: without it the next
// status read puts that earlier "Installed" over the failure.
it("keeps the failure dialog when the Mac App refuses a theme from Theme Studio", async () => {
  const page = await openThemesWithSavedTheme({
    type: "rect",
    x: 10,
    y: 10,
    width: 20,
    height: 20,
    color: "#FFFFFF",
  });

  await installSavedTheme(page.wait);

  expect(page.installs).toHaveLength(1);
  const dialog = screen.getByRole("dialog", { name: "Theme file is invalid." });
  expect(within(dialog).getByText("Export the theme again, then retry.")).toBeTruthy();
});
