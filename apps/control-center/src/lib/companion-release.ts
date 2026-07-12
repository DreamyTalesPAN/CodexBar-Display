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
