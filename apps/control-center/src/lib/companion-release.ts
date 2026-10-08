export type CompanionReleaseStatus =
  | "available"
  | "missing_asset"
  | "disabled"
  | "check_failed";

export type MacAppDmgDownloadStatus =
  | "available"
  | "missing_asset"
  | "disabled"
  | "check_failed";

export type WindowsAppSetupDownloadStatus =
  | "available"
  | "missing_asset"
  | "disabled"
  | "check_failed";

export type CompanionReleaseInfo = {
  checkedAt: string;
  status: CompanionReleaseStatus;
  release?: string;
  latestVersion?: string;
  installedVersion?: string;
  updateAvailable: boolean;
  message: string;
  dmgDownloadStatus?: MacAppDmgDownloadStatus;
  dmgDownloadUrl?: string;
  windowsSetupDownloadStatus?: WindowsAppSetupDownloadStatus;
  windowsSetupDownloadUrl?: string;
};

export function availableMacAppDmgDownloadUrl(
  release: CompanionReleaseInfo | null | undefined,
): string | undefined {
  const url = release?.dmgDownloadUrl?.trim();
  if (
    release?.status !== "available" ||
    release.dmgDownloadStatus !== "available" ||
    !url
  ) {
    return undefined;
  }
  return url;
}

/**
 * The Windows twin of {@link availableMacAppDmgDownloadUrl}: the same release
 * has to be readable and the Windows installer has to be verified on its own,
 * so a published Mac build never implies a published Windows build.
 */
export function availableWindowsAppSetupDownloadUrl(
  release: CompanionReleaseInfo | null | undefined,
): string | undefined {
  const url = release?.windowsSetupDownloadUrl?.trim();
  if (
    release?.status !== "available" ||
    release.windowsSetupDownloadStatus !== "available" ||
    !url
  ) {
    return undefined;
  }
  return url;
}
