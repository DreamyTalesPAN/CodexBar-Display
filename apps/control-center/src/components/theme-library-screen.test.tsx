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

function renderThemeSetup({
  setupDevice = device,
  setupTheme = theme,
  firmwareStatus = "update_available",
}: {
  setupDevice?: ThemeLibraryDeviceInfo;
  setupTheme?: ThemeProduct;
  firmwareStatus?:
    | "update_available"
    | "check_failed"
    | "no_board_release";
}) {
  return renderToStaticMarkup(
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={setupDevice}
      firmwareUpdate={{
        checkedAt: "2026-07-29T14:00:00Z",
        installedFirmware: setupDevice.firmware,
        latestFirmware:
          firmwareStatus === "update_available" ? "1.0.40" : undefined,
        updateAvailable: firmwareStatus === "update_available",
        status: firmwareStatus,
        message:
          firmwareStatus === "update_available"
            ? "Firmware update available."
            : "No update is available for this VibeTV.",
      }}
      firmwareUpdateStatus={
        firmwareStatus === "update_available"
          ? null
          : {
              phase: "error",
              message: "The update could not be checked.",
              retryAllowed: true,
            }
      }
      onInstallCustomTheme={async () => false}
      onInstallFirmwareUpdate={vi.fn()}
      onInstallTheme={vi.fn()}
      onSaveStandby={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      setupMode
      storefrontConfigured
      themeInstallEnabled
      themes={[setupTheme]}
    />,
  );
}

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

describe("theme setup firmware update eligibility", () => {
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
    const html = renderThemeSetup({
      setupTheme: {
        ...theme,
        compatibleBoards: ["esp32_lilygo_t_display_s3"],
      },
    });
    expect(html).not.toContain("<span>Update VibeTV</span>");
    expect(html).toContain("Not Supported");
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
    const html = renderThemeSetup({
      setupTheme: {
        ...theme,
        requiredCapabilities: ["future-theme-protocol"],
      },
    });
    expect(html).not.toContain("<span>Update VibeTV</span>");
    expect(html).toContain("Not Supported");
  });

  it("keeps the update path unavailable when theme installs are disabled", () => {
    expect(themeNeedsUpgradeableFirmware(theme, device, false)).toBe(false);
  });

  it.each(["check_failed", "no_board_release"] as const)(
    "keeps firmware writes unavailable when the update status is %s",
    (firmwareStatus) => {
      const html = renderThemeSetup({ firmwareStatus });
      expect(html).toContain("VibeTV update needs attention");
      expect(html).not.toContain("<span>Update VibeTV</span>");
    },
  );

  it("shows one explicit write action for a known available update", () => {
    const html = renderThemeSetup({});
    expect(html).toContain("Update VibeTV to continue");
    expect(html.match(/<span>Update VibeTV<\/span>/g)).toHaveLength(1);
  });
});

describe("ThemeLibraryScreen Appearance sections", () => {
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
