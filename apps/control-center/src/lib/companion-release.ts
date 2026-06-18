export type CompanionReleaseStatus =
  | "available"
  | "missing_asset"
  | "check_failed";

export type CompanionReleaseInfo = {
  checkedAt: string;
  status: CompanionReleaseStatus;
  release?: string;
  latestVersion?: string;
  installedVersion?: string;
  updateAvailable: boolean;
  installerDownloadUrl?: string;
  message: string;
};
