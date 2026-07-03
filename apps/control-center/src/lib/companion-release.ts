export type CompanionReleaseStatus =
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
};
