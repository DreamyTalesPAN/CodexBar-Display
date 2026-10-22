// @vitest-environment jsdom
//
// Issue #566: nothing tested the automatic Mac App update prompt. In the native
// Mac App, a newer Mac App version opens the app's own update dialog once per
// offered version, only after setup, and never while a firmware update runs,
// in a normal browser, or in the hosted setup shell.
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { rememberCompletedSetup } from "@/lib/completed-setup-devices";
import { markWhatsNewSeen } from "@/lib/whats-new";
import { ControlCenterApp } from "./control-center-app";
import { openMacAppUpdatePrompt } from "./control-center-runtime";

const runtime = vi.hoisted(() => ({
  hostedShell: false,
  wizardProps: null as null | { macAppUpdate?: { onUpdate: () => void; onDismiss?: () => void } },
}));

vi.mock("./control-center-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./control-center-runtime")>();
  return {
    ...actual,
    openMacAppUpdatePrompt: vi.fn(),
    shouldUseHostedSetupShell: () =>
      runtime.hostedShell || actual.shouldUseHostedSetupShell(),
  };
});

// The real wizard renders; the test keeps its props to press its update offer.
vi.mock("./setup/setup-wizard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./setup/setup-wizard")>();
  return {
    ...actual,
    SetupWizard: (props: Parameters<typeof actual.SetupWizard>[0]) => {
      runtime.wizardProps = props;
      return createElement(actual.SetupWizard, props);
    },
  };
});

const nativeUserAgent = "VibeTVControlCenter/9.9.9+100";
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
};
// A window before setup: no VibeTV has been found or paired yet.
const notSetUp = { active: false, connected: false, paired: false, ready: false };
const installing = {
  id: "firmware-1",
  phase: "installing",
  stage: "flash",
  progress: 40,
  startedAt: "2026-10-13T08:00:00Z",
  logs: [],
};
const complete = { ...installing, phase: "complete", progress: 100, finishedAt: "2026-10-13T08:05:00Z" };

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

// The Companion as this window sees it. Each status read reports the current
// values, so a test changes them between reads.
async function openApp({
  userAgent,
  setupFinished = true,
  firmwareUpdate,
  windows = false,
  releaseCheckFailed = false,
}: {
  userAgent?: string;
  setupFinished?: boolean;
  firmwareUpdate?: typeof installing;
  windows?: boolean;
  releaseCheckFailed?: boolean;
} = {}) {
  const companion = {
    device: setupFinished ? device : notSetUp,
    latestVersion: "9.9.10",
    releaseCheckFailed,
    upToDate: false,
    version: "9.9.9" as string,
    appVersion: "9.9.9" as string | undefined,
    hostedReleaseChecks: 0,
    firmwareUpdate: firmwareUpdate as typeof installing | undefined,
  };
  // A customer who has read "What's new"; it would lie over Overview.
  markWhatsNewSeen();
  // A customer who finished setup for this VibeTV once goes straight on to the
  // Control Center; without it the wizard still shows its closing screen.
  if (setupFinished) {
    rememberCompletedSetup(device.deviceId);
  }
  vi.useFakeTimers();
  if (userAgent) {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  }
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
      if (url.includes("/v1/status")) {
        return jsonResponse({
          ok: true,
          companion: {
            version: companion.version,
            installationMode: "dmg",
            app: { version: companion.appVersion, installedInApplications: true },
            runtime: windows ? { os: "windows" } : undefined,
            update: {
              checkedAt: "2026-10-13T08:00:00Z",
              status: companion.releaseCheckFailed ? "check_failed" : "available",
              latestVersion: companion.latestVersion,
              installedVersion: "9.9.9",
              updateAvailable: !companion.releaseCheckFailed && !companion.upToDate,
              message: "A newer Mac App is available.",
            },
          },
          device: companion.device,
          firmwareUpdate: companion.firmwareUpdate,
        });
      }
      // The release check the hosted shell uses instead of the Companion status.
      if (url.includes("/api/companion/latest")) {
        companion.hostedReleaseChecks += 1;
        return jsonResponse({
          checkedAt: "2026-10-13T08:00:00Z",
          status: "available",
          installedVersion: "9.9.9",
          latestVersion: companion.latestVersion,
          updateAvailable: true,
          message: "A newer Mac App is available.",
        });
      }
      if (url.includes("/api/firmware/latest")) {
        return jsonResponse({
          checkedAt: "2026-10-13T08:00:00Z",
          installedFirmware: device.firmware,
          latestFirmware: device.firmware,
          updateAvailable: false,
          status: "current",
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
  return {
    companion,
    wait,
    text: () => view.container.ownerDocument.body.textContent || "",
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(openMacAppUpdatePrompt).mockClear();
  runtime.hostedShell = false;
  runtime.wizardProps = null;
});

it("does not open the native prompt while setup owns the screen", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });

  // The wizard offers the update in its own calm dialog and starts the visible
  // check from its button; Sparkle's dialog must not come first.
  expect(app.text()).toContain("Welcome to");
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
  await app.wait(20);
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});

