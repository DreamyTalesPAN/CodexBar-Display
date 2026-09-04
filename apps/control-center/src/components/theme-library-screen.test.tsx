import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThemeStudioUsage } from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import {
  ThemeLibraryScreen,
  themeNeedsUpgradeableFirmware,
  type ThemeLibraryDeviceInfo,
} from "./theme-library-screen";

const theme: ThemeProduct = {
  id: "synthwave",
  title: "Synthwave",
  priceLabel: "Free",
  isFree: true,
  themeId: "synthwave",
  packUrl: "https://cdn.example.test/synthwave.vibetv-theme",
  packSha256: "a".repeat(64),
  packSizeBytes: 1234,
  compatibleBoards: ["esp8266_smalltv_st7789"],
  requiresFirmware: "1.0.0",
  requiredCapabilities: ["usage-slots-v1"],
  source: "github-catalog",
};

const themes: ThemeProduct[] = [
  {
    id: "live-theme",
    isFree: true,
    packSha256: "a".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/live.zip",
    priceLabel: "Kostenlos",
    source: "github-catalog",
    themeId: "live-theme",
    title: "Live Theme",
    usage: "live",
  },
  {
    id: "night-clock",
    isFree: true,
    packSha256: "b".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/screensaver.zip",
    priceLabel: "Kostenlos",
    source: "github-catalog",
    themeId: "night-clock",
    title: "Night Clock",
    usage: "screensaver",
  },
];

const device: ThemeLibraryDeviceInfo = {
  connected: true,
  paired: true,
  ready: false,
  board: "esp8266-smalltv-st7789",
  firmware: "1.0.39",
  activeTheme: "theme-missing",
  capabilities: {
    theme: {
      supportsThemeSpecV1: true,
      supportsUsageSlotsV1: false,
    },
  },
};

function renderLibrary(
  usage: ThemeStudioUsage,
  catalog = themes,
  standby = {
    enabled: false,
    timeoutMinutes: 10,
    brightnessPercent: 20,
    screensaverPath: "/themes/s/night.json",
  },
) {
  return renderToStaticMarkup(
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={null}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSaveStandby={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      storefrontConfigured={false}
      standby={standby}
      themeInstallEnabled={false}
      themes={catalog}
      usage={usage}
    />,
  );
}

describe("themeNeedsUpgradeableFirmware", () => {
  it("recognizes a known missing theme capability as firmware-upgradeable", () => {
    expect(themeNeedsUpgradeableFirmware(theme, device, true)).toBe(true);
  });

  it("recognizes an old firmware version as upgradeable", () => {
    expect(
      themeNeedsUpgradeableFirmware(
        {
          ...theme,
          requiredCapabilities: [],
          requiresFirmware: "1.0.40",
        },
        device,
        true,
      ),
    ).toBe(true);
  });

  it("does not offer firmware as a fix for an incompatible board", () => {
    expect(
      themeNeedsUpgradeableFirmware(
        {
          ...theme,
          compatibleBoards: ["esp32_lilygo_t_display_s3"],
        },
        device,
        true,
      ),
    ).toBe(false);
  });

  it("does not claim an unknown capability can be fixed by firmware", () => {
    expect(
      themeNeedsUpgradeableFirmware(
        {
          ...theme,
          requiredCapabilities: ["future-theme-protocol"],
        },
        device,
        true,
      ),
    ).toBe(false);
  });

  it("keeps the update path unavailable when theme installs are disabled", () => {
    expect(themeNeedsUpgradeableFirmware(theme, device, false)).toBe(false);
  });

});

describe("ThemeLibraryScreen Appearance sections", () => {
  // The setup arm used to wrap or hide each of these; nothing asserted the
  // Appearance arm, so unwrapping it could have changed the tab in silence.
  it("makes the preview reachable and offers Edit on every theme", () => {
    const html = renderLibrary("live");

    expect(html).toContain('aria-label="Preview Live Theme"');
    expect(html).toContain("<span>Edit</span>");
  });

  it("says Wait rather than a blocked label while another action runs", () => {
    const html = renderToStaticMarkup(
      <ThemeLibraryScreen
        busyAction="install"
        companionStatus="online"
        device={null}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled={false}
        themes={themes}
        usage="live"
      />,
    );

    expect(html).toContain("Wait");
  });

  it("keeps the existing Themes list restricted to live packs", () => {
    const html = renderLibrary("live");

    expect(html).toContain(">Themes<");
    expect(html).toContain(
      "Customize how your live usage screen looks while VibeTV is active.",
    );
    expect(html).toContain("Create Theme");
    expect(html).toContain("Live Theme");
    expect(html).not.toContain("Night Clock");
  });

  it("shows only screensaver packs and the screensaver create action", () => {
    const html = renderLibrary("screensaver");

    expect(html).toContain(">Screensavers<");
    expect(html).toContain(
      "Choose what appears when VibeTV enters standby after being idle.",
    );
    expect(html).toContain("Create Screensaver");
    expect(html).toContain('aria-label="Show screensaver"');
    expect(html).toContain("Screensaver is turned off");
    expect(html).toContain("Night Clock");
    expect(html).not.toContain("Live Theme");
  });

  it("locks installs while the screensaver is off but keeps the toggle usable", () => {
    const html = renderToStaticMarkup(
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={{
          connected: true,
          paired: true,
          ready: true,
          activeTheme: "live-theme",
        }}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        standby={{
          enabled: false,
          timeoutMinutes: 10,
          brightnessPercent: 20,
          screensaverPath: null,
        }}
        themeInstallEnabled
        themes={themes}
        usage="screensaver"
      />,
    );

    const standbySwitch = html.match(
      /<button[^>]*id="vibetv-library-standby"[^>]*>/,
    )?.[0];
    expect(standbySwitch).not.toContain('disabled=""');
    expect(html).toContain("Turn On First");
    expect(html).toContain("Turn on Show screensaver to install");
  });

  it("removes the warning without hiding the library when enabled", () => {
    const html = renderLibrary("screensaver", themes, {
      enabled: true,
      timeoutMinutes: 10,
      brightnessPercent: 20,
      screensaverPath: "/themes/s/night.json",
    });

    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("Screensaver is turned off");
    expect(html).toContain("Night Clock");
  });

  it("shows a clear empty state when the catalog has no screensavers", () => {
    const html = renderLibrary("screensaver", [themes[0]]);

    expect(html).toContain("No screensavers yet");
    expect(html).toContain("Create a screensaver to add it to this list.");
    expect(html).toContain("Create Screensaver");
    expect(html).not.toContain("Reload catalog");
  });
});
