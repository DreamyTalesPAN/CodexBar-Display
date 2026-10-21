// @vitest-environment jsdom
//
// Issue #183: Settings reads the app's own display preferences from the
// registry, saves a change at once, and keeps the stored value when the write
// is refused.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_STUDIO_DRAFT_STORAGE_KEY } from "@/lib/theme-studio";
import {
  loadThemeStudioRecovery,
  USER_THEMES_STORAGE_KEY,
  writeThemeStudioRecovery,
  writeUserThemes,
} from "@/lib/theme-studio-storage";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { expectNoAxeViolations } from "@/test/axe";
import { expectKeepsFocus } from "@/test/focus";
import { ControlCenterApp } from "./control-center-app";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7", renderOk: true };
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
  capabilities: { standby: { supported: true } },
};
const rotation = {
  id: "vibetv.display.rotateSeconds",
  section: "display",
  owner: "vibetv",
  type: "enum",
  label: "Switch providers",
  value: "0" as string,
  effectiveValue: "0",
  allowsDefault: false,
  options: [
    { value: "0", label: "When activity changes" },
    { value: "30", label: "Every 30 seconds" },
    { value: "60", label: "Every minute" },
    { value: "300", label: "Every 5 minutes" },
  ],
  availability: { state: "available" },
  writeStrategy: "vibetv_override",
  writable: true,
};
const refused = {
  code: "preference_write_failed",
  message: "This setting could not be updated.",
  nextAction: "Try again in a moment.",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

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

// The Mac App as this window sees it: one stored display preference, and what
// VibeTV holds for brightness, screensaver and display mode.
function startWindow(themes: unknown[] = []) {
  const companion = {
    // The VibeTV the Mac App is connected to.
    device: device as typeof device,
    stored: rotation,
    // What VibeTV reports about its screensaver slot, if it reports it.
    slot: undefined as { screensaverPath?: string } | undefined,
    settings: {
      display: { brightnessPercent: 20 },
      standby: { enabled: false, timeoutMinutes: 1, brightnessPercent: 20 },
    },
    selection: { mode: "automatic", providerIds: [] as string[], configured: true, valid: true },
    providers: [] as (typeof claude)[],
    // The limits CodexBar reports for each provider; empty until a test sets them.
    usageWindows: [] as { id: string; label: string; usedPercent: number }[],
    refuseWrites: false as boolean | "once",
    refuseDisplayWrites: false,
    requests: [] as string[],
    // While set, a read of the display preferences answers late, with the
    // value it found when it started.
    holdRead: null as Promise<void> | null,
    // While set, the next write is stored late.
    holdWrite: null as Promise<void> | null,
    // While set, a read of VibeTV's settings answers late, with what it found
    // when it started.
    holdSettingsRead: null as Promise<void> | null,
    // When set, a held read answers with this VibeTV instead of the one the
    // companion is connected to when the read was asked.
    settingsAnswerDevice: null as typeof device | null,
    // While set, a status answers late, with the VibeTV it found when it
    // started.
    holdStatus: null as Promise<void> | null,
  };
  const takeHeldWrite = () => {
    const held = companion.holdWrite;
    companion.holdWrite = null;
    return held;
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
  // jsdom has neither; the open select list calls both.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      companion.requests.push(`${method} ${url} ${init?.body ?? ""}`.trim());
      if (url.endsWith("/v1/status")) {
        const found = { ...companion.device, standby: companion.slot };
        await companion.holdStatus;
        return jsonResponse({
          ok: true,
          companion: { version: "9.9.9", installationMode: "dmg" },
          device: found,
        });
      }
      if (url.endsWith("/v1/display-frame/latest")) {
        return jsonResponse({
          ok: true,
          deviceId: companion.device.deviceId,
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
      if (url.endsWith("/v1/preferences?section=display")) {
        const found = companion.stored;
        await companion.holdRead;
        return jsonResponse({ ok: true, items: [found] });
      }
      if (url.includes("/v1/preferences?section=providers")) {
        return jsonResponse({ ok: true, items: companion.providers });
      }
      if (url.endsWith(`/v1/preferences/${rotation.id}`) && method === "PATCH") {
        const { value } = JSON.parse(String(init?.body));
        await takeHeldWrite();
        if (companion.refuseWrites) {
          if (companion.refuseWrites === "once") {
            companion.refuseWrites = false;
          }
          return jsonResponse({ ok: false, error: refused }, 502);
        }
        companion.stored = { ...rotation, value, effectiveValue: value };
        return jsonResponse({ ok: true, item: companion.stored });
      }
      if (url.endsWith(`/v1/preferences/${claude.id}`) && method === "PATCH") {
        const { value } = JSON.parse(String(init?.body));
        companion.providers = [{ ...claude, value, effectiveValue: value }];
        return jsonResponse({ ok: true, item: companion.providers[0] });
      }
      if (url.endsWith("/v1/settings")) {
        if (init?.body) {
          const { brightnessPercent, standby } = JSON.parse(String(init.body));
          await takeHeldWrite();
          if (companion.refuseWrites) {
            if (companion.refuseWrites === "once") {
              companion.refuseWrites = false;
            }
            return jsonResponse({ ok: false, error: refused }, 502);
          }
          companion.settings = standby
            ? { ...companion.settings, standby }
            : { ...companion.settings, display: { brightnessPercent } };
        }
        // The companion answers for the VibeTV it was talking to when asked.
        const found = companion.settings;
        const answeredBy = companion.device;
        if (!init?.body) {
          await companion.holdSettingsRead;
        }
        return jsonResponse({
          ok: true,
          settings: init?.body ? companion.settings : found,
          device: companion.settingsAnswerDevice ?? answeredBy,
        });
      }
      if (url.endsWith("/v1/provider-display")) {
        if (init?.body && companion.refuseDisplayWrites) {
          return jsonResponse({ ok: false, error: refused }, 502);
        }
        if (init?.body) {
          await takeHeldWrite();
          companion.selection = {
            ...JSON.parse(String(init.body)),
            configured: true,
            valid: true,
          };
        }
        return jsonResponse({ ok: true, selection: companion.selection });
      }
      if (url.includes("/v1/usage")) {
        return jsonResponse({
          ok: true,
          usageMode: "used",
          providers: companion.providers.map(({ providerId, label }) => ({
            id: providerId, label, session: 12, weekly: 34, resetSecs: 0, usageMode: "used",
            windows: companion.usageWindows,
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
      createElement(ControlCenterApp, { catalog: { themes } as never }),
    ),
  );
  const wait = async (seconds: number) => {
    for (let second = 0; second < seconds; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
  };
  return {
    companion,
    text: () => view.container.ownerDocument.body.textContent || "",
    wait,
    // The next write is stored only once the returned function is called.
    holdNextWrite: () => {
      let store = () => {};
      companion.holdWrite = new Promise<void>((resolve) => {
        store = resolve;
      });
      return store;
    },
    // What was sent to VibeTV's settings, in the order it was sent.
    settingsWrites: () =>
      companion.requests
        .filter((request) => request.startsWith("POST /api/local-companion/v1/settings "))
        .map((request) => JSON.parse(request.slice(request.indexOf("{")))),
    // One key press or click, then what the app starts in answer to it. In the
    // app two presses are two events with that work in between.
    step: async (event: () => void) => {
      event();
      await act(async () => {});
    },
    rotation: () => screen.getByRole("combobox", { name: "Switch providers" }),
    choose: async (option: string) => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Switch providers" }), { key: "Enter" });
      fireEvent.keyDown(screen.getByRole("option", { name: option }), { key: "Enter" });
      await wait(1);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("reads the provider switching in Settings and saves a change at once", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  expect(window.rotation().textContent).toBe("When activity changes");

  await window.choose("Every 30 seconds");
  expect(window.companion.requests).toContain(
    'PATCH /api/local-companion/v1/preferences/vibetv.display.rotateSeconds {"value":"30"}',
  );
  expect(window.rotation().textContent).toBe("Every 30 seconds");

  await window.choose("When activity changes");
  expect(window.companion.requests).toContain(
    'PATCH /api/local-companion/v1/preferences/vibetv.display.rotateSeconds {"value":"0"}',
  );
  expect(window.rotation().textContent).toBe("When activity changes");
});

// Issue #183, acceptance: "Global settings never modify theme drafts, theme
// exports, or dirty state." Theme Studio keeps a theme with unsaved changes as
// a recovery copy beside the saved themes; it exists only while there are
// such changes.
it("leaves the saved themes and a theme with unsaved changes as they are when a preference is saved", async () => {
  const themeDocument = {
    assets: {},
    packName: "My Theme",
    spec: {
      bgColor: "#000000",
      primitives: [{ color: "#FFFFFF", text: "Hi", type: "text" as const, x: 1, y: 2 }],
      themeId: "my-theme",
      themeRev: 1,
      themeSpecVersion: 1 as const,
    },
  };
  const savedAt = "2026-07-15T08:00:00.000Z";
  expect(writeUserThemes([{ document: themeDocument, id: "my-theme", updatedAt: savedAt }]).ok).toBe(true);
  expect(
    writeThemeStudioRecovery({
      baseUpdatedAt: savedAt,
      document: { ...themeDocument, packName: "My Theme, changed" },
      libraryId: "my-theme",
      source: "custom",
      updatedAt: "2026-07-15T08:30:00.000Z",
    }).ok,
  ).toBe(true);
  const stored = () => [
    localStorage.getItem(USER_THEMES_STORAGE_KEY),
    localStorage.getItem(THEME_STUDIO_DRAFT_STORAGE_KEY),
  ];
  try {
    const window = startWindow();
    await window.wait(10);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await window.wait(1);
    const before = stored();
    expect(before.every(Boolean)).toBe(true);

    await window.choose("Every 30 seconds");
    expect(window.companion.requests).toContain(
      'PATCH /api/local-companion/v1/preferences/vibetv.display.rotateSeconds {"value":"30"}',
    );
    await window.choose("When activity changes");

    expect(stored()).toEqual(before);
    expect(loadThemeStudioRecovery()).toMatchObject({
      ok: true,
      value: { document: { packName: "My Theme, changed" }, libraryId: "my-theme" },
    });
  } finally {
    localStorage.removeItem(USER_THEMES_STORAGE_KEY);
    localStorage.removeItem(THEME_STUDIO_DRAFT_STORAGE_KEY);
  }
});

// Issue #368: Settings reads the providers again every few seconds while it
// is open, and the row that is already on the screen takes the new state.
it("changes a provider's row in Settings with the next read, without drawing the row anew", async () => {
  const window = startWindow();
  window.companion.providers = [
    { ...claude, health: { state: "auth_required", service: "unknown", message: "Sign in to Claude." } },
  ];
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  const row = screen.getByRole("switch", { name: "Claude" }).closest('[role="listitem"]');
  expect(row).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in needed for Claude" })).not.toBeNull();

  window.companion.providers = [claude];
  await window.wait(5);

  expect(screen.queryByRole("button", { name: "Sign in needed for Claude" })).toBeNull();
  expect(screen.getByRole("switch", { name: "Claude" }).closest('[role="listitem"]')).toBe(row);
  expect(window.companion.requests.some((request) => request.includes("/v1/providers/retry"))).toBe(false);

  window.companion.providers = [{ ...claude, health: { state: "checking", service: "unknown", message: "Checking." } }];
  await window.wait(5);
  expect(row?.querySelector('[role="status"], svg.animate-spin')).not.toBeNull();
  expect(screen.getByRole("switch", { name: "Claude" }).closest('[role="listitem"]')).toBe(row);
});

it("keeps the stored provider switching and says so when the write is refused", async () => {
  const window = startWindow();
  window.companion.refuseWrites = true;
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  await window.choose("Every 30 seconds");

  expect(window.text()).toContain(refused.message);
  expect(
    screen.getByRole("combobox", { name: "Switch providers", hidden: true }).textContent,
  ).toBe("When activity changes");
});

// A read that started before a change must not put the old value back.
it("keeps a saved provider switching when an older read answers afterwards", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  let answerRead = () => {};
  window.companion.holdRead = new Promise<void>((resolve) => {
    answerRead = resolve;
  });
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  await window.choose("Every 30 seconds");
  expect(window.rotation().textContent).toBe("Every 30 seconds");

  window.companion.holdRead = null;
  answerRead();
  await window.wait(1);
  expect(window.rotation().textContent).toBe("Every 30 seconds");
});

// A read that starts while a change is still on its way to the Mac App finds
// the value from before it. Answered after the change, it must not put that
// value back.
it("keeps a saved provider switching when a read beside the write answers afterwards", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  const store = window.holdNextWrite();
  await window.choose("Every 30 seconds");
  let answerRead = () => {};
  window.companion.holdRead = new Promise<void>((resolve) => {
    answerRead = resolve;
  });
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  store();
  await window.wait(1);
  window.companion.holdRead = null;
  answerRead();
  await window.wait(1);

  expect(window.companion.stored.value).toBe("30");
  expect(window.rotation().textContent).toBe("Every 30 seconds");
});

// Two changes in a row: the Mac App must end up with the second one, also when
// it is slow to store the first.
it("stores two quick changes of the provider switching in the order they were made", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  let storeFirst = () => {};
  window.companion.holdWrite = new Promise<void>((resolve) => {
    storeFirst = resolve;
  });
  await window.choose("Every 30 seconds");
  await window.choose("Every minute");
  storeFirst();
  await window.wait(1);

  expect(window.companion.stored.value).toBe("60");
  expect(window.rotation().textContent).toBe("Every minute");
});

// The first of two quick changes is refused, the second is stored. The control
// shows what is stored, and the refusal of the first is gone: every call to the
// Mac App takes the shown error away when it starts.
it("drops the refusal of a provider switching change once a later change is stored", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  const answerFirst = window.holdNextWrite();
  window.companion.refuseWrites = "once";
  await window.choose("Every 30 seconds");
  await window.choose("Every minute");
  answerFirst();
  await window.wait(1);

  expect(window.companion.stored.value).toBe("60");
  expect(window.rotation().textContent).toBe("Every minute");
  expect(window.text()).not.toContain(refused.message);
});

// The activity entry counts minutes the way the "Show after" list does.
it("names a one-minute screensaver in the singular", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("switch", { name: "Show screensaver" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);

  expect(window.text()).toContain(
    "The screensaver starts after 1 minute at 20% brightness.",
  );
});

// Issue #558, seen in the Windows app: a control was closed while its change
// was saved. That dropped keyboard focus to the page, so a slider moved one
// step and ignored the next arrow key.
it("keeps Brightness focused through two arrow keys and saves both in order", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name: "Brightness" });
  slider.focus();

  const store = window.holdNextWrite();
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  expectKeepsFocus(slider);
  expect(slider.getAttribute("aria-valuenow")).toBe("22");
  expect(window.settingsWrites()).toEqual([{ brightnessPercent: 21 }]);

  store();
  await window.wait(1);
  expectKeepsFocus(slider);
  expect(slider.getAttribute("aria-valuenow")).toBe("22");
  expect(window.settingsWrites()).toEqual([
    { brightnessPercent: 21 },
    { brightnessPercent: 22 },
  ]);
});

// A refused save left the app holding the value that was never stored, so
// later reads of what VibeTV holds were ignored.
it("shows VibeTV's brightness again after a refused save, once Settings is opened again", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const brightness = () => screen.getByRole("slider", { name: "Brightness" });

  window.companion.refuseWrites = "once";
  await window.step(() => fireEvent.keyDown(brightness(), { key: "ArrowRight" }));
  await window.wait(1);
  expect(window.companion.settings.display.brightnessPercent).toBe(20);

  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  expect(brightness().getAttribute("aria-valuenow")).toBe("20");
});

// The answer to the first save set the thumb back to the saved value while the
// customer was already dragging on, until the pointer moved again.
it.each([
  ["Brightness", (brightnessPercent: number) => ({ brightnessPercent })],
  [
    "Brightness in screensaver",
    (brightnessPercent: number) => ({
      standby: { enabled: true, timeoutMinutes: 10, brightnessPercent },
    }),
  ],
])("leaves the %s thumb where it is dragged when an earlier save is answered", async (name, write) => {
  const window = startWindow();
  window.companion.settings.standby = { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 };
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name });
  // jsdom lays nothing out and holds no pointer: the track is 100 px wide
  // here, and the pointer stays down from pointerDown to pointerUp.
  const track = slider.closest<HTMLElement>('[data-slot="slider"]')!;
  track.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
  track.setPointerCapture = () => {};
  track.releasePointerCapture = () => {};
  track.hasPointerCapture = () => true;

  const store = window.holdNextWrite();
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  await window.step(() => fireEvent.pointerDown(track, { clientX: 60 }));
  const dragged = slider.getAttribute("aria-valuenow");
  expect(dragged).not.toBe("21");

  store();
  await window.wait(1);
  expect(slider.getAttribute("aria-valuenow")).toBe(dragged);

  await window.step(() => fireEvent.pointerUp(track, { clientX: 60 }));
  await window.wait(1);
  expect(slider.getAttribute("aria-valuenow")).toBe(dragged);
  expect(window.settingsWrites()).toEqual([write(21), write(Number(dragged))]);
});

// A refused save set the screensaver thumb back to the last stored value while
// the customer was already dragging on, and the release then saved that value.
it("leaves the Brightness in screensaver thumb where it is dragged when an earlier save is refused", async () => {
  const window = startWindow();
  window.companion.settings.standby = { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 };
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name: "Brightness in screensaver" });
  const track = slider.closest<HTMLElement>('[data-slot="slider"]')!;
  track.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
  track.setPointerCapture = () => {};
  track.releasePointerCapture = () => {};
  track.hasPointerCapture = () => true;

  const answer = window.holdNextWrite();
  window.companion.refuseWrites = "once";
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  await window.step(() => fireEvent.pointerDown(track, { clientX: 60 }));
  const dragged = slider.getAttribute("aria-valuenow");
  expect(dragged).not.toBe("21");

  answer();
  await window.wait(1);
  expect(slider.getAttribute("aria-valuenow")).toBe(dragged);

  await window.step(() => fireEvent.pointerUp(track, { clientX: 60 }));
  await window.wait(1);
  expect(slider.getAttribute("aria-valuenow")).toBe(dragged);
  expect(window.companion.settings.standby.brightnessPercent).toBe(Number(dragged));
});