it("opens the prompt once setup has handed the screen to the Control Center", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();

  // The VibeTV is found and was set up before: the wizard hands the screen over.
  rememberCompletedSetup(device.deviceId);
  app.companion.device = device;
  await app.wait(20);
  expect(app.text()).not.toContain("Welcome to");
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);
});

it("opens the prompt in the Control Center of a customer who finished setup", async () => {
  const app = await openApp({ userAgent: nativeUserAgent });

  expect(app.text()).not.toContain("Welcome to");
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);
});

it("does not open the prompt again for the same version on later status reads", async () => {
  const app = await openApp({ userAgent: nativeUserAgent });
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);

  // Later reads change nothing about the offer. A firmware update that starts
  // and ends reruns the prompt's check; the same version must not prompt again.
  app.companion.firmwareUpdate = installing;
  await app.wait(5);
  app.companion.firmwareUpdate = complete;
  await app.wait(10);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);

  // A newer version is a new offer and prompts once more.
  app.companion.latestVersion = "9.9.11";
  await app.wait(10);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(2);
});

it("does not open the prompt while a firmware update is in progress", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, firmwareUpdate: installing });
  await app.wait(20);

  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});

it("does not open the prompt in a normal browser", async () => {
  await openApp();

  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});

it("does not open the prompt in the hosted setup shell", async () => {
  runtime.hostedShell = true;
  await openApp({ userAgent: nativeUserAgent });

  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});

it("does not open the prompt again when setup ends after the wizard's own update check", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  const location = { href: "http://localhost/" };
  vi.stubGlobal("location", location);

  // "Update Mac App" in the wizard starts the visible check; Sparkle is cancelled.
  await act(async () => {
    runtime.wizardProps?.macAppUpdate?.onUpdate();
  });
  expect(location.href).toBe("vibetv://check-for-updates");

  // Setup then finishes with the same VibeTV: the same version must not prompt again.
  rememberCompletedSetup(device.deviceId);
  app.companion.device = device;
  await app.wait(20);
  expect(app.text()).not.toContain("Welcome to");
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
});


it("withdraws the setup offer when the runtime check fails after a hosted success", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  expect(runtime.wizardProps?.macAppUpdate).toBeDefined();
  expect(app.companion.hostedReleaseChecks).toBeGreaterThan(0);
  const hostedChecks = app.companion.hostedReleaseChecks;

  // The runtime has a new failed check; the hosted answer is still the old
  // successful check. It must not bring the offer back while offline.
  app.companion.releaseCheckFailed = true;
  await app.wait(10);
  expect(app.companion.hostedReleaseChecks).toBe(hostedChecks);
  expect(runtime.wizardProps?.macAppUpdate).toBeUndefined();
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();

  rememberCompletedSetup(device.deviceId);
  app.companion.device = device;
  await app.wait(20);
  expect(app.text()).not.toContain("Welcome to");
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();

  app.companion.releaseCheckFailed = false;
  await app.wait(10);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);
});

