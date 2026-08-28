"use client";

import { CircleAlert, Download, RefreshCw } from "lucide-react";
import { SetupDialog } from "./setup-dialog";

/**
 * Why a firmware update could not start. The companion refuses the install
 * outright in these three cases, so the connect flow shows the customer what
 * to do instead of moving on without the update.
 */
export type FirmwareBlockedReason =
  | "mac_app_update_required"
  | "mac_app_release_check_failed"
  | "mac_app_restarting";

export function firmwareBlockedReason(
  code: string | undefined,
): FirmwareBlockedReason | null {
  return code === "mac_app_update_required" ||
    code === "mac_app_release_check_failed" ||
    code === "mac_app_restarting"
    ? code
    : null;
}

export const FIRMWARE_BLOCKED_COPY: Record<
  FirmwareBlockedReason,
  { action: string; description: string; title: string }
> = {
  // The Mac App and the firmware of a release belong together, so an older app
  // is not allowed to push newer firmware. The customer can settle it here.
  mac_app_update_required: {
    action: "Update",
    description: "Update the Mac App first, then VibeTV can update too.",
    title: "Your Mac App is out of date",
  },
  mac_app_release_check_failed: {
    action: "Try again",
    description: "Check the internet connection, then try again.",
    title: "Could not check the Mac App",
  },
  mac_app_restarting: {
    action: "Try again",
    description: "Wait a moment, then start the update again.",
    title: "The Mac App is restarting",
  },
};

type BlockedDialogProps = {
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onResolve: () => void;
  open: boolean;
  reason: FirmwareBlockedReason;
};

export function SetupFirmwareBlockedDialog({
  busy = false,
  onOpenChange,
  onResolve,
  open,
  reason,
}: BlockedDialogProps) {
  const copy = FIRMWARE_BLOCKED_COPY[reason];
  return (
    <SetupDialog
      description={copy.description}
      icon={reason === "mac_app_update_required" ? Download : RefreshCw}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: copy.action, onSelect: onResolve }}
      title={copy.title}
      tone={reason === "mac_app_update_required" ? "neutral" : "error"}
    />
  );
}

type UpdateFailedDialogProps = {
  busy?: boolean;
  onCreateSupportReport: () => void;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  open: boolean;
};

/** 02f — the update started and stopped part way through. */
export function SetupFirmwareUpdateFailedDialog({
  busy = false,
  onCreateSupportReport,
  onOpenChange,
  onRetry,
  open,
}: UpdateFailedDialogProps) {
  return (
    <SetupDialog
      description="Unplug VibeTV from power, plug it back in, then try again."
      icon={CircleAlert}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: "Try update again", onSelect: onRetry }}
      secondaryAction={{
        label: "Create support report",
        onSelect: onCreateSupportReport,
      }}
      title="Firmware update did not finish"
    />
  );
}