// A brightness change that was still on its way, and one waiting behind it,
// reached VibeTV during or after the reset.
it.each([
  ["Run setup", "Run setup again", "/v1/setup/reset"],
  ["Reset…", "Reset", "/v1/device/factory-reset"],
])("%s waits until a brightness change is saved", async (button, confirm, reset) => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name: "Brightness" });
  const sent = () =>
    window.companion.requests
      .filter((request) => /^POST \S+\/v1\/(settings|setup\/reset|device\/factory-reset) /.test(`${request} `))
      .map((request) => request.split(" ")[1].replace("/api/local-companion", ""));

  const store = window.holdNextWrite();
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  await window.step(() => fireEvent.click(screen.getByRole("button", { name: button })));
  await window.step(() =>
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: confirm }),
    ),
  );
  expect(sent()).toEqual(["/v1/settings"]);

  store();
  await window.wait(1);
  expect(sent()).toEqual(["/v1/settings", "/v1/settings", reset]);
});

// A held arrow key repeats faster than VibeTV stores a value. The values in
// between are not sent one by one after the key is let go.
it("sends the first and the last value of a held arrow key", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name: "Brightness" });
  slider.focus();

  const store = window.holdNextWrite();
  for (let repeat = 0; repeat < 5; repeat += 1) {
    await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  }
  store();
  await window.wait(1);

  expectKeepsFocus(slider);
  expect(slider.getAttribute("aria-valuenow")).toBe("25");
  expect(window.settingsWrites()).toEqual([
    { brightnessPercent: 21 },
    { brightnessPercent: 25 },
  ]);
});

