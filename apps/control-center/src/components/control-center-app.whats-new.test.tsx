// @vitest-environment jsdom
//
// "What's new": told once on Overview to a customer who was already set up
// when the update came, never to one who is setting VibeTV up, and readable
// again under Updates.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WHATS_NEW } from "@/lib/whats-new";
import { expectNoAxeViolations } from "@/test/axe";
import { ControlCenterApp } from "./control-center-app";

const SEEN_KEY = "vibetv.controlCenter.seenWhatsNew";
const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7" };
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

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// The app window of a customer with a connected VibeTV. `setUp: false` is a
// customer who has not chosen their providers yet, so setup is still to do.
function startWindow({ setUp = true, os = "darwin", appVersion = "1.0.63" } = {}) {
  // `usageBroken`: the usage service cannot start, which the app says in a
  // dialog of its own.
  // `appUpdate`: a newer app is on offer.
  const companion = { setUp, displayConfigured: setUp, usageBroken: false, appUpdate: false };
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
      const setup = {
        providerSelectionRequired: !companion.setUp,
        providerSelectionComplete: companion.setUp,
      };
      if (url.endsWith("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: {
            version: "9.9.9",
            installationMode: "dmg",
            app: appVersion ? { version: appVersion } : undefined,
            runtime: { os },
            update: companion.appUpdate
              ? { updateAvailable: true, latestVersion: "1.0.64" }
              : undefined,
          },
          setup,
          providerSetup: companion.usageBroken
            ? { status: "setup_required", engine: { status: "not_configured" } }
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
      if (url.endsWith("/v1/setup/providers/complete")) {
        companion.setUp = true;
        return jsonResponse({
          ok: true,
          setup: { providerSelectionRequired: false, providerSelectionComplete: true },
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
      if (url.endsWith("/v1/preferences?section=providers")) {
        return jsonResponse({ ok: true, items: [claude] });
      }
      if (url.endsWith("/v1/preferences?section=display")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith("/v1/provider-display")) {
        if (init?.body) {
          companion.displayConfigured = true;
        }
        return jsonResponse({
          ok: true,
          selection: {
            mode: "fixed",
            providerIds: ["claude"],
            configured: companion.displayConfigured,
            valid: true,
          },
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
    companion,
    wait: async (seconds: number) => {
      for (let second = 0; second < seconds; second += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
    },
  };
}

const notice = () => screen.queryByRole("dialog", { name: "What's new" });
const keyCaps = () =>
  Array.from(notice()!.querySelectorAll("kbd"), (key) => key.textContent);
const seen = () => JSON.parse(window.localStorage.getItem(SEEN_KEY) || "null");
const allIds = WHATS_NEW.map(({ id }) => id);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

it("tells a set-up customer what is new once, on Overview, until they close it", async () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  const window = startWindow();
  await window.wait(10);
  // In a short window the list scrolls. Focus on the button at its end must
  // not scroll past the first entries.
  expect(focus.mock.contexts.at(-1)).toHaveProperty("textContent", "Got it");
  expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }]);
  focus.mockRestore();

  const text = notice()?.textContent ?? "";
  expect(text).toContain("Version 1.0.63");
  for (const sentence of [
    "New theme: Gauge",
    "A half ring that fills as you use your limit.",
    "New theme: Token Counter",
    "The tokens of your session as one large number.",
    "Switch providers with a shortcut",
    "Press ⌃⌥⌘P in any app to show the next provider on VibeTV.",
    "Choose how often VibeTV switches",
    "In Automatic mode VibeTV can switch when your activity changes, or every 30 seconds, every minute or every 5 minutes.",
    "Show what is used or what is left",
    "Choose whether VibeTV shows how much of your limit you have used or how much remains.",
    "You can read this again under Updates.",
  ]) {
    expect(text).toContain(sentence);
  }
  expect(keyCaps()).toEqual(["⌃", "⌥", "⌘", "P"]);
  expect(within(notice()!).getAllByRole("button", { name: "Show me in Settings" })).toHaveLength(2);
  // New themes stand first.
  expect(
    within(notice()!).getAllByRole("heading", { level: 3 }).map((title) => title.textContent),
  ).toEqual([
    "New theme: Gauge",
    "New theme: Token Counter",
    "Switch providers with a shortcut",
    "Choose how often VibeTV switches",
    "Show what is used or what is left",
  ]);
  // Enter closes the notice instead of opening Settings.
  expect(document.activeElement?.textContent).toBe("Got it");
  expect(seen()).toBeNull();

  fireEvent.click(within(notice()!).getByRole("button", { name: "Got it" }));
  await window.wait(1);
  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);

  // Leaving Overview and coming back does not bring it up again.
  fireEvent.click(screen.getByRole("button", { name: "Usage" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  expect(notice()).toBeNull();
});

it("does not tell it again in the next launch, and Escape closes it too", async () => {
  const first = startWindow();
  await first.wait(10);
  fireEvent.keyDown(notice()!, { key: "Escape" });
  await first.wait(1);
  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);

  cleanup();
  const second = startWindow();
  await second.wait(10);
  expect(notice()).toBeNull();
  expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
});

it("tells only what was added since the customer last read it", async () => {
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(allIds.slice(0, -1)));
  const app = startWindow({ appVersion: "" });
  await app.wait(10);

  const text = notice()?.textContent ?? "";
  expect(text).toContain(WHATS_NEW.at(-1)!.title);
  expect(text).not.toContain(WHATS_NEW[0].title);
  // An app that does not name its version shows no version line.
  expect(text).not.toContain("Version");
});

it("tells a customer who is setting VibeTV up nothing", async () => {
  const window = startWindow({ setUp: false });
  await window.wait(10);
  // Setup is on the provider step, and every entry already counts as seen.
  expect(seen()).toEqual(allIds);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await window.wait(15);

  expect(notice()).toBeNull();
  expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
});

it("waits until another dialog over Overview is gone", async () => {
  const window = startWindow();
  window.companion.usageBroken = true;
  await window.wait(10);
  const usageDialog = () => screen.queryByRole("dialog", { name: "AI usage is not set up" });

  expect(usageDialog()).not.toBeNull();
  expect(notice()).toBeNull();

  // The next status read finds the usage service working.
  window.companion.usageBroken = false;
  await window.wait(6);
  expect(usageDialog()).toBeNull();
  expect(notice()).not.toBeNull();
  expect(seen()).toBeNull();
});

// Opened again from Updates, it gives way to a dialog that needs the customer,
// and stays closed after it: Updates may follow with a dialog of its own.
it("closes for another dialog when it was opened from Updates", async () => {
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(allIds));
  const app = startWindow();
  await app.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  await app.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "What's new" }));
  expect(notice()).not.toBeNull();
  const usageDialog = () => screen.queryByRole("dialog", { name: "AI usage is not set up" });

  app.companion.usageBroken = true;
  await app.wait(6);
  expect(usageDialog()).not.toBeNull();
  expect(notice()).toBeNull();
  // While something else asks, Updates does not offer it either.
  expect(screen.queryByRole("button", { name: "What's new", hidden: true })).toBeNull();

  app.companion.usageBroken = false;
  await app.wait(6);
  expect(usageDialog()).toBeNull();
  expect(notice()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "What's new" }));
  expect(notice()).not.toBeNull();
});

