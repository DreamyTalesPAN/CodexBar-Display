export type FirmwareUpdateInfo = {
  checkedAt: string;
  installedFirmware?: string;
  latestFirmware?: string;
  release?: string;
  updateAvailable: boolean;
  status:
    | "current"
    | "update_available"
    | "missing_device_info"
    | "no_board_release"
    | "check_failed";
  message?: string;
};

export function hasFirmwareUpdate(
  update?: FirmwareUpdateInfo | null,
): boolean {
  return Boolean(update?.updateAvailable);
}