it("keeps Brightness in screensaver focused through two arrow keys", async () => {
  const window = startWindow();
  const standby = { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 };
  window.companion.settings.standby = standby;
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name: "Brightness in screensaver" });
  slider.focus();

  const store = window.holdNextWrite();
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  await window.step(() => fireEvent.keyDown(slider, { key: "ArrowRight" }));
  expectKeepsFocus(slider);
  expect(slider.getAttribute("aria-valuenow")).toBe("22");

  store();
  await window.wait(1);
  expectKeepsFocus(slider);
  expect(slider.getAttribute("aria-valuenow")).toBe("22");
  expect(window.settingsWrites()).toEqual([
    { standby: { ...standby, brightnessPercent: 21 } },
    { standby: { ...standby, brightnessPercent: 22 } },
  ]);
});

it("keeps Show screensaver focused while it is saved", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const toggle = screen.getByRole("switch", { name: "Show screensaver" });
  toggle.focus();

  const store = window.holdNextWrite();
  await window.step(() => fireEvent.click(toggle));
  expectKeepsFocus(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("true");

  store();
  await window.wait(1);
  expectKeepsFocus(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(window.companion.settings.standby.enabled).toBe(true);
});

// Issue #643 (variant 645-A): Show screensaver has its switch in Settings
// only. Screensavers says in one line when it is off and opens Settings at
// the switch.
const screensaverSwitch = () =>
  screen.getByRole("switch", { name: "Show screensaver" });
const brightnessSlider = () => screen.getByRole("slider", { name: "Brightness" });
const brightnessDisabled = () => brightnessSlider().hasAttribute("data-disabled");
const openSettings = async (window: ReturnType<typeof startWindow>) => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
};
const openScreensavers = async (window: ReturnType<typeof startWindow>) => {
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Screensavers" }));
  await window.wait(1);
};

