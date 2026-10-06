// @vitest-environment jsdom
//
// Issue #341: the loopback Control Center route answers 410 Gone in a normal
// browser, so a support report must never present it as a page to open.
import { afterEach, describe, expect, it } from "vitest";

import { collectSupportReport, serializeSupportReport } from "./support-report";
import type {
  SupportDiagnostics,
  SupportReportClientState,
} from "./control-center-types";

const nativeUserAgent = "VibeTVControlCenter/1.4.0+212";
const browserUserAgent = "Mozilla/5.0 (Macintosh)";

const clientState = {
  runtimeSurface: "local-control-center",
  activeTab: "overview",
  companionStatus: "online",
  deviceState: "paired",
  deviceSearchState: "idle",
  deviceCandidates: [],
  recentEvents: [],
} as unknown as SupportReportClientState;

const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const originalUserAgent = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "userAgent",
);

function visit(url: string, userAgent: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(url),
  });
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

async function report(
  diagnostics: SupportDiagnostics = { ok: true },
): Promise<SupportDiagnostics> {
  return collectSupportReport(async () => diagnostics, clientState);
}

afterEach(() => {
  if (originalLocation) {
    Object.defineProperty(window, "location", originalLocation);
  }
  if (originalUserAgent) {
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  }
});

describe("support report surface", () => {
  it("keeps the native loopback route out of customer-navigable fields", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);

    const environment = (await report()).client?.environment;

    expect(environment?.page).toBeUndefined();
    expect(environment?.internalRuntimeAddress).toBe(
      "http://127.0.0.1:47832/control-center",
    );
    expect(environment?.surface).toBe("native-mac-app");
    expect(environment?.appVersion).toBe("1.4.0");
    expect(environment?.appBuild).toBe("212");
  });

  it("treats a loopback browser session as internal too", async () => {
    visit("http://127.0.0.1:47832/control-center", browserUserAgent);

    const environment = (await report()).client?.environment;

    expect(environment?.page).toBeUndefined();
    expect(environment?.internalRuntimeAddress).toBe(
      "http://127.0.0.1:47832/control-center",
    );
    expect(environment?.surface).toBe("browser");
  });

  it("keeps the real public page URL for the hosted report", async () => {
    visit("https://app.vibetv.shop/setup", browserUserAgent);

    const environment = (await report()).client?.environment;

    expect(environment?.page).toBe("https://app.vibetv.shop/setup");
    expect(environment?.internalRuntimeAddress).toBeUndefined();
    expect(environment?.surface).toBe("browser");
  });

  it("records the native surface even when Mac App diagnostics fail", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);

    const fallback = await collectSupportReport(async () => {
      throw new Error("diagnostics unreachable");
    }, clientState);

    expect(fallback.client?.environment.page).toBeUndefined();
    expect(fallback.client?.environment.surface).toBe("native-mac-app");
    expect(serializeSupportReport(fallback)).not.toContain('"page"');
  });
});

// Issue #313: a report always says whether setup events were available.
describe("support report setup log", () => {
  it("keeps the setup log the Mac App captured, including an empty one", async () => {
    const setupLog = { sessionId: "s1", startedAt: "2026-09-24T10:00:00Z", events: [], truncated: false, dropped: 0 };
    expect((await report({ ok: true, setupLog })).setupLog).toEqual(setupLog);
  });

  it("marks the setup log unavailable for an older Mac App or a fallback report", async () => {
    expect((await report({ ok: true })).setupLog).toEqual({ unavailable: true });
    const fallback = await collectSupportReport(async () => {
      throw new Error("diagnostics unreachable");
    }, clientState);
    expect(fallback.setupLog).toEqual({ unavailable: true });
  });
});

// Issue #558: the report a Windows customer downloaded spoke of the Mac. The
// runtime's texts name the Mac; the screens reword them, the report did not.
describe("support report from the Windows app", () => {
  const diagnostics = {
    ok: true,
    companion: {
      installationMode: "dmg",
      update: { message: "Mac App is up to date." },
    },
    setupLog: {
      sessionId: "s1",
      startedAt: "2026-10-08T12:00:00Z",
      truncated: false,
      dropped: 0,
      events: [
        { seq: 1, at: "2026-10-08T12:00:00Z", stage: "service_restart", status: "succeeded", message: "The Mac App's background service started again." },
      ],
    },
    checks: [
      { name: "network_discovery", status: "attention", nextAction: "Keep VibeTV powered on and connected to the same WiFi as this Mac." },
    ],
  } as unknown as SupportDiagnostics;

  it("says what the Windows app's screens say and names its own surface", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);

    const windows = await collectSupportReport(async () => diagnostics, clientState, true);
    const text = serializeSupportReport(windows);

    expect(windows.client?.environment.surface).toBe("native-windows-app");
    expect(text).toContain('"message": "App is up to date."');
    expect(text).toContain('"message": "The app\'s background service started again."');
    expect(text).toContain("the same WiFi as this computer.");
    expect(text).not.toMatch(/\bMac\b|native-mac-app/);
    // The name of the mode in which the app owns the runtime, on both systems.
    expect(text).toContain('"installationMode": "dmg"');
  });

  it("words a report without the app's own diagnostics the same way", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);

    const fallback = await collectSupportReport(async () => {
      throw new Error("diagnostics unreachable");
    }, clientState, true);

    expect(serializeSupportReport(fallback)).not.toMatch(/\bMac\b/);
  });

  it("leaves the Mac App's report as it is", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);

    const mac = await report(diagnostics);
    const text = serializeSupportReport(mac);

    expect(mac.client?.environment.surface).toBe("native-mac-app");
    expect(text).toContain('"message": "Mac App is up to date."');
    expect(text).toContain("The Mac App's background service started again.");
    expect(text).toContain("the same WiFi as this Mac.");
  });
});

// Issue #213: the report carries the Mac App's reliability timeline.
describe("support report timeline", () => {
  it("exports the transitions the Mac App recorded, unchanged", async () => {
    const timeline = {
      version: 1,
      events: [
        { id: 7, at: "2026-10-06T08:00:00Z", component: "device", state: "unreachable", reason: "runtime/serial-write", correlationId: "9f3c2b1a5d6e7f80" },
        { id: 8, at: "2026-10-06T08:00:40Z", component: "device", deviceId: "vibetv-8caab5", state: "reachable", correlationId: "9f3c2b1a5d6e7f80" },
        { id: 9, at: "2026-10-06T08:05:00Z", component: "firmware_update", deviceId: "vibetv-8caab5", state: "rebooting" },
      ],
    };
    const exported = JSON.parse(serializeSupportReport(await report({ ok: true, timeline })));
    expect(exported.timeline).toEqual(timeline);
  });

  it("marks the timeline unavailable for an older Mac App or a fallback report", async () => {
    expect((await report({ ok: true })).timeline).toEqual({ unavailable: true });
    const fallback = await collectSupportReport(async () => {
      throw new Error("diagnostics unreachable");
    }, clientState);
    expect(fallback.timeline).toEqual({ unavailable: true });
  });
});
