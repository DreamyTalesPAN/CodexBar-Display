// @vitest-environment jsdom
//
// Issue #341: the loopback Control Center route answers 410 Gone in a normal
// browser, so a support report must never present it as a page to open.
import { afterEach, describe, expect, it } from "vitest";

import { collectSupportReport, serializeSupportReport, supportReportFilename } from "./support-report";
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
      current: [
        { id: 2, at: "2026-10-01T07:00:00Z", component: "companion", state: "started", correlationId: "9f3c2b1a5d6e7f80" },
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

// Issue #579: the name carried the UTC time, so a report saved late in the
// evening or early in the morning was dated another day than the customer's.
describe("support report file name", () => {
  it("carries the date and time of this computer's clock", () => {
    for (const [hour, time] of [[23, "23-58-07"], [0, "00-58-07"]] as const) {
      expect(supportReportFilename(new Date(2026, 9, 7, hour, 58, 7).toISOString())).toBe(
        `vibetv-support-report-2026-10-07T${time}.json`,
      );
    }
    expect(supportReportFilename("not a time")).toBe("vibetv-support-report-session.json");
  });
});

// Issue #580: the report does not name the computer's account. It learns the
// home folder from its own path fields and writes exactly that folder as `~`.
describe("support report home folder", () => {
  const timeline = {
    version: 1,
    events: [
      { id: 7, at: "2026-10-06T08:00:00Z", component: "device", state: "unreachable", reason: "runtime/serial-write", correlationId: "9f3c2b1a5d6e7f80" },
      { id: 8, at: "2026-10-06T08:00:40Z", component: "provider_check/home", deviceId: "vibetv-8caab5", state: "failed" },
    ],
  };

  async function exported(diagnostics: object, details: string[] = [], windowsHost = false) {
    const collected = await collectSupportReport(
      async () =>
        ({
          ok: true,
          ...diagnostics,
          checks: details.map((detail) => ({ name: "x", status: "fail", detail })),
        }) as unknown as SupportDiagnostics,
      clientState,
      windowsHost,
    );
    const out = JSON.parse(serializeSupportReport(collected));
    return { out, details: out.checks.map((check: { detail: string }) => check.detail) as string[] };
  }

  const macHome = {
    providerSetup: {
      engine: {
        path: "/Users/Jane Doe/Library/Application Support/codexbar-display/bin/codexbar",
        configPath: "/Users/Jane Doe/.codexbar/config.json",
      },
    },
    usageEngine: { path: "/Users/Jane Doe/Library/Application Support/codexbar-display/bin/codexbar" },
  };

  // What the reviews of the earlier rules tried: none of it holds this home
  // folder, so none of it changes.
  const untouched = [
    "/home/jane and /home/bob differ",
    "/Users/jane is not writable. Check the folder and try again.",
    "GET /home/feed returned 500",
    "GET /users/123/profile failed",
    "/Users/Shared/VibeTV/x",
    "C:\\Users\\Public\\Documents\\x",
    "https://example.com/?next=/home/dashboard/x",
    "https://vibetv.shop/home/updates/Users/appcast.xml",
    "HOME=/Users/paul PATH=/usr/bin:/bin",
    "open /Users/paul or use the app at Applications/VibeTV",
    "/users/jane doe/x",
  ];

  it("writes a Mac home folder with spaces as ~ in the three fields and in every text", async () => {
    const { out, details } = await exported({ ...macHome, timeline }, [
      "exec failed: [/Users/Jane Doe/bin/codexbar usage --json]",
      "file:///Users/Jane Doe/Library/x.json",
      "Could not read /Users/Jane Doe. Try again.",
      "/Users/Jane Doe",
      "cwd=/Users/Jane Doe cmd=/Users/Jane Doe/x, {/Users/Jane Doe/y}",
      "/Users/Jane Doer/file",
      "/Users/Jane Doe Smith/file",
      ...untouched,
    ]);

    expect(out.providerSetup.engine).toEqual({
      path: "~/Library/Application Support/codexbar-display/bin/codexbar",
      configPath: "~/.codexbar/config.json",
    });
    expect(out.usageEngine.path).toBe("~/Library/Application Support/codexbar-display/bin/codexbar");
    expect(details).toEqual([
      "exec failed: [~/bin/codexbar usage --json]",
      "file://~/Library/x.json",
      "Could not read ~. Try again.",
      "~",
      "cwd=~ cmd=~/x, {~/y}",
      "/Users/Jane Doer/file",
      "/Users/Jane Doe Smith/file",
      ...untouched,
    ]);
    expect(out.timeline).toEqual(timeline);
    expect(JSON.stringify(out)).not.toContain("/Users/Jane Doe/");
  });

  it("takes the home folder from the settings path when the usage engine is installed for everyone", async () => {
    const { out, details } = await exported(
      {
        providerSetup: {
          engine: { path: "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI", configPath: "/home/jane/.codexbar/config.json" },
        },
        usageEngine: { path: "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI" },
      },
      ["Could not read /home/jane/.codexbar/config.json: permission denied", "GET /home/feed returned 500"],
    );
    expect(out.usageEngine.path).toBe("/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI");
    expect(out.providerSetup.engine.configPath).toBe("~/.codexbar/config.json");
    expect(details).toEqual(["Could not read ~/.codexbar/config.json: permission denied", "GET /home/feed returned 500"]);
  });

  it("writes a Windows home folder as ~ in any spelling Windows takes for it", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);
    const { out, details } = await exported(
      {
        providerSetup: {
          engine: {
            path: "C:\\Program Files\\VibeTV\\codexbar.exe",
            configPath: "C:\\Users\\Jane Doe\\AppData\\Roaming\\CodexBar\\settings.json",
          },
        },
        usageEngine: { path: "C:\\Program Files\\VibeTV\\codexbar.exe" },
      },
      [
        "open c:/users/jane doe/AppData/x.json failed",
        // A line the engine printed as JSON keeps its doubled backslashes.
        '{"path":"C:\\\\Users\\\\Jane Doe\\\\AppData\\\\x.json"}',
        "C:\\Users\\Jane Doe",
        "C:\\Users\\Jane Doer\\file",
        "C:\\Users\\Jane Doe Smith\\file",
        "C:\\Users\\Public\\Documents\\x",
        "D:\\Users\\Jane Doe\\x",
      ],
      true,
    );
    expect(out.providerSetup.engine.configPath).toBe("~\\AppData\\Roaming\\CodexBar\\settings.json");
    expect(details).toEqual([
      "open ~/AppData/x.json failed",
      '{"path":"~\\\\AppData\\\\x.json"}',
      "~",
      "C:\\Users\\Jane Doer\\file",
      "C:\\Users\\Jane Doe Smith\\file",
      "C:\\Users\\Public\\Documents\\x",
      "D:\\Users\\Jane Doe\\x",
    ]);
  });

  it("does the same for a home folder on a share", async () => {
    const { out, details } = await exported(
      { usageEngine: { path: "\\\\fileserver\\Users\\Jane Doe\\AppData\\Local\\VibeTV\\codexbar.exe" } },
      ["Cannot read \\\\fileserver\\Users\\Jane Doe\\x.json now", "\\\\fileserver\\Users\\Jane Doer\\x.json"],
    );
    expect(out.usageEngine.path).toBe("~\\AppData\\Local\\VibeTV\\codexbar.exe");
    expect(details).toEqual(["Cannot read ~\\x.json now", "\\\\fileserver\\Users\\Jane Doer\\x.json"]);
  });

  it("changes nothing when the report names no home folder", async () => {
    const texts = ["exec failed: [/Users/Jane Doe/bin/codexbar usage --json]", "C:\\Users\\Jane Doe\\x", ...untouched];
    for (const diagnostics of [
      {},
      { usageEngine: { path: "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI" } },
      { usageEngine: { path: "/Users/Shared/VibeTV/codexbar" } },
      { usageEngine: { path: "see /Users/Jane Doe/bin/codexbar" } },
    ]) {
      expect((await exported(diagnostics, texts)).details).toEqual(texts);
    }
  });

  it("takes a megabyte of log lines in one pass", async () => {
    const line = "open /Users/Jane Doe/Library/x.json failed; /Users/jane /home/feed C:\\Users\\x\n";
    const log = line.repeat(Math.ceil((1 << 20) / line.length));
    for (const diagnostics of [macHome, { usageEngine: { path: "C:\\Users\\Jane Doe\\AppData\\Local\\VibeTV\\codexbar.exe" } }]) {
      const collected = await report({ ok: true, ...diagnostics, checks: [{ name: "x", status: "fail", detail: log }] } as unknown as SupportDiagnostics);
      const started = performance.now();
      const text = serializeSupportReport(collected);
      expect(performance.now() - started).toBeLessThan(100);
      expect(text.length).toBeGreaterThan(1 << 19);
    }
  });
});