it("opens Settings at Show screensaver from the line under Screensavers", async () => {
  const window = startWindow();
  await window.wait(10);
  await openScreensavers(window);
  expect(screen.queryByRole("switch", { name: "Show screensaver" })).toBeNull();
  expect(window.text()).toContain("Screensaver is off.");

  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  await window.wait(1);
  expect(screen.getByRole("heading", { name: "Screensaver" }).closest("section")?.id).toBe(
    "settings-screensaver",
  );
  await window.step(() => fireEvent.click(screensaverSwitch()));
  await window.wait(1);
  expect(window.companion.settings.standby.enabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Screensavers" }));
  await window.wait(1);
  expect(screen.getByRole("heading", { name: "Screensavers" })).toBeTruthy();
  expect(window.text()).not.toContain("Screensaver is off.");
  expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
});

// Codex review of #645: the screensaver values belong to one VibeTV. When the
// Mac App is connected to another one, the switch stays closed until that
// VibeTV's own setting is read; a click must not send the first VibeTV's time
// and brightness to it.
it("closes Show screensaver when another VibeTV is connected until its own setting is read", async () => {
  const window = startWindow();
  await window.wait(10);
  await openSettings(window);
  expect(screensaverSwitch().hasAttribute("disabled")).toBe(false);

  let answer = () => {};
  window.companion.holdSettingsRead = new Promise<void>((resolve) => {
    answer = resolve;
  });
  window.companion.settings = {
    ...window.companion.settings,
    standby: { enabled: true, timeoutMinutes: 30, brightnessPercent: 50 },
  };
  window.companion.device = { ...device, deviceId: "16198106", target: "http://192.168.178.183" };
  await window.wait(30);
  expect(screensaverSwitch().hasAttribute("disabled")).toBe(true);

  answer();
  await window.wait(1);
  expect(screensaverSwitch().hasAttribute("disabled")).toBe(false);
  expect(screensaverSwitch().getAttribute("aria-checked")).toBe("true");
  expect(window.settingsWrites()).toEqual([]);
});

it("keeps Show screensaver closed when a read for the first VibeTV answers after another one is connected", async () => {
  const window = startWindow();
  await window.wait(10);
  await openSettings(window);
  const hold = () => {
    let answer = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    return { held, answer };
  };
  const other = { ...device, deviceId: "16198106", target: "http://192.168.178.183" };

  // The Mac App is connected to another VibeTV; the status that says so is on
  // its way...
  const status = hold();
  window.companion.holdStatus = status.held;
  window.companion.device = other;
  await window.wait(5);
  window.companion.holdStatus = null;

  // ...while a read of the first VibeTV's settings is on its way. Its answer
  // is held and names the first VibeTV, the one the read was asked for.
  const firstRead = hold();
  window.companion.holdSettingsRead = firstRead.held;
  await openScreensavers(window);
  await openSettings(window);
  window.companion.settings = {
    ...window.companion.settings,
    standby: { enabled: true, timeoutMinutes: 30, brightnessPercent: 50 },
  };
  // The read of the new VibeTV, issued once the status is in, is held too.
  const secondRead = hold();
  window.companion.holdSettingsRead = secondRead.held;
  status.answer();
  await window.wait(1);

  // The first VibeTV's answer arrives late and is ignored: the switch stays
  // closed until the new VibeTV's own read arrives.
  window.companion.settingsAnswerDevice = device;
  firstRead.answer();
  await window.wait(1);
  window.companion.settingsAnswerDevice = null;
  expect(screensaverSwitch().hasAttribute("disabled")).toBe(true);

  // The new VibeTV's own answer is applied.
  secondRead.answer();
  await window.wait(1);
  expect(screensaverSwitch().hasAttribute("disabled")).toBe(false);
  expect(screensaverSwitch().getAttribute("aria-checked")).toBe("true");
  expect(window.settingsWrites()).toEqual([]);
});

// Issue #663: the brightness of the VibeTV before must not stay on screen, or a
// change would send it to the VibeTV connected now.
it("drops Brightness when another VibeTV is connected until its own value is read", async () => {
  const window = startWindow();
  await window.wait(10);
  await openSettings(window);
  expect(brightnessSlider().getAttribute("aria-valuenow")).toBe("20");
  expect(brightnessDisabled()).toBe(false);

  let answer = () => {};
  window.companion.holdSettingsRead = new Promise<void>((resolve) => {
    answer = resolve;
  });
  window.companion.settings = { ...window.companion.settings, display: { brightnessPercent: 60 } };
  window.companion.device = { ...device, deviceId: "16198106", target: "http://192.168.178.183" };
  await window.wait(30);
  expect(brightnessDisabled()).toBe(true);
  expect(brightnessSlider().getAttribute("aria-valuenow")).not.toBe("20");

  answer();
  await window.wait(1);
  expect(brightnessDisabled()).toBe(false);
  expect(brightnessSlider().getAttribute("aria-valuenow")).toBe("60");
  expect(window.settingsWrites()).toEqual([]);
});

it("keeps Brightness dropped when a read for the first VibeTV answers after another one is connected", async () => {
  const window = startWindow();
  await window.wait(10);
  await openSettings(window);
  const hold = () => {
    let answer = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    return { held, answer };
  };
  const other = { ...device, deviceId: "16198106", target: "http://192.168.178.183" };

  // The Mac App is connected to another VibeTV; the status that says so is on
  // its way...
  const status = hold();
  window.companion.holdStatus = status.held;
  window.companion.device = other;
  await window.wait(5);
  window.companion.holdStatus = null;

  // ...while a read of the first VibeTV's settings is on its way. Its answer
  // is held and carries the first VibeTV's brightness.
  const firstRead = hold();
  window.companion.holdSettingsRead = firstRead.held;
  await openScreensavers(window);
  await openSettings(window);
  // The read of the new VibeTV, issued once the status is in, is held too.
  window.companion.settings = { ...window.companion.settings, display: { brightnessPercent: 60 } };
  const secondRead = hold();
  window.companion.holdSettingsRead = secondRead.held;
  status.answer();
  await window.wait(1);
  expect(brightnessDisabled()).toBe(true);

  // The first VibeTV's answer arrives late and is ignored: Brightness stays
  // dropped until the new VibeTV's own read arrives.
  window.companion.settingsAnswerDevice = device;
  firstRead.answer();
  await window.wait(1);
  window.companion.settingsAnswerDevice = null;
  expect(brightnessDisabled()).toBe(true);
  expect(brightnessSlider().getAttribute("aria-valuenow")).not.toBe("20");

  // The new VibeTV's own answer is applied.
  secondRead.answer();
  await window.wait(1);
  expect(brightnessDisabled()).toBe(false);
  expect(brightnessSlider().getAttribute("aria-valuenow")).toBe("60");
  expect(window.settingsWrites()).toEqual([]);
});

it("keeps the new VibeTV's theme selected when a read for the first VibeTV answers late", async () => {
  const live = (themeId: string, title: string) => ({
    id: themeId,
    themeId,
    title,
    themeSpecPath: `/themes/u/${themeId}-1-000000.json`,
    usage: "live",
  });
  const window = startWindow([live("codex", "Codex"), live("gauge", "Gauge")]);
  await window.wait(10);
  const hold = () => {
    let answer = () => {};
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    return { held, answer };
  };
  const other = { ...device, deviceId: "16198106", target: "http://192.168.178.183", activeTheme: "gauge" };

  // The Mac App is connected to another VibeTV that shows Gauge; the status
  // that says so is on its way while a read of the first VibeTV's settings is
  // on its way too.
  const status = hold();
  window.companion.holdStatus = status.held;
  window.companion.device = other;
  await window.wait(5);
  window.companion.holdStatus = null;
  const firstRead = hold();
  window.companion.holdSettingsRead = firstRead.held;
  await openScreensavers(window);
  await openSettings(window);
  const secondRead = hold();
  window.companion.holdSettingsRead = secondRead.held;
  status.answer();
  await window.wait(1);

  // The new VibeTV's own answer comes first and selects Gauge.
  secondRead.answer();
  await window.wait(1);
  // The first VibeTV's answer, which names Codex, arrives late and is ignored.
  window.companion.settingsAnswerDevice = device;
  firstRead.answer();
  await window.wait(1);
  window.companion.settingsAnswerDevice = null;

  // No later read may answer and hide the result.
  window.companion.holdSettingsRead = new Promise<void>(() => {});
  fireEvent.click(screen.getByRole("button", { name: "Themes" }));
  await window.wait(1);
  const row = (themeId: string) => document.getElementById(`catalog-theme-${themeId}`);
  expect(row("gauge")?.dataset.variant).toBe("muted");
  expect(row("codex")?.dataset.variant).toBe("outline");
});

it("keeps the display mode cards focused while the mode is saved", async () => {
  const window = startWindow();
  window.companion.providers = [claude];
  window.companion.selection.providerIds = ["claude"];
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  for (const [name, mode] of [[/One provider/, "fixed"], [/Automatic/, "automatic"]] as const) {
    const card = screen.getByRole("button", { name });
    card.focus();

    const store = window.holdNextWrite();
    await window.step(() => fireEvent.click(card));
    expectKeepsFocus(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");

    store();
    await window.wait(1);
    expectKeepsFocus(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(window.companion.selection.mode).toBe(mode);
  }
});

// Issue #558: Settings said neither which screensaver "Show screensaver" shows
// nor that none is installed. VibeTV reports its slot with the status.
it("names the installed screensaver in Settings, or says that there is none", async () => {
  const nightClock = {
    id: "night-clock",
    themeId: "night-clock",
    themeSpecPath: "/themes/s/nc-3-e18e4217.json",
    title: "Night Clock",
    usage: "screensaver",
  };
  const window = startWindow([nightClock]);
  window.companion.settings.standby = { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 };
  window.companion.slot = {};
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  expect(window.text()).toContain("No screensaver is installed yet.");

  window.companion.slot = { screensaverPath: nightClock.themeSpecPath };
  await window.wait(10);
  expect(window.text()).toContain("Night Clock is installed.");
  expect(window.text()).not.toContain("No screensaver is installed yet.");
});

// Issue #546: "Run setup again" started at once; the factory reset beside it
// asked first. Support no longer has the button (calm master, Paul 19.10.).
it("asks before running setup again and lets the customer cancel", async () => {
  const window = startWindow();
  await window.wait(10);
  const resets = () =>
    window.companion.requests.filter((request) => request.includes("/v1/setup/reset"));
  const question = () => screen.queryByRole("dialog", { name: "Run setup again?" });

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Run setup" }));
  expect(question()?.textContent).toContain(
    "VibeTV keeps its WiFi details, settings and themes.",
  );
  fireEvent.click(within(question()!).getByRole("button", { name: "Cancel" }));
  expect(question()).toBeNull();
  expect(resets()).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Run setup" }));
  fireEvent.click(within(question()!).getByRole("button", { name: "Run setup again" }));
  await window.wait(1);
  expect(question()).toBeNull();
  expect(resets()).toHaveLength(1);
});

// Issue #579: every start of the app left "Settings loaded" with "Brightness
// is set to 20%." under Recent activity, although nobody had changed anything.
it("leaves no Recent activity entry for reading the settings", async () => {
  const window = startWindow();
  await window.wait(10);
  expect(window.companion.requests).toContain("GET /api/local-companion/v1/settings");
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);

  expect(window.text()).toContain("Control Center opened");
  expect(window.text()).not.toContain("Settings loaded");
  expect(window.text()).not.toContain("Brightness is set to");
});

// Issue #579: Recent activity named a saved brightness, and nothing else the
// customer changes in Settings.
it("enters a changed display mode, provider switching and provider under Recent activity", async () => {
  const window = startWindow();
  window.companion.providers = [claude];
  window.companion.selection.providerIds = ["claude"];
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  // Switch providers is offered under Automatic only.
  await window.choose("Every 30 seconds");
  fireEvent.click(screen.getByRole("button", { name: /One provider/ }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("switch", { name: "Claude" }));
  await window.wait(2);

  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);
  const entries = within(
    screen.getByText("Recent activity").closest("section") as HTMLElement,
  )
    .getAllByRole("listitem")
    .map((entry) => entry.textContent?.replace(/^\d\d:\d\d:\d\d/, ""));
  expect(entries).toEqual([
    "AI provider saved · Claude turned off.",
    "Display mode saved · Always show Claude.",
    "Switch providers saved · Switch providers is set to Every 30 seconds.",
    "Control Center opened · This session started.",
  ]);
  // The first entry is written when the app opens, so it has a time too.
  const first = within(
    screen.getByText("Recent activity").closest("section") as HTMLElement,
  ).getAllByRole("listitem").at(-1);
  expect(first?.textContent).toMatch(/^\d\d:\d\d:\d\d/);
});

// The refusal stands on the page; the list keeps it for the support report.
it("enters a refused change of the provider switching under Recent activity", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  window.companion.refuseWrites = true;
  await window.choose("Every 30 seconds");

  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);
  expect(window.text()).toContain("Switch providers save needs attention · Try again in a moment.");
  expect(window.text()).not.toContain("Switch providers saved");
});

