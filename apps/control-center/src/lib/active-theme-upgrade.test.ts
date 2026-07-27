import { describe, expect, it } from "vitest";
import type { DeviceInfo } from "@/components/control-center-types";
import type { ThemeProduct } from "@/lib/themes";
import { resolveActiveThemeUpgrade } from "./active-theme-upgrade";

const slotTheme = {
  id: "synthwave",
  isFree: true,
  priceLabel: "Free",
  requiredCapabilities: ["usage-slots-v1"],
  source: "github-catalog",
  themeId: "synthwave",
  themeRev: 2,
  themeSpecPath: "/themes/u/synthwa-2-5f8ac7.json",
  title: "Synthwave",
} satisfies ThemeProduct;

function device(
  supportsUsageSlotsV1: boolean,
  path = "/themes/u/synthwa-1-6b39a3.json",
): DeviceInfo {
  return {
    activeTheme: "synthwave",
    capabilities: {
      theme: {
        supportsUsageSlotsV1,
      },
    },
    connected: true,
    display: {
      themeSpec: {
        active: true,
        path,
      },
    },
  };
}

describe("resolveActiveThemeUpgrade", () => {
  it("resolves a cataloged slot theme before and after the firmware update", () => {
    expect(resolveActiveThemeUpgrade([slotTheme], device(false))).toEqual({
      needed: true,
      needsFirmwareCapability: true,
      needsThemeSpec: true,
      theme: slotTheme,
      unresolved: false,
    });
    expect(
      resolveActiveThemeUpgrade(
        [slotTheme],
        device(true, "/themes/u/synthwa-2-5f8ac7.json"),
      ),
    ).toEqual({
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      theme: slotTheme,
      unresolved: false,
    });
  });

  it("upgrades an old active ThemeSpec even when firmware is already capable", () => {
    expect(resolveActiveThemeUpgrade([slotTheme], device(true))).toEqual({
      needed: true,
      needsFirmwareCapability: false,
      needsThemeSpec: true,
      theme: slotTheme,
      unresolved: false,
    });
  });

  it("marks an incomplete non-empty catalog as unresolved on old firmware", () => {
    const otherTheme = {
      ...slotTheme,
      id: "clippy",
      themeId: "clippy",
      title: "Clippy",
    };
    expect(resolveActiveThemeUpgrade([otherTheme], device(false))).toEqual({
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: true,
    });
  });
});
