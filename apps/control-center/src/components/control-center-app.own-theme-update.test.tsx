// @vitest-environment jsdom
//
// The automatic update must never install a catalog theme over a theme the
// customer made. What makes a file on VibeTV theirs is the library saved in
// this browser: it is the file one of their saved themes is sent under.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ownThemePaths } from "@/lib/active-theme-upgrade";
import { rememberSentOwnThemePath } from "@/lib/sent-own-theme-paths";
import { createBlankThemeSpec, type ThemeStudioUsage } from "@/lib/theme-studio";
import {
  writeUserThemes,
  type UserThemeRecord,
} from "@/lib/theme-studio-storage";
import { ControlCenterApp } from "./control-center-app";
import type { DeviceInfo } from "./control-center-types";

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../dist/theme-packs",
);
// The catalog this build ships, not a fixture.
const themes = JSON.parse(
  readFileSync(path.join(dist, "vibetv-theme-packs-v2.json"), "utf8"),
).themes.map(
  (entry: { id: string; downloadAsset: string; themeSpecPath: string }) => ({
    ...entry,
    themeId: entry.id,
    packUrl: `/theme-packs/${entry.downloadAsset}`,
  }),
);
const catalogPath = (themeId: string): string =>
  themes.find((theme: { themeId: string }) => theme.themeId === themeId)
    .themeSpecPath;

// A theme or screensaver as Theme Studio saves it in the library.
function saved(themeId: string, usage: ThemeStudioUsage): UserThemeRecord {
  return {
    document: {
      assets: {},
      packName: "My Own",
      spec: { ...createBlankThemeSpec(), themeId },
      ...(usage === "screensaver" ? { usage } : {}),
    },
    id: themeId,
    updatedAt: "2026-10-08T00:00:00Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

// A ready, awake VibeTV that draws the current Mini Classic unless `device`
// says otherwise. Returns the theme installs this window asked the Mac App for.
async function automaticInstalls(
  device: Partial<DeviceInfo>,
  library: UserThemeRecord[] = [],
) {
  const installs: string[] = [];
  writeUserThemes(library);
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
            activeTheme: "mini-classic",
            display: {
              themeSpec: { active: true, path: catalogPath("mini-classic") },
            },
            health: { ok: true },
            capabilities: {
              theme: {
                supportsUsageSlotsV1: true,
                supportsUsageWindowsV1: true,
                supportsProviderAssetsV1: true,
                supportsColorStopsV1: true,
                supportsTextValignV1: true,
                supportsProgressArcV1: true,
              },
            },
            ...device,
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
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// A later catalog can give one of its themes the id of a theme the customer
// saved earlier. Awake, VibeTV names both by that id.
it("keeps a saved theme of the customer that has the id of a catalog theme", async () => {
  const own = saved("mini-classic", "live");
  const [path] = ownThemePaths([own]);
  expect(path).toMatch(/^\/themes\/u\/mini-cl-1-/);

  expect(
    await automaticInstalls(
      { display: { themeSpec: { active: true, path } } },
      [own],
    ),
  ).toEqual([]);
});

// Edited and saved since it was sent, the theme has another id and path in
// the library, while VibeTV still reports the shared id and the file that was
// sent. What tells that file from a first revision of the catalog theme is
// that this app sent it.
it("keeps a theme of the customer that was edited and saved since it was sent", async () => {
  const [sentPath] = ownThemePaths([saved("mini-classic", "live")]);
  const device = { display: { themeSpec: { active: true, path: sentPath } } };

  rememberSentOwnThemePath(sentPath);
  expect(
    await automaticInstalls(device, [saved("mini-classic-2", "live")]),
  ).toEqual([]);
});

// Mini Classic as public release v1.0.52 shipped it.
it("still updates a catalog theme that VibeTV holds in its first revision", async () => {
  expect(
    await automaticInstalls({
      display: {
        themeSpec: { active: true, path: "/themes/u/mini-cl-1-e4fe6b.json" },
      },
    }),
  ).toEqual(["mini-classic"]);
});

// Token Fire 0.1.3 was shipped as tf-1-874fd8e2.
it("updates a catalog screensaver that VibeTV still holds in its first revision", async () => {
  expect(
    await automaticInstalls({
      standby: { screensaverPath: "/themes/s/tf-1-874fd8e2.json" },
    }),
  ).toEqual(["token-fire"]);
});

// Its file is rcf-1-<hash>, beside the catalog's Reset Countdown, rcf-6.
it("keeps a saved screensaver of the customer whose file name starts like a catalog one", async () => {
  const own = saved("rcf", "screensaver");
  const [screensaverPath] = ownThemePaths([own]);
  expect(catalogPath("reset-countdown")).toMatch(/^\/themes\/s\/rcf-\d+-/);
  expect(screensaverPath).toMatch(/^\/themes\/s\/rcf-1-/);

  expect(await automaticInstalls({ standby: { screensaverPath } }, [own])).toEqual(
    [],
  );
});