// Found in review of #579: with a provider switched on, the app itself writes
// which providers Automatic moves through, and tries again every five seconds
// while that fails. Each try put "Display mode save needs attention" at the
// top of Recent activity with a new time, for a change nobody had made.
it("enters nothing under Recent activity for what the app writes by itself", async () => {
  const window = startWindow();
  window.companion.providers = [{ ...claude, value: false, effectiveValue: false }];
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  window.companion.refuseDisplayWrites = true;
  fireEvent.click(screen.getByRole("switch", { name: "Claude" }));
  await window.wait(12);
  expect(
    window.companion.requests.filter((request) => request.startsWith("PATCH /api/local-companion/v1/provider-display")).length,
  ).toBeGreaterThan(1);
  window.companion.refuseDisplayWrites = false;
  await window.wait(6);
  expect(window.companion.selection.providerIds).toEqual(["claude"]);

  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);
  expect(window.text()).toContain("AI provider saved · Claude turned on.");
  expect(window.text()).not.toContain("Display mode save");
});

it("has no accessibility violations on any tab or in the setup question", async () => {
  const window = startWindow();
  await window.wait(10);
  const pages: string[] = [];
  // "Appearance" opens the submenu that holds Themes and Screensavers.
  for (const tab of ["Overview", "Usage", "Settings", "Appearance", "Themes", "Screensavers", "Updates", "Support"]) {
    fireEvent.click(screen.getByRole("button", { name: tab }));
    await window.wait(1);
    pages.push(document.body.innerHTML);
  }
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Run setup" }));
  expect(screen.getByRole("dialog", { name: "Run setup again?" })).toBeTruthy();
  pages.push(document.body.innerHTML);

  // axe waits on real timers.
  vi.useRealTimers();
  for (const page of pages) await expectNoAxeViolations(page);
  // Nine full-app checks take about three seconds on an idle machine.
}, 30_000);

