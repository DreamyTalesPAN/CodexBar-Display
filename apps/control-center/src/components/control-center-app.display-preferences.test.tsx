// @vitest-environment jsdom
//
// Issue #183: Settings reads the app's own display preferences from the
// registry, saves a change at once, and keeps the stored value when the write
// is refused.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
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

// The Mac App as this window sees it: one stored display preference.
function startWindow() {
  const companion = { stored: usageDisplay, refuseWrites: false, requests: [] as string[] };
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
          device,
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
        return jsonResponse({ ok: true, items: [companion.stored] });
      }
      if (url.endsWith("/v1/preferences?section=providers")) {
        return jsonResponse({ ok: true, items: [] });
      }
      if (url.endsWith(`/v1/preferences/${usageDisplay.id}`) && method === "PATCH") {
        if (companion.refuseWrites) {
          return jsonResponse({ ok: false, error: refused }, 502);
        }
        const { value } = JSON.parse(String(init?.body));
        companion.stored = { ...usageDisplay, value, effectiveValue: value ?? "used" };
        return jsonResponse({ ok: true, item: companion.stored });
      }
      if (url.endsWith("/v1/settings")) {
        const standby = init?.body
          ? JSON.parse(String(init.body)).standby
          : { enabled: false, timeoutMinutes: 1, brightnessPercent: 20 };
        return jsonResponse({ ok: true, settings: { standby } });
      }
      if (url.endsWith("/v1/provider-display")) {
        return jsonResponse({
          ok: true,
          selection: { mode: "automatic", providerIds: [], configured: true, valid: true },
        });
      }
      if (url.includes("/v1/usage")) {
        return jsonResponse({ ok: true, usageMode: "used", providers: [] });
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
  return {
    companion,
    text: () => view.container.ownerDocument.body.textContent || "",
    wait,
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
