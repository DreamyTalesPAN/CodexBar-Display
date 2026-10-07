// @vitest-environment jsdom
//
// Found on 2026-10-08: with the window open while VibeTV showed its
// screensaver, the automatic theme update installed the catalog's Mini Classic
// over the customer's own Theme Studio copy of it. Both files start with
// `mini-cl` on VibeTV, and in standby the live theme is known by its path only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { buildThemePack, importThemeSpec } from "@/lib/theme-studio";
import { ControlCenterApp } from "./control-center-app";

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../dist/theme-packs",
);
const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(dist, file), "utf8"));
// The catalog and the Mini Classic this build ships, not fixtures.
const themes = readJson("vibetv-theme-packs-v2.json").themes.map(
  (entry: { id: string; downloadAsset: string }) => ({
    ...entry,
    themeId: entry.id,
    packUrl: `/theme-packs/${entry.downloadAsset}`,
  }),
);
const published = readJson("render/mini-classic.json");
// What "Edit" on Mini Classic and "Send to VibeTV" put on the device.
const customSpec = importThemeSpec(published.spec);
customSpec.themeId = "mini-classic-custom";
const customCopyPath = buildThemePack(
  customSpec,
  "Mini Classic Custom",
  published.assets,
).manifest.themeSpec.path;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

// A ready VibeTV in standby: it draws Night Clock and reports the live slot it
// returns to. Returns the theme installs this window asked the Mac App for.
async function installsWhileInStandby(liveThemePath: string) {
  const installs: string[] = [];
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
            activeTheme: "night-clock",
            display: {
              themeSpec: { active: true, path: "/themes/s/nc-3-e18e4217.json" },
            },
            standby: {
              active: true,
              liveThemePath,
              screensaverPath: "/themes/s/nc-3-e18e4217.json",
            },
            health: { ok: true },
            capabilities: {
              theme: {
                supportsUsageSlotsV1: true,
                supportsUsageWindowsV1: true,
                supportsProviderAssetsV1: true,
                supportsColorStopsV1: true,
                supportsTextValignV1: true,
              },
            },
          },
        });
      }
      if (url.includes("/v1/themes/install")) {
        installs.push(JSON.parse(String(init?.body)).themeId);
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
  for (let second = 0; second < 10; second += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
  return installs;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps the customer's copy of Mini Classic while the screensaver is on screen", async () => {
  expect(customCopyPath).toMatch(/^\/themes\/u\/mini-cl-1-[0-9a-f]{6}\.json$/);

  expect(await installsWhileInStandby(customCopyPath)).toEqual([]);
});

it("still updates an older Mini Classic from the catalog while the screensaver is on screen", async () => {
  expect(
    await installsWhileInStandby("/themes/u/mini-cl-8-803dd6.json"),
  ).toEqual(["mini-classic"]);
});
