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

// Issue #580: the folder under the home root is the account name of the
// computer. Support needs the rest of the path, not the name.
describe("support report home folder", () => {
  const timeline = {
    version: 1,
    events: [
      { id: 7, at: "2026-10-06T08:00:00Z", component: "device", state: "unreachable", reason: "runtime/serial-write", correlationId: "9f3c2b1a5d6e7f80" },
      { id: 8, at: "2026-10-06T08:00:40Z", component: "provider_check/home", deviceId: "vibetv-8caab5", state: "failed" },
    ],
  };

  it("writes the home folder as ~ in every path of a Mac report", async () => {
    const exported = JSON.parse(
      serializeSupportReport(
        await report({
          ok: true,
          providerSetup: {
            engine: {
              path: "/Users/Jane Doe/Library/Application Support/codexbar-display/bin/codexbar",
              configPath: "/Users/Jane Doe/.codexbar/config.json",
            },
          },
          usageEngine: { path: "/Users/paulanduschus/Library/Application Support/codexbar-display/bin/codexbar" },
          checks: [
            { name: "usage_engine", status: "fail", detail: "Could not read /Users/paulanduschus/.codexbar/config.json: permission denied (/home/jane)" },
          ],
          companion: { update: { feedUrl: "https://vibetv.shop/home/updates/Users/appcast.xml" } },
          timeline,
        } as unknown as SupportDiagnostics),
      ),
    );

    expect(exported.providerSetup.engine).toEqual({
      path: "~/Library/Application Support/codexbar-display/bin/codexbar",
      configPath: "~/.codexbar/config.json",
    });
    expect(exported.usageEngine.path).toBe("~/Library/Application Support/codexbar-display/bin/codexbar");
    expect(exported.checks[0].detail).toBe("Could not read ~/.codexbar/config.json: permission denied (~)");
    // A web address is not a path on this computer.
    expect(exported.companion.update.feedUrl).toBe("https://vibetv.shop/home/updates/Users/appcast.xml");
    expect(exported.timeline).toEqual(timeline);
    expect(JSON.stringify(exported)).not.toMatch(/Jane|paulanduschus/);
  });

  it("does the same for a Windows report, on any drive and with either slash", async () => {
    visit("http://127.0.0.1:47832/control-center", nativeUserAgent);
    const windows = await collectSupportReport(
      async () =>
        ({
          ok: true,
          providerSetup: {
            engine: {
              path: "C:\\Users\\Jane Doe\\AppData\\Local\\VibeTV\\codexbar.exe",
              configPath: "d:/users/jane/.codexbar/config.json",
            },
          },
          usageEngine: { path: "C:\\Users\\jane\\AppData\\Local\\VibeTV\\codexbar.exe" },
          // A line the engine printed as JSON keeps its doubled backslashes.
          checks: [{ name: "usage_engine", status: "fail", detail: '{"path":"C:\\\\Users\\\\jane\\\\AppData\\\\x.json"}' }],
        }) as unknown as SupportDiagnostics,
      clientState,
      true,
    );
    const exported = JSON.parse(serializeSupportReport(windows));

    expect(exported.providerSetup.engine).toEqual({
      path: "~\\AppData\\Local\\VibeTV\\codexbar.exe",
      configPath: "~/.codexbar/config.json",
    });
    expect(exported.usageEngine.path).toBe("~\\AppData\\Local\\VibeTV\\codexbar.exe");
    expect(exported.checks[0].detail).toBe('{"path":"~\\\\AppData\\\\x.json"}');
    expect(JSON.stringify(exported)).not.toMatch(/jane/i);
  });

  it("does the same for a Linux home", async () => {
    const exported = JSON.parse(
      serializeSupportReport(
        await report({ ok: true, usageEngine: { path: "/home/jane/.local/share/codexbar-display/bin/codexbar" } } as unknown as SupportDiagnostics),
      ),
    );
    expect(exported.usageEngine.path).toBe("~/.local/share/codexbar-display/bin/codexbar");
  });
});

