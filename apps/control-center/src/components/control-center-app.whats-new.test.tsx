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

// The catalog theme the newest "New theme" entry announces.
const gauge = {
  id: "gauge",
  themeId: "gauge",
  title: "Gauge",
  isFree: true,
  priceLabel: "Free",
  packUrl: "/theme-packs/gauge.zip",
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  source: "github-catalog",
  themeSpecPath: "/themes/u/gauge.json",
  usage: "live",
};

// jsdom scrolls nothing. Each call notes what was brought into view, and moves
// the window as a browser would, so a later return to the top would show.
function watchScrolling() {
  const shown: Element[] = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    shown.push(this);
    document.documentElement.scrollTop = 400;
  };
  return shown;
}

// Who watches the height of the page. jsdom lays nothing out, so a test says
// when the page grew: the customer's own themes, read after Themes opened,
// stand above the catalog's rows.
const pageWatchers = new Set<() => void>();
const pageGrew = () => act(() => pageWatchers.forEach((changed) => changed()));

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// The app window of a customer with a connected VibeTV. `setUp: false` is a
// customer who has not chosen their providers yet, so setup is still to do.
// `newVibeTV`: the VibeTV is as it comes out of the box, without a theme.
function startWindow({
  setUp = true,
  os = "darwin",
  appVersion = "1.0.63",
  newVibeTV = false,
} = {}) {
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
      constructor(private readonly changed: () => void) {}
      observe(element: Element) {
        if (element === document.body) {
          pageWatchers.add(this.changed);
        }
      }
      unobserve() {}
      disconnect() {
        pageWatchers.delete(this.changed);
      }
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
            ready: !newVibeTV,
            connectionState: "ready",
            deviceId: "16199235",
            target: "cable://vibetv",
            board: "esp8266",
            firmware: "9999.0.524",
            activeTheme: newVibeTV ? "theme-missing" : "codex",
            display: newVibeTV ? undefined : { themeSpec },
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
      createElement(ControlCenterApp, { catalog: { themes: [gauge] } as never }),
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
  pageWatchers.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

it("tells a set-up customer what is new once, on Overview, until they close it", async () => {
  const window = startWindow();
  await window.wait(10);
  // In a short window only the list scrolls. The button that has the focus
  // stands outside it, so it stays in view and the list stays at its start.
  const list = notice()!.querySelector("ul")!;
  expect(list.className).toContain("overflow-y-auto");
  expect(notice()!.className).not.toContain("overflow-y-auto");
  expect(list.contains(within(notice()!).getByRole("button", { name: "Got it" }))).toBe(false);

  const text = notice()?.textContent ?? "";
  expect(text).toContain("Version 1.0.63");
  for (const sentence of [
    "New theme: Gauge",
    "A half ring that fills as you use your limit.",
    "New theme: Token Counter",
    "The tokens of your session as one large number.",
    "New theme: Pace Meter",
    "Shows whether your limit lasts until it resets.",
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
    "New theme: Pace Meter",
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

// Providers that were set up before, by another app on this computer, leave
// no provider step. The VibeTV out of the box still makes it a first setup.
it("tells a customer with a new VibeTV nothing, also without a provider step", async () => {
  const window = startWindow({ newVibeTV: true });
  await window.wait(10);

  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);
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

// The app can move this window to another page under the notice, for example
// to Themes when an install was started elsewhere. That page has dialogs of
// its own, so the notice that was opened on Updates ends there.
it("closes when the window leaves Updates under the reopened notice", async () => {
  window.localStorage.setItem(SEEN_KEY, JSON.stringify(allIds));
  const app = startWindow();
  await app.wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  await app.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "What's new" }));
  expect(notice()).not.toBeNull();

  // The dialog covers the page; the app itself still can switch it.
  fireEvent.click(screen.getByRole("button", { name: "Usage", hidden: true }));
  await app.wait(1);
  expect(notice()).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Updates" }));
  await app.wait(1);
  expect(notice()).toBeNull();
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

// Issue #584: "Show me in Settings" opened Settings at its top, with the
// control the entry is about further down. The window here is on Manual, where
// `Switch providers` is not on the page: the group with the two mode cards is
// what the customer is shown.
it.each([
  ["Choose how often VibeTV switches", "Display mode"],
  ["Show what is used or what is left", "Display"],
])("opens Settings from the entry %s at the group %s and counts the notice as read", async (title, group) => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  document.documentElement.scrollTop = 900;

  fireEvent.click(
    within(
      within(notice()!).getByRole("heading", { name: title }).closest("li")!,
    ).getByRole("button", { name: "Show me in Settings" }),
  );
  await window.wait(1);

  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(shown).toEqual([
    screen.getByRole("heading", { name: group }).closest("section"),
  ]);
  // The page was put at its top first, and the group brought into view after.
  expect(document.documentElement.scrollTop).toBe(400);
  expect(screen.queryByRole("combobox", { name: "Switch providers" })).toBeNull();
});

it("brings nothing into view when Settings is opened from the sidebar afterwards", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Settings" })[0],
  );
  await window.wait(1);
  shown.length = 0;

  fireEvent.click(screen.getByRole("button", { name: "Overview" }));
  await window.wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await window.wait(1);

  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(shown).toEqual([]);
  expect(document.documentElement.scrollTop).toBe(0);
});

it("opens Themes from a new theme at that theme and counts the notice as read", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await window.wait(1);

  expect(notice()).toBeNull();
  expect(seen()).toEqual(allIds);
  expect(screen.getByRole("heading", { name: "Themes" })).toBeTruthy();
  // Issue #584: the list is longer than the window; the row of the theme the
  // entry announces is brought into view.
  expect(shown).toEqual([
    screen.getByRole("button", { name: "Preview Gauge" }).closest("[role=listitem]"),
  ]);
});

// Seen in the Windows app with nine own themes: their rows were laid out after
// the row of the new theme had been brought into view, and pushed it about
// 870 px below the window.
it("brings the new theme into view again when the list above it grows, until the customer scrolls", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await window.wait(1);
  const row = screen.getByRole("button", { name: "Preview Gauge" }).closest("[role=listitem]");
  shown.length = 0;

  pageGrew();
  pageGrew();
  expect(shown).toEqual([row, row]);

  fireEvent.wheel(document.body);
  pageGrew();
  expect(shown).toEqual([row, row]);
});

