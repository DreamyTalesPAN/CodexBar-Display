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
  title: "Synthwave",
} satisfies ThemeProduct;

function device(supportsUsageSlotsV1: boolean): DeviceInfo {
  return {
    activeTheme: "synthwave",
    capabilities: {
      theme: {
        supportsUsageSlotsV1,
      },
    },
    connected: true,
  };
}

describe("resolveActiveThemeUpgrade", () => {
  it("resolves a cataloged slot theme before and after the firmware update", () => {
    expect(resolveActiveThemeUpgrade([slotTheme], device(false))).toEqual({
      theme: slotTheme,
      unresolved: false,
    });
    expect(resolveActiveThemeUpgrade([slotTheme], device(true))).toEqual({
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
      unresolved: true,
    });
  });
});
