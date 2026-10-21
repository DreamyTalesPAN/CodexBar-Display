import { describe, expect, it } from "vitest";
import {
  FINISH_CODEXBAR_RECOVERY_URL,
  hostTimeLocale,
  isNativeControlCenterUserAgent,
  localThemeRenderPackUrl,
  nativeControlCenterAppBuild,
  nativeProviderShortcut,
  REPAIR_CODEXBAR_URL,
  REPAIR_CONTROL_CENTER_RUNTIME_URL,
  RESTART_CONTROL_CENTER_URL,
} from "./control-center-runtime";

// Issue #890: the shell passes the computer's region and hour cycle in its user
// agent. English language with German region and 24 h must show 13:05, not 1:05 PM.
describe("host time locale", () => {
  const at = new Date("2026-10-21T13:05:09Z");
  const timeOf = (locale: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
    }).format(at);

  it("reads the locale the shell passed, next to the version and provider shortcut", () => {
    const withLocale = "VibeTVControlCenter/1.2.3+45 Locale/en-DE-u-hc-h23";
    const refused = `${withLocale} ProviderShortcut/unavailable`;

    expect(hostTimeLocale(withLocale)).toBe("en-DE-u-hc-h23");
    expect(hostTimeLocale(refused)).toBe("en-DE-u-hc-h23");
    expect(nativeControlCenterAppBuild(refused)).toEqual({
      version: "1.2.3",
      build: "45",
    });
    expect(nativeProviderShortcut(refused)).toBe("unavailable");
  });

  it("keeps de-DE with 24 hours when no shell passed a locale", () => {
    expect(hostTimeLocale("Mozilla/5.0")).toBe("de-DE");
    expect(hostTimeLocale("VibeTVControlCenter/1.2.3+45")).toBe("de-DE");
  });

  it("formats 24 h and 12 h from the hour cycle, whatever the language", () => {
    expect(timeOf(hostTimeLocale("VibeTVControlCenter/1.2.3+45 Locale/en-DE-u-hc-h23"))).toBe(
      "13:05:09",
    );
    expect(timeOf(hostTimeLocale("VibeTVControlCenter/1.2.3+45 Locale/en-US-u-hc-h12"))).toBe(
      "01:05:09 PM",
    );
    expect(timeOf(hostTimeLocale("Mozilla/5.0"))).toBe("13:05:09");
  });
});

describe("native Control Center recovery", () => {
  it("recognizes only the native WebView user agent", () => {
    expect(isNativeControlCenterUserAgent("VibeTVControlCenter/1.2.3+45")).toBe(
      true,
    );
    expect(
      isNativeControlCenterUserAgent(
        "Mozilla/5.0 VibeTVControlCenter/1.2.3+45",
      ),
    ).toBe(false);
    expect(isNativeControlCenterUserAgent("Mozilla/5.0")).toBe(false);
  });

  // Issue #424: the app reports through its user agent when the system
  // refused the keys of its provider shortcut.
  it("reads from the user agent whether the provider shortcut is available", () => {
    const refused = "VibeTVControlCenter/1.2.3+45 ProviderShortcut/unavailable";

    expect(nativeProviderShortcut("VibeTVControlCenter/1.2.3+45")).toBe(
      "available",
    );
    expect(nativeProviderShortcut(refused)).toBe("unavailable");
    // A browser has no global shortcut at all.
    expect(nativeProviderShortcut("Mozilla/5.0")).toBeNull();
    // The support report still names the app's version and build.
    expect(nativeControlCenterAppBuild(refused)).toEqual({
      version: "1.2.3",
      build: "45",
    });
  });

  it("keeps automatic repair separate from the full app restart", () => {
    expect(REPAIR_CODEXBAR_URL).toBe("vibetv://repair-codexbar");
    expect(FINISH_CODEXBAR_RECOVERY_URL).toBe(
      "vibetv://finish-codexbar-recovery",
    );
    expect(REPAIR_CONTROL_CENTER_RUNTIME_URL).toBe("vibetv://repair-runtime");
    expect(RESTART_CONTROL_CENTER_URL).toBe(
      "vibetv://restart-control-center",
    );
  });

  it("addresses the exact installed ThemeSpec revision when known", () => {
    expect(
      localThemeRenderPackUrl(
        "synthwave",
        "/themes/u/synthwa-1-6b39a3.json",
        "6B39A36C",
      ),
    ).toBe(
      "/theme-packs/render/synthwave/synthwa-1-6b39a3.json?specHash=6b39a36c",
    );
    expect(localThemeRenderPackUrl("synthwave")).toBe(
      "/theme-packs/render/synthwave.json",
    );
  });
});
