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
