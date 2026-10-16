// @vitest-environment jsdom
//
// The Mac App update offer on the "VibeTV not found" pages (#561) is a Mac
// offer. The app hands it to the setup wizard only in a Mac window, so a
// Windows window gets no offer at all.
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterApp } from "./control-center-app";

const wizardProps = vi.hoisted(() => [] as Array<{ macAppUpdate?: unknown }>);
vi.mock("./setup/setup-wizard", () => ({
  SetupWizard: (props: { macAppUpdate?: unknown }) => {
    wizardProps.push(props);
    return null;
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// A customer who has not set VibeTV up yet, with a newer Mac App on offer.
async function setupWindowOn(os: "darwin" | "windows") {
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
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("VibeTVControlCenter/1.0.63");
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
            app: { version: "1.0.63" },
            runtime: { os },
            update: { updateAvailable: true, latestVersion: "1.0.64" },
          },
          setup: { providerSelectionRequired: true, providerSelectionComplete: false },
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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  return wizardProps.at(-1);
}

afterEach(() => {
  cleanup();
  wizardProps.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("offers the Mac App update to a customer on a Mac", async () => {
  const props = await setupWindowOn("darwin");
  expect(props?.macAppUpdate).toBeTruthy();
});

it("offers no Mac App update on a Windows computer", async () => {
  const props = await setupWindowOn("windows");
  expect(props).toBeTruthy();
  expect(props?.macAppUpdate).toBeUndefined();
});
