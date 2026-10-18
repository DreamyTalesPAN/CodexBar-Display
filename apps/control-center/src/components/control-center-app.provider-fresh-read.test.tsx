// @vitest-environment jsdom
//
// PR #700 (Codex P1): a fresh=1 read of the provider list must not be joined
// to a plain poll that is already in flight. Otherwise a plugin installed or
// removed while the engine runs stays out of the list until a restart.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function provider(providerId: string, label: string) {
  return {
    id: `codexbar.providers.${providerId}.enabled`,
    section: "providers",
    owner: "codexbar",
    type: "boolean",
    label,
    providerId,
    value: true,
    effectiveValue: true,
    allowsDefault: false,
    availability: { state: "available" },
    health: { state: "healthy", service: "operational", message: "Provider is working." },
    writeStrategy: "codexbar_command",
    writable: true,
  };
}

// The first provider read is held until the test releases it; it still lists
// only Codex, as if the plugin had not been found yet. Reads with fresh=1 answer
// at once with the list that includes Claude.
type Harness = {
  providerReads: string[];
  releasePlainRead: () => void;
  releaseFirstFreshRead: () => void;
  openTab: (name: string) => void;
  text: () => string;
  wait: (seconds: number) => Promise<void>;
  setDeviceReady: (ready: boolean) => void;
};

async function openSetupWithDeviceSearching(): Promise<Harness> {
  return openHarness({ setup: true });
}

async function openSettingsWithHeldPlainRead(): Promise<Harness> {
  return openHarness({ setup: false });
}

async function openHarness({
  setup,
  failFirstFresh = false,
  holdFirstFresh = false,
}: {
  setup: boolean;
  failFirstFresh?: boolean;
  holdFirstFresh?: boolean;
}): Promise<Harness> {
  const providerReads: string[] = [];
  let freshReads = 0;
  let deviceReady = !setup;
  let pluginInstalled = false;
  let releasePlainRead: () => void = () => {};
  const plainRead = new Promise<void>((resolve) => {
    releasePlainRead = resolve;
  });
  let releaseFirstFreshRead: () => void = () => {};
  const firstFreshRead = new Promise<void>((resolve) => {
    releaseFirstFreshRead = resolve;
  });
  const companion = {
    selection: { mode: "automatic", providerIds: ["codex", "claude"], configured: true, valid: true },
  };
  markWhatsNewSeen();
  vi.useFakeTimers();
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("VibeTVControlCenter/1.2.3+45");
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
        if (!deviceReady) {
          return jsonResponse({
            ok: true,
            companion: { version: "9.9.9", installationMode: "dmg" },
            setup: { providerSelectionRequired: true, providerSelectionComplete: false },
            device: null,
          });
        }
        return jsonResponse({
          ok: true,
          companion: { version: "9.9.9", installationMode: "dmg" },
          setup: setup
            ? { providerSelectionRequired: true, providerSelectionComplete: false }
            : undefined,
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
            activeTheme: "codex",
            display: { themeSpec },
            health: { ok: true },
          },
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
        return jsonResponse({ themeId: "codex", spec: { p: [] }, specPath: themeSpec.path, specHash: themeSpec.hash, assets: {} });
      }
      if (url.includes("/v1/preferences?section=providers")) {
        providerReads.push(url);
        if (url.includes("fresh=1")) {
          freshReads += 1;
          if (holdFirstFresh && freshReads === 1) {
            await firstFreshRead;
          }
          if (failFirstFresh && freshReads === 1) {
            return jsonResponse({ ok: false, error: { code: "BUSY" } }, 500);
          }
          return jsonResponse({
            ok: true,
            items: [provider("codex", "Codex"), provider("claude", "Claude")],
          });
        }
        if (!setup) {
          await plainRead;
        }
        // After the plugin is installed, the cached read would list it too.
        return jsonResponse({
          ok: true,
          items: pluginInstalled
            ? [provider("codex", "Codex"), provider("claude", "Claude")]
            : [provider("codex", "Codex")],
        });
      }
      if (url.endsWith("/v1/preferences?section=display")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({ ok: true, selection: companion.selection });
      }
      if (url.includes("/v1/usage")) {
        return jsonResponse({
          ok: true,
          usageMode: "used",
          providers: ["codex", "claude"].map((id) => ({
            id, label: id, session: 12, weekly: 34, resetSecs: 0, usageMode: "used",
          })),
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
  if (!setup) {
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  }
  await wait(1);
  return {
    providerReads,
    releasePlainRead,
    releaseFirstFreshRead,
    openTab: (name: string) => fireEvent.click(screen.getByRole("button", { name })),
    text: () => view.container.ownerDocument.body.textContent || "",
    wait,
    setDeviceReady: (ready: boolean) => {
      deviceReady = ready;
      // The plugin is installed while the device is found: only a fresh read sees it.
      pluginInstalled = ready && setup;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("a fresh provider read waits for a plain read in flight and then asks CodexBar again", async () => {
  const settings = await openSettingsWithHeldPlainRead();
  // Opening Settings starts a plain poll; the fresh read must not be joined to it.
  expect(settings.providerReads.some((url) => url.includes("fresh=1"))).toBe(false);

  // The held plain read finishes with the stale list; the fresh read follows.
  settings.releasePlainRead();
  await settings.wait(2);

  expect(settings.providerReads.filter((url) => url.includes("fresh=1"))).toHaveLength(1);
  expect(settings.text()).toContain("Claude");
});

it("a fresh provider read is sent when the Providers step opens, not while the device is still searched", async () => {
  const setup = await openSetupWithDeviceSearching();
  // The device is still being searched: the Providers step is not shown yet.
  expect(setup.providerReads.some((url) => url.includes("fresh=1"))).toBe(false);

  // The device answers; the Providers step opens and the list is read fresh.
  setup.setDeviceReady(true);
  await setup.wait(20);

  expect(setup.providerReads.filter((url) => url.includes("fresh=1"))).toHaveLength(1);
  expect(setup.text()).toContain("Claude");
});

it("a fresh provider read that fails is sent again by a later poll", async () => {
  const setup = await openHarness({ setup: true, failFirstFresh: true });
  setup.setDeviceReady(true);
  await setup.wait(30);

  // The first fresh read failed; a later poll asked again, and the list shows.
  expect(setup.providerReads.filter((url) => url.includes("fresh=1")).length).toBeGreaterThanOrEqual(2);
  expect(setup.text()).toContain("Claude");
});

it("a provider list opened again while an earlier fresh read is pending gets its own fresh read", async () => {
  const settings = await openHarness({ setup: false, holdFirstFresh: true });
  // The first opening's fresh read is sent and stays pending.
  settings.releasePlainRead();
  await settings.wait(2);
  expect(settings.providerReads.filter((url) => url.includes("fresh=1"))).toHaveLength(1);

  // The customer leaves Settings and opens it again; a plugin may have changed
  // in between, so the old read does not cover this opening.
  settings.openTab("Updates");
  await settings.wait(1);
  settings.openTab("Settings");
  await settings.wait(1);
  settings.releaseFirstFreshRead();
  await settings.wait(3);

  expect(settings.providerReads.filter((url) => url.includes("fresh=1"))).toHaveLength(2);
});
