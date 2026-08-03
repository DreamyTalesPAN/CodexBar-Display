import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CompanionInfo,
  SupportDiagnostics,
  SupportReportClientState,
} from "./control-center-types";
import { collectSupportReport } from "./support-report";

const companion: CompanionInfo = {
  app: {
    version: "1.0.98",
    build: "198",
  },
};

function clientState(
  runtimeSurface: SupportReportClientState["runtimeSurface"],
): SupportReportClientState {
  return {
    runtimeSurface,
    activeTab: "overview",
    companionStatus: "online",
    companion,
    deviceState: "unknown",
    deviceSearchState: "idle",
    deviceCandidates: [],
    recentEvents: [],
  };
}

function stubBrowser(origin: string, pathname: string): void {
  vi.stubGlobal("window", {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    location: { origin, pathname },
  });
  vi.stubGlobal("navigator", {
    userAgent: "VibeTVControlCenter/1.0.98",
    platform: "MacIntel",
    language: "en-US",
    onLine: true,
  });
  vi.stubGlobal("document", { visibilityState: "visible" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collectSupportReport", () => {
  it("keeps the native report non-navigable and preserves app metadata", async () => {
    stubBrowser("http://127.0.0.1:47832", "/control-center");

    const diagnostics: SupportDiagnostics = {
      ok: true,
      companion,
    };
    const report = await collectSupportReport(
      async () => diagnostics,
      clientState("local-control-center"),
    );

    expect(report.client?.environment).not.toHaveProperty("page");
    expect(report.client?.state.runtimeSurface).toBe("local-control-center");
    expect(report.client?.state.companion?.app).toEqual(companion.app);
    expect(report.companion?.app).toEqual(companion.app);
  });

  it("includes the public page for hosted setup", async () => {
    stubBrowser("https://app.vibetv.shop", "/control-center");

    const report = await collectSupportReport(
      async () => ({ ok: true }),
      clientState("hosted-setup"),
    );

    expect(report.client?.environment.page).toBe(
      "https://app.vibetv.shop/control-center",
    );
  });

  it("keeps fallback reports non-navigable when the surface is unknown", async () => {
    stubBrowser("http://127.0.0.1:47832", "/control-center");

    const report = await collectSupportReport(
      async () => {
        throw new Error("Companion unavailable");
      },
      clientState("unknown"),
    );

    expect(report.reportType).toBe("control_center_fallback");
    expect(report.client?.environment).not.toHaveProperty("page");
    expect(report.client?.state.companion?.app).toEqual(companion.app);
    expect(report.collectionErrors?.[0]?.message).toBe("Companion unavailable");
  });
});
