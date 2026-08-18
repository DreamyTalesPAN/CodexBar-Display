import type { DeviceInfo } from "@/components/control-center-types";
import type { ThemeProduct } from "@/lib/themes";

export type ActiveThemeUpgrade = {
  needed: boolean;
  needsFirmwareCapability: boolean;
  needsThemeSpec: boolean;
  theme?: ThemeProduct;
  unresolved: boolean;
};

export function resolveActiveLiveTheme(
  themes: ThemeProduct[],
  device: DeviceInfo | null | undefined,
): ThemeProduct | undefined {
  if (device?.standby?.active === true) {
    const livePath = device.standby.liveThemePath?.trim();
    return themes.find(
      (candidate) =>
        candidate.usage !== "screensaver" &&
        sameVersionedThemePath(candidate.themeSpecPath, livePath),
    );
  }
  return themes.find(
    (candidate) =>
      candidate.usage !== "screensaver" &&
      candidate.themeId === device?.activeTheme,
  );
}

export function resolveActiveThemeUpgrade(
  themes: ThemeProduct[],
  device: DeviceInfo | null,
): ActiveThemeUpgrade {
  const standbyActive = device?.standby?.active === true;
  const standbyLivePath = standbyActive
    ? device?.standby?.liveThemePath?.trim()
    : undefined;
  if (!device || (!device.activeTheme && !standbyLivePath)) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: false,
    };
  }
  const needsUsageSlots =
    device.capabilities?.theme?.supportsUsageSlotsV1 !== true;
  const needsUsageWindows =
    device.capabilities?.theme?.supportsUsageWindowsV1 !== true;
  const theme = resolveActiveLiveTheme(themes, device);
  if (!theme) {
    return {
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: needsUsageSlots || needsUsageWindows,
    };
  }
  const expectedPath = theme.themeSpecPath?.trim();
  const activePath = standbyActive
    ? standbyLivePath
    : device.display?.themeSpec?.path?.trim();
  const pathIsOutdated = Boolean(expectedPath && expectedPath !== activePath);
  if (!theme.requiredCapabilities) {
    return {
      needed: pathIsOutdated,
      needsFirmwareCapability: false,
      needsThemeSpec: pathIsOutdated,
      theme,
      unresolved: needsUsageSlots || needsUsageWindows,
    };
  }
  const needsRequiredCapability =
    (theme.requiredCapabilities.includes("usage-slots-v1") && needsUsageSlots) ||
    (theme.requiredCapabilities.includes("usage-windows-v1") &&
      needsUsageWindows);
  return {
    needed: needsRequiredCapability || pathIsOutdated,
    needsFirmwareCapability: needsRequiredCapability,
    needsThemeSpec: pathIsOutdated,
    theme,
    unresolved: false,
  };
}

// The screensaver slot drifts exactly like the live slot when the catalog ships a
// new revision, but nothing else catches it: the device reports only the path it
// has, and `activeTheme` describes the live slot alone. Without this the customer
// keeps an outdated screensaver until they reinstall it by hand.
export function resolveScreensaverUpgrade(
  themes: ThemeProduct[],
  screensaverPath: string | null | undefined,
): ActiveThemeUpgrade {
  const idle = {
    needed: false,
    needsFirmwareCapability: false,
    needsThemeSpec: false,
    unresolved: false,
  };
  const installedPath = screensaverPath?.trim();
  if (!installedPath) {
    return idle;
  }
  const theme = themes.find(
    (candidate) =>
      candidate.usage === "screensaver" &&
      sameVersionedThemePath(candidate.themeSpecPath, installedPath),
  );
  const expectedPath = theme?.themeSpecPath?.trim();
  if (!theme || !expectedPath || expectedPath === installedPath) {
    return idle;
  }
  return {
    needed: true,
    needsFirmwareCapability: false,
    needsThemeSpec: true,
    theme,
    unresolved: false,
  };
}

function sameVersionedThemePath(
  candidatePath: string | undefined,
  activePath: string | undefined,
): boolean {
  const candidate = candidatePath?.trim();
  if (!candidate || !activePath) {
    return false;
  }
  if (candidate === activePath) {
    return true;
  }
  const candidateBase = versionedThemePathBase(candidate);
  return Boolean(
    candidateBase && candidateBase === versionedThemePathBase(activePath),
  );
}

function versionedThemePathBase(path: string): string | undefined {
  return path.match(/^(\/themes\/[us]\/.+)-\d+-[0-9a-f]{6}\.json$/i)?.[1];
}