// A newer app on offer brings up the app's own update prompt. Two dialogs
// about updates at once would be one too many.
it("waits while a newer app is on offer", async () => {
  const window = startWindow();
  window.companion.appUpdate = true;
  await window.wait(10);
  expect(notice()).toBeNull();
  expect(seen()).toBeNull();

  window.companion.appUpdate = false;
  await window.wait(6);
  expect(notice()).not.toBeNull();
});

it("opens Settings from the notice and counts it as read", async () => {
  const window = startWindow();
  await window.wait(10);

  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Settings" })[0],
  );
  await window.wait(1);

  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
});

it("opens Themes from a new theme and counts the notice as read", async () => {
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await window.wait(1);

  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);
  expect(screen.getByRole("heading", { name: "Themes" })).toBeTruthy();
});

it("opens again from Updates with the keys of a Windows computer", async () => {
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(allIds));
  const app = startWindow({ os: "windows" });
  await app.wait(10);
  expect(notice()).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  await app.wait(1);
  const again = screen.getByRole("button", { name: "What's new" });
  again.focus();
  fireEvent.click(again);

  expect(notice()?.textContent).toContain(
    "Press Ctrl+Alt+Shift+P in any app to show the next provider on VibeTV.",
  );
  expect(keyCaps()).toEqual(["Ctrl", "Alt", "Shift", "P"]);
  for (const { title } of WHATS_NEW.slice(-3)) {
    expect(notice()?.textContent).toContain(title);
  }
  expect(notice()!.contains(document.activeElement)).toBe(true);
  const page = document.body.innerHTML;

  fireEvent.click(within(notice()!).getByRole("button", { name: "Got it" }));
  await app.wait(1);
  expect(notice()).toBeNull();
  expect(document.activeElement).toBe(again);

  // axe waits on real timers.
  vi.useRealTimers();
  await expectNoAxeViolations(page);
}, 15_000);