// Found in review: with no end in time, a height change much later (install
// progress, a notice that goes away) pulled the page back, for a customer who
// had moved it with the scrollbar, which none of the four inputs reports.
it("stops bringing the new theme into view two seconds after the link was clicked", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await window.wait(1);
  pageGrew();
  expect(shown.length).toBeGreaterThan(1);
  shown.length = 0;

  await window.wait(1);
  pageGrew();

  expect(shown).toEqual([]);
});

it("ends at the customer's input even when a control keeps the event to itself", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await vi.advanceTimersByTimeAsync(0);
  shown.length = 0;
  const control = screen.getByRole("heading", { name: "Themes" });
  control.addEventListener("keydown", (event) => event.stopPropagation());

  fireEvent.keyDown(control);
  pageGrew();

  expect(shown).toEqual([]);
});

it("brings the place into view once in an app that cannot watch the page's height", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  vi.stubGlobal("ResizeObserver", undefined);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await window.wait(1);

  expect(screen.getByRole("heading", { name: "Themes" })).toBeTruthy();
  expect(shown).toEqual([
    screen.getByRole("button", { name: "Preview Gauge" }).closest("[role=listitem]"),
  ]);
});

it("leaves a page alone that grows after the customer went on from Themes", async () => {
  const shown = watchScrolling();
  const window = startWindow();
  await window.wait(10);
  fireEvent.click(
    within(notice()!).getAllByRole("button", { name: "Show me in Themes" })[0],
  );
  await window.wait(1);
  shown.length = 0;

  // The sidebar is used with the keyboard here, so it is leaving the page
  // that ends it and not a click.
  act(() => screen.getByRole("button", { name: "Settings" }).click());
  await window.wait(1);
  pageGrew();

  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(shown).toEqual([]);
  expect(document.documentElement.scrollTop).toBe(0);
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