// Found in review: two places asked for VibeTV's settings at the same moment
// and two reads ran. The first to answer opened the controls again while the
// second was still on its way, and that one put back what it had found before
// a change made in between.
const settingsReads = (window: ReturnType<typeof startWindow>) =>
  window.companion.requests.filter((request) => /^GET \S+\/v1\/settings$/.test(request)).length;

it("reads VibeTV's settings once when two places ask at the same time", async () => {
  let answerRead = () => {};
  const window = startWindow();
  window.companion.slot = {};
  window.companion.holdSettingsRead = new Promise<void>((resolve) => {
    answerRead = resolve;
  });
  // The status finds VibeTV ready and asks; opening Settings asks again.
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(2);
  expect(settingsReads(window)).toBe(1);

  window.companion.holdSettingsRead = null;
  answerRead();
  await window.wait(1);
  expect(settingsReads(window)).toBe(1);
  expect(screen.getByRole("switch", { name: "Show screensaver" })).toBeTruthy();

  // The next one who asks gets a new read.
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  expect(settingsReads(window)).toBe(2);
});

it("keeps a saved screensaver switch when a settings read beside the save answers afterwards", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const toggle = () => screen.getByRole("switch", { name: "Show screensaver" });
  expect(toggle().getAttribute("aria-checked")).toBe("false");

  let answerRead = () => {};
  window.companion.holdSettingsRead = new Promise<void>((resolve) => {
    answerRead = resolve;
  });
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  fireEvent.click(toggle());
  await window.wait(1);
  expect(window.companion.settings.standby.enabled).toBe(true);

  window.companion.holdSettingsRead = null;
  answerRead();
  await window.wait(1);
  expect(toggle().getAttribute("aria-checked")).toBe("true");
});