it("offers a late launch update when the runtime release check failed (#892)", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  app.companion.releaseCheckFailed = true;
  await app.wait(10);
  expect(runtime.wizardProps?.macAppUpdate).toBeUndefined();

  // The Mac App's launch check found 9.9.10 after the start had gone on.
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("vibetv:mac-app-update-found", { detail: { version: "9.9.10" } }),
    );
  });
  expect(runtime.wizardProps?.macAppUpdate).toBeDefined();
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();

  // Once setup hands over, the offer prompts like any other.
  rememberCompletedSetup(device.deviceId);
  app.companion.device = device;
  await app.wait(20);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);
});

it("offers a late launch update that was reported before the page mounted (#892)", async () => {
  // The shell reported the version before the page's listener existed; the
  // page reads the last one on mount, and a reload reports it again.
  window.vibetvMacAppUpdateFound = { version: "9.9.10" };
  try {
    await openApp({ userAgent: nativeUserAgent, setupFinished: false, releaseCheckFailed: true });
    expect(runtime.wizardProps?.macAppUpdate).toBeDefined();
  } finally {
    delete window.vibetvMacAppUpdateFound;
  }
});

it("keeps a late launch update while the Companion reports up to date (#892)", async () => {
  // The Mac App's own check found 9.9.10; the hosted release metadata lags.
  // Only the running Mac App reaching that version ends the offer.
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  app.companion.releaseCheckFailed = true;
  await app.wait(10);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("vibetv:mac-app-update-found", { detail: { version: "9.9.10" } }),
    );
  });
  expect(runtime.wizardProps?.macAppUpdate).toBeDefined();

  app.companion.releaseCheckFailed = false;
  app.companion.upToDate = true;
  await app.wait(10);
  expect(runtime.wizardProps?.macAppUpdate).toBeDefined();
});

it("names the late launch update's version when the Companion's release is older (#892)", async () => {
  // The Companion's cached release still names the installed 9.9.9 as latest;
  // the Mac App's launch check found 9.9.10 and that is the offer.
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  app.companion.latestVersion = "9.9.9";
  app.companion.releaseCheckFailed = true;
  await app.wait(10);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("vibetv:mac-app-update-found", { detail: { version: "9.9.10" } }),
    );
  });
  expect(runtime.wizardProps?.macAppUpdate).toMatchObject({ version: "9.9.10" });
});

it("never reads the Companion version as the running Mac App version (#892)", async () => {
  // Without app.version the Companion's 9.9.10 must not clear a pending 9.9.10.
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  app.companion.releaseCheckFailed = true;
  app.companion.appVersion = undefined;
  app.companion.version = "9.9.10";
  await app.wait(10);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("vibetv:mac-app-update-found", { detail: { version: "9.9.10" } }),
    );
  });
  expect(runtime.wizardProps?.macAppUpdate).toBeDefined();
});

it("drops a late launch update once the running Mac App has that version (#892)", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  app.companion.releaseCheckFailed = true;
  await app.wait(10);
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("vibetv:mac-app-update-found", { detail: { version: "9.9.9" } }),
    );
  });
  expect(runtime.wizardProps?.macAppUpdate).toBeUndefined();
});

it("keeps a dismissed setup offer dismissed after setup finishes, but offers a newer version", async () => {
  const app = await openApp({ userAgent: nativeUserAgent, setupFinished: false });
  await act(async () => {
    runtime.wizardProps?.macAppUpdate?.onDismiss?.();
  });
  rememberCompletedSetup(device.deviceId);
  app.companion.device = device;
  await app.wait(20);
  expect(app.text()).not.toContain("Welcome to");
  expect(openMacAppUpdatePrompt).not.toHaveBeenCalled();
  app.companion.latestVersion = "9.9.11";
  await app.wait(10);
  expect(openMacAppUpdatePrompt).toHaveBeenCalledTimes(1);
});
