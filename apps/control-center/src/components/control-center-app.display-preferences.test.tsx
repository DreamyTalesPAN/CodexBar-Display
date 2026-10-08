// @vitest-environment jsdom
//
// Issue #183: Settings reads the app's own display preferences from the
// registry, saves a change at once, and keeps the stored value when the write
// is refused.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { expectNoAxeViolations } from "@/test/axe";
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
  capabilities: { standby: { supported: true } },
};
const usageDisplay = {
  id: "vibetv.usage.displayMode",
  section: "display",
  owner: "vibetv",
  type: "enum",
  label: "Usage display",
  value: null as string | null,
  effectiveValue: "used",
  allowsDefault: true,
  options: [
    { value: "used", label: "Used" },
    { value: "remaining", label: "Remaining" },
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
    stored: usageDisplay,
    // What VibeTV reports about its screensaver slot, if it reports it.
    slot: undefined as { screensaverPath?: string } | undefined,
    settings: {
      display: { brightnessPercent: 20 },
      standby: { enabled: false, timeoutMinutes: 1, brightnessPercent: 20 },
    },
    selection: { mode: "automatic", providerIds: [] as string[], configured: true, valid: true },
    providers: [] as (typeof claude)[],
    refuseWrites: false,
    requests: [] as string[],
    // While set, a read of the display preferences answers late, with the
    // value it found when it started.
    holdRead: null as Promise<void> | null,
    // While set, the next write is stored late.
    holdWrite: null as Promise<void> | null,
  };
  const takeHeldWrite = () => {
    const held = companion.holdWrite;
    companion.holdWrite = null;
    return held;
  };
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
        return jsonResponse({
          ok: true,
          companion: { version: "9.9.9", installationMode: "dmg" },
          device: { ...device, standby: companion.slot },
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
      if (url.endsWith("/v1/preferences?section=display")) {
        const found = companion.stored;
        await companion.holdRead;
        return jsonResponse({ ok: true, items: [found] });
      }
      if (url.endsWith("/v1/preferences?section=providers")) {
        return jsonResponse({ ok: true, items: companion.providers });
      }
      if (url.endsWith(`/v1/preferences/${usageDisplay.id}`) && method === "PATCH") {
        if (companion.refuseWrites) {
          return jsonResponse({ ok: false, error: refused }, 502);
        }
        const { value } = JSON.parse(String(init?.body));
        await takeHeldWrite();
        companion.stored = { ...usageDisplay, value, effectiveValue: value ?? "used" };
        return jsonResponse({ ok: true, item: companion.stored });
      }
      if (url.endsWith("/v1/settings")) {
        if (init?.body) {
          const { brightnessPercent, standby } = JSON.parse(String(init.body));
          await takeHeldWrite();
          companion.settings = standby
            ? { ...companion.settings, standby }
            : { ...companion.settings, display: { brightnessPercent } };
        }
        return jsonResponse({ ok: true, settings: companion.settings });
      }
      if (url.endsWith("/v1/provider-display")) {
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
    usageDisplay: () => screen.getByRole("combobox", { name: "Usage display" }),
    choose: async (option: string) => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Usage display" }), { key: "Enter" });
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

it("reads the usage display in Settings and saves a change at once", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  expect(window.usageDisplay().textContent).toBe("Default");

  await window.choose("Remaining");
  expect(window.companion.requests).toContain(
    'PATCH /api/local-companion/v1/preferences/vibetv.usage.displayMode {"value":"remaining"}',
  );
  expect(window.usageDisplay().textContent).toBe("Remaining");

  await window.choose("Default");
  expect(window.companion.requests).toContain(
    'PATCH /api/local-companion/v1/preferences/vibetv.usage.displayMode {"value":null}',
  );
  expect(window.usageDisplay().textContent).toBe("Default");
});

it("keeps the stored usage display and says so when the write is refused", async () => {
  const window = startWindow();
  window.companion.refuseWrites = true;
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  await window.choose("Remaining");

  expect(window.text()).toContain(refused.message);
  expect(
    screen.getByRole("combobox", { name: "Usage display", hidden: true }).textContent,
  ).toBe("Default");
});

// A read that started before a change must not put the old value back.
it("keeps a saved usage display when an older read answers afterwards", async () => {
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

  await window.choose("Remaining");
  expect(window.usageDisplay().textContent).toBe("Remaining");

  window.companion.holdRead = null;
  answerRead();
  await window.wait(1);
  expect(window.usageDisplay().textContent).toBe("Remaining");
});

// Two changes in a row: the Mac App must end up with the second one, also when
// it is slow to store the first.
it("stores two quick changes of the usage display in the order they were made", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  let storeFirst = () => {};
  window.companion.holdWrite = new Promise<void>((resolve) => {
    storeFirst = resolve;
  });
  await window.choose("Remaining");
  await window.choose("Used");
  storeFirst();
  await window.wait(1);

  expect(window.companion.stored.value).toBe("used");
  expect(window.usageDisplay().textContent).toBe("Used");
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

// The answer to the first save set the thumb back to the saved value while the
// customer was already dragging on, until the pointer moved again.
it("leaves the Brightness thumb where it is dragged when an earlier save is answered", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  const slider = screen.getByRole("slider", { name: "Brightness" });
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
  expect(window.settingsWrites()).toEqual([
    { brightnessPercent: 21 },
    { brightnessPercent: Number(dragged) },
  ]);
});

// A brightness change that was still on its way, and one waiting behind it,
// reached VibeTV during or after the reset.
it.each([
  ["Run setup again", "Run setup again", "/v1/setup/reset"],
  ["Reset to factory settings", "Reset", "/v1/device/factory-reset"],
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

it.each([
  ["Settings", ["Settings"]],
  ["Screensavers", ["Appearance", "Screensavers"]],
])("keeps Show screensaver in %s focused while it is saved", async (_, tabs) => {
  const window = startWindow();
  await window.wait(10);
  for (const tab of tabs) {
    fireEvent.click(screen.getByRole("button", { name: tab }));
    await window.wait(1);
  }
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

it("keeps the display mode cards focused while the mode is saved", async () => {
  const window = startWindow();
  window.companion.providers = [claude];
  window.companion.selection.providerIds = ["claude"];
  await window.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  for (const [name, mode] of [[/Manual/, "fixed"], [/Automatic/, "automatic"]] as const) {
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

// Issue #546: "Run setup again" started at once, from Settings and from
// Support; the factory reset beside it asked first.
it("asks before running setup again and lets the customer cancel", async () => {
  const window = startWindow();
  await window.wait(10);
  const resets = () =>
    window.companion.requests.filter((request) => request.includes("/v1/setup/reset"));
  const question = () => screen.queryByRole("dialog", { name: "Run setup again?" });

  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
  expect(question()?.textContent).toContain(
    "VibeTV keeps its WiFi details, settings and themes.",
  );
  fireEvent.click(within(question()!).getByRole("button", { name: "Cancel" }));
  expect(question()).toBeNull();
  expect(resets()).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
  fireEvent.click(within(question()!).getByRole("button", { name: "Run setup again" }));
  await window.wait(1);
  expect(question()).toBeNull();
  expect(resets()).toHaveLength(1);
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
  fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
  expect(screen.getByRole("dialog", { name: "Run setup again?" })).toBeTruthy();
  pages.push(document.body.innerHTML);

  // axe waits on real timers.
  vi.useRealTimers();
  for (const page of pages) await expectNoAxeViolations(page);
  // Nine full-app checks take about three seconds on an idle machine.
}, 30_000);