// Codex review of #674: a status request already on its way reports another
// VibeTV while the first Brightness write is held and a second one is queued.
// The queued write must not reach the VibeTV connected after it.
it("does not send a queued Brightness change to another VibeTV", async () => {
  const window = startWindow();
  await window.wait(10);
  await openSettings(window);
  let answerStatus = () => {};
  window.companion.holdStatus = new Promise<void>((resolve) => {
    answerStatus = resolve;
  });
  window.companion.device = { ...device, deviceId: "16198106", target: "http://192.168.178.183" };
  await window.wait(30);
  window.companion.holdStatus = null;

  const store = window.holdNextWrite();
  await window.step(() => fireEvent.keyDown(brightnessSlider(), { key: "ArrowRight" }));
  await window.step(() => fireEvent.keyDown(brightnessSlider(), { key: "ArrowRight" }));
  expect(window.settingsWrites()).toEqual([{ brightnessPercent: 21 }]);

  answerStatus();
  await window.wait(5);
  store();
  await window.wait(10);
  expect(window.settingsWrites()).toEqual([{ brightnessPercent: 21 }]);
});

// Two limits unticked one after the other while the first save is still on its
// way: the second save must keep the first, not write the limits as they were
// drawn before the first click.
it("keeps the first of two quick limit changes in the second save", async () => {
  const window = startWindow();
  window.companion.providers = [claude];
  window.companion.usageWindows = [
    { id: "session", label: "Session", usedPercent: 12 },
    { id: "weekly", label: "Weekly", usedPercent: 34 },
    { id: "fable", label: "Fable only", usedPercent: 0 },
  ];
  window.companion.selection = {
    mode: "fixed",
    providerIds: ["claude"],
    configured: true,
    valid: true,
  } as never;
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  const answerFirst = window.holdNextWrite();
  fireEvent.click(document.getElementById("vibetv-limit-claude-session") as HTMLElement);
  fireEvent.click(document.getElementById("vibetv-limit-claude-weekly") as HTMLElement);
  answerFirst();
  await window.wait(1);

  expect((window.companion.selection as Record<string, unknown>).hiddenWindows).toEqual({ claude: ["session", "weekly"] });
});

