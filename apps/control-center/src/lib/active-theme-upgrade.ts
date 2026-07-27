import type { DeviceInfo } from "@/components/control-center-types";
import type { ThemeProduct } from "@/lib/themes";

export type ActiveThemeUpgrade = {
  needed: boolean;
  needsFirmwareCapability: boolean;
  needsThemeSpec: boolean;
  theme?: ThemeProduct;
  unresolved: boolean;
};

export function resolveActiveThemeUpgrade(
  themes: ThemeProduct[],
  device: DeviceInfo | null,
): ActiveThemeUpgrade {
  if (!device?.activeTheme) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: false,
    };
  }
  const needsUsageSlots =
    device.capabilities?.theme?.supportsUsageSlotsV1 !== true;
  const theme = themes.find(
    (candidate) => candidate.themeId === device.activeTheme,
  );
  if (!theme) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: needsUsageSlots,
    };
  }
  if (!theme.requiredCapabilities) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      theme,
      unresolved: needsUsageSlots,
    };
  }
  const needsRequiredCapability =
    theme.requiredCapabilities.includes("usage-slots-v1") && needsUsageSlots;
  const expectedPath = theme.themeSpecPath?.trim();
  const activePath = device.display?.themeSpec?.path?.trim();
  const pathIsOutdated = Boolean(
    expectedPath && activePath && expectedPath !== activePath,
  );
  return {
    needed: needsRequiredCapability || pathIsOutdated,
    needsFirmwareCapability: needsRequiredCapability,
    needsThemeSpec: pathIsOutdated,
    theme,
    unresolved: false,
  };
}
