import type { DeviceInfo } from "@/components/control-center-types";
import type { ThemeProduct } from "@/lib/themes";

export type ActiveThemeUpgrade = {
  theme?: ThemeProduct;
  unresolved: boolean;
};

export function resolveActiveThemeUpgrade(
  themes: ThemeProduct[],
  device: DeviceInfo | null,
): ActiveThemeUpgrade {
  if (!device?.activeTheme) {
    return { unresolved: false };
  }
  const needsUsageSlots =
    device.capabilities?.theme?.supportsUsageSlotsV1 !== true;
  const theme = themes.find(
    (candidate) => candidate.themeId === device.activeTheme,
  );
  if (!theme) {
    return { unresolved: needsUsageSlots };
  }
  if (!theme.requiredCapabilities) {
    return { unresolved: needsUsageSlots };
  }
  if (!theme.requiredCapabilities.includes("usage-slots-v1")) {
    return { unresolved: false };
  }
  return { theme, unresolved: false };
}
