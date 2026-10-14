// @vitest-environment jsdom
//
// Issue #424: the app's global shortcut for the next provider is named in
// Settings, and a press shows up there although this page did not save it.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

const press =
  "Press ⌃⌥⌘P in any app to show the next provider. This switches to Manual.";
const refused =
  "The shortcut ⌃⌥⌘P for the next provider is not available: another app may already be using these keys.";

const themeSpec = { active: true, path: "/themes/codex/spec-v7.json", hash: "hash-v7" };

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

// Settings of a window with this user agent, on a Mac with two working
// providers and Automatic chosen.
async function openSettings(userAgent: string) {
  const companion = {
    selection: {
      mode: "automatic",
      providerIds: ["codex", "claude"],
      configured: true,
      valid: true,
    },
  };
  // A customer who has read "What's new"; it would lie over Overview.
  markWhatsNewSeen();
  vi.useFakeTimers();
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
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
          companion: { version: "9.9.9", installationMode: "dmg" },
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
        return jsonResponse({
          themeId: "codex",
          spec: { p: [] },
          specPath: themeSpec.path,
          specHash: themeSpec.hash,
          assets: {},
        });
      }
      if (url.endsWith("/v1/preferences?section=providers")) {
        return jsonResponse({
          ok: true,
          items: [provider("codex", "Codex"), provider("claude", "Claude")],
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
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await wait(1);
  return {
    companion,
    text: () => view.container.ownerDocument.body.textContent || "",
    wait,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("names the shortcut in Settings and shows what a press chose", async () => {
  const settings = await openSettings("VibeTVControlCenter/1.2.3+45");

  expect(settings.text()).toContain(press);
  expect(settings.text()).not.toContain("Show this provider");

  // The customer presses the shortcut: the Mac App stores Manual on Claude
  // and tells the page that the display choice changed.
  settings.companion.selection = {
    mode: "fixed",
    providerIds: ["claude"],
    configured: true,
    valid: true,
  };
  window.dispatchEvent(new Event("vibetv:provider-display-changed"));
  await settings.wait(1);

  const manual = screen.getByText("Show this provider").parentElement!;
  expect(
    within(manual).getByRole("button", { name: "Claude" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    within(manual).getByRole("button", { name: "Codex" }).getAttribute("aria-pressed"),
  ).toBe("false");
  // Manual is chosen now, so the line no longer says a press switches to it.
  expect(settings.text()).toContain("Press ⌃⌥⌘P in any app to show the next provider.");
  expect(settings.text()).not.toContain("This switches to Manual.");
});

it("says in Settings when the system refused the shortcut's keys", async () => {
  const settings = await openSettings(
    "VibeTVControlCenter/1.2.3+45 ProviderShortcut/unavailable",
  );

  expect(settings.text()).toContain(refused);
  expect(settings.text()).not.toContain(press);
});

it("names no shortcut in a browser, which has none", async () => {
  const settings = await openSettings("Mozilla/5.0");

  expect(settings.text()).toContain("Display mode");
  expect(settings.text()).not.toContain("⌃⌥⌘P");
});