// Pair edits wait behind another display PATCH. Each must apply only its own
// slot change to the selection left by the preceding write, including swaps.
it.each([
  ["Cursor", "Gemini", ["cursor", "gemini"]],
  ["Codex", "Cursor", ["codex", "cursor"]],
])("keeps both queued pair edits (%s then %s)", async (first, second, expected) => {
  const window = startWindow();
  window.companion.providers = ["Claude", "Codex", "Cursor", "Gemini"].map((label) => ({
    ...claude, id: `codexbar.providers.${label.toLowerCase()}.enabled`,
    providerId: label.toLowerCase(), label,
  }));
  window.companion.usageWindows = [
    { id: "session", label: "Session", usedPercent: 12 },
    { id: "weekly", label: "Weekly", usedPercent: 34 },
  ];
  window.companion.selection = {
    mode: "pair", providerIds: ["claude", "codex"], configured: true, valid: true,
  };
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  const answerFirst = window.holdNextWrite();
  await window.step(() => {
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Limit for Provider 1" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("option", { name: "Weekly" }), { key: "Enter" });
  });
  for (const [picker, choice] of [["Provider 1", first], ["Provider 2", second]]) {
    await window.step(() => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: picker }), { key: "Enter" });
      fireEvent.keyDown(screen.getByRole("option", { name: choice }), { key: "Enter" });
    });
  }
  answerFirst();
  await window.wait(1);

  const patches = window.companion.requests
    .filter((request) => request.startsWith("PATCH /api/local-companion/v1/provider-display "))
    .map((request) => JSON.parse(request.slice(request.indexOf("{"))));
  expect(patches.at(-1)).toMatchObject({ mode: "pair", providerIds: expected });
  expect(window.companion.selection.providerIds).toEqual(expected);
});
