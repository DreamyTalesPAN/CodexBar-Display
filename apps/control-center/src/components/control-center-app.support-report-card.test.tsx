// @vitest-environment jsdom
//
// Support › Run diagnostics collects the same snapshot as Create report, but
// only Create report may switch the Support report card to Copy / Download.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

// A /v1/diagnostics error becomes a fallback report; only a collection that
// throws reaches the error dialog, so the failure test makes it throw.
const collection = vi.hoisted(() => ({ fail: false }));
vi.mock("./support-report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./support-report")>();
  return {
    ...actual,
    collectSupportReport: (...args: Parameters<typeof actual.collectSupportReport>) => {
      if (collection.fail) {
        return Promise.reject(new Error("Collector failed"));
      }
      return actual.collectSupportReport(...args);
    },
  };
});

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  collection.fail = false;
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

let diagnosticsRequests = 0;

function startApp(
  diagnosticsReply: () => Promise<Response> = async () => jsonResponse({
    ok: true,
    generatedAt: "2026-10-18T06:00:00.000Z",
    checks: [],
  }),
  providerSetup?: unknown,
) {
  diagnosticsRequests = 0;
  window.localStorage.clear();
  // A customer who has read "What's new"; it would lie over Support.
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
            display: { themeSpec: { active: true, renderOk: true } },
            health: { ok: true },
          },
          providerSetup,
        });
      }
      if (url.includes("/v1/diagnostics")) {
        diagnosticsRequests += 1;
        return diagnosticsReply();
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
          settings: { standby: { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 } },
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
      createElement(ControlCenterApp, { catalog: { themes: [] } as never }),
    ),
  );
}

async function wait(seconds: number) {
  for (let quarter = 0; quarter < seconds * 4; quarter += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }
}

it("keeps Create report on the Support report card after Run diagnostics, and Create report changes it", async () => {
  startApp();
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);

  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  await wait(3);
  // Run diagnostics filled the shared snapshot; the card still offers Create report.
  expect(screen.getByRole("button", { name: "Create report" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Create report" }));
  await wait(3);
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Create again" })).toBeTruthy();
});

function recentActivity() {
  return within(
    screen.getByText("Recent activity").closest('[data-slot="card"]') as HTMLElement,
  ).queryByRole("list")?.textContent ?? "";
}

it("writes no Recent activity entry for a Run diagnostics that succeeds", async () => {
  startApp();
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);
  const before = recentActivity();

  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  await wait(3);

  expect(diagnosticsRequests).toBe(1);
  expect(recentActivity()).toBe(before);
  expect(recentActivity()).not.toContain("Support report");
});

it("writes no Recent activity entry when Run diagnostics fails", async () => {
  startApp();
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);
  const before = recentActivity();

  collection.fail = true;
  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  await wait(3);

  expect(recentActivity()).toBe(before);
  expect(document.body.textContent).not.toContain("Support report failed");
  expect(screen.getByRole("button", { name: "Run diagnostics" }).hasAttribute("disabled")).toBe(false);
});

it("does not start a second report while Run diagnostics is collecting", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  startApp(async () => {
    await held;
    return jsonResponse({ ok: true, generatedAt: "2026-10-18T06:00:00.000Z", checks: [] });
  });
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);

  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  await wait(1);
  const createReport = screen.getByRole("button", { name: "Create report" }) as HTMLButtonElement;
  expect(createReport.disabled).toBe(true);
  fireEvent.click(createReport);
  expect(diagnosticsRequests).toBe(1);

  release();
  await wait(3);
  expect(diagnosticsRequests).toBe(1);
});

it("gives a report requested from setup the report Run diagnostics is collecting, with one request", async () => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A usage service that cannot answer puts the setup usage dialog on screen,
  // and its "Create support report" is the second caller.
  startApp(
    async () => {
      await held;
      return jsonResponse({ ok: true, generatedAt: "2026-10-18T06:00:00.000Z", checks: [] });
    },
    { status: "setup_required", engine: { status: "not_configured" }, providers: [] },
  );
  await wait(10);
  fireEvent.click(screen.getByRole("button", { name: "Support" }));
  await wait(2);

  fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
  await wait(1);
  fireEvent.click(screen.getByRole("button", { name: "Create support report" }));
  await wait(1);
  expect(diagnosticsRequests).toBe(1);

  release();
  await wait(3);
  expect(diagnosticsRequests).toBe(1);
  expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
});