// Issue #579: the name carried the UTC time, so a report saved late in the
// evening or early in the morning was dated another day than the customer's.
describe("support report file name", () => {
  it("carries the date and time of this computer's clock", () => {
    for (const [hour, time] of [[23, "23-58-07-000"], [0, "00-58-07-000"]] as const) {
      expect(supportReportFilename(new Date(2026, 9, 7, hour, 58, 7).toISOString())).toBe(
        `vibetv-support-report-2026-10-07T${time}.json`,
      );
    }
    expect(supportReportFilename("not a time")).toBe("vibetv-support-report-session.json");
  });
});

// A review of the first rule (issue #580): it took words after a path and
// read web routes as home folders. Only the name behind the home root goes.
describe("support report home folder, in a sentence", () => {
  async function exportedDetail(detail: string): Promise<string> {
    const exported = JSON.parse(
      serializeSupportReport(
        await report({ ok: true, checks: [{ name: "x", status: "fail", detail }] } as unknown as SupportDiagnostics),
      ),
    );
    return exported.checks[0].detail;
  }

  it.each([
    // The words after the name stay.
    ["No such directory /Users/paul. Run setup again, then retry.", "No such directory ~. Run setup again, then retry."],
    ["Log in as /Users/paul (admin) please", "Log in as ~ (admin) please"],
    ["HOME=/Users/paul PATH=/usr/bin:/bin", "HOME=~ PATH=/usr/bin:/bin"],
    ["cwd=/Users/paul cmd=/Applications/VibeTV.app/Contents/MacOS/x", "cwd=~ cmd=/Applications/VibeTV.app/Contents/MacOS/x"],
    ["open /Users/paul or use the app at Applications/VibeTV", "open ~ or use the app at Applications/VibeTV"],
    ["/Users/paul: missing", "~: missing"],
    ["/Users/paul is missing\nRun setup again.", "~ is missing\nRun setup again."],
    // A text that is a home path to its end is the name to its end: half a
    // name must not stay. A sentence of this shape loses its words instead.
    ["/Users/Jane Doe", "~"],
    ["/home/jane", "~"],
    ["C:\\Users\\Jane Doe", "~"],
    ["C:\\\\Users\\\\Jane Doe", "~"],
    ["d:/users/Jane van der Doe", "~"],
    ["\\\\fileserver\\Users\\Jane Doe", "~"],
    ["/Users/Jane Doe/Library/x", "~/Library/x"],
    ["/Users/paul is missing", "~"],
    // A name with spaces is a name where the path goes on behind it.
    ["/Users/Paul Anduschus/Library/x", "~/Library/x"],
    ["Could not open /Users/Paul Anduschus/Library/x today", "Could not open ~/Library/x today"],
    ["C:\\Users\\Jane van Doe\\AppData\\Local\\VibeTV\\codexbar.exe", "~\\AppData\\Local\\VibeTV\\codexbar.exe"],
    // A share on another computer names the account too.
    ["\\\\fileserver\\Users\\paul\\AppData\\Roaming\\codexbar-display", "~\\AppData\\Roaming\\codexbar-display"],
    ["Cannot read \\\\fileserver\\Users\\paul\\x.json now", "Cannot read ~\\x.json now"],
    // What stands in front of the path stays.
    ["[/Users/paul/x] and \\\\?\\C:\\Users\\paul\\x", "[/Users/paul/x] and \\\\?\\~\\x"],
    ["see https://vibetv.shop/help and /home/jane/.codexbar", "see https://vibetv.shop/help and ~/.codexbar"],
  ])("%s", async (detail, want) => {
    expect(await exportedDetail(detail)).toBe(want);
  });

  it.each([
    // Folders every computer has are not an account.
    "C:\\Users\\Public\\Documents\\x",
    "/Users/Shared/VibeTV/x",
    "/Users/Shared",
    "C:\\Users\\Public",
    // A web route, a query and a folder deeper in a path are not a home folder.
    "GET /users/123/profile failed",
    "https://example.com/?next=/home/dashboard/x",
    "https://example.com/Users/paul/x",
    "/Volumes/Backup/Users/paul/x",
    "D:\\Data\\Users\\paul\\x",
    '{"path":"D:\\\\Data\\\\Users\\\\paul\\\\x"}',
  ])("leaves %s as it is", async (detail) => {
    expect(await exportedDetail(detail)).toBe(detail);
  });
});
