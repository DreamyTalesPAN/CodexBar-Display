import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      setupMode
      storefrontConfigured
      themeInstallEnabled
      themes={[setupTheme]}
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
