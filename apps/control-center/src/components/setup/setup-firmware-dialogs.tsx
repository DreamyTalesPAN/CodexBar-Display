"use client";

import { CircleAlert, Download, RefreshCw } from "lucide-react";
import { copyForHost } from "@/lib/customer-platform";
import { SetupDialog } from "./setup-dialog";

/**
 * Why the firmware step could not finish: the companion refuses the install
 * outright in three of these, and in the fourth the check itself never
 * answered. The connect flow shows the customer what to do instead of moving
 * on without the update, or without knowing whether one was needed.
 */
export type FirmwareBlockedReason =
  | "firmware_check_failed"
  | "mac_app_update_required"
  | "mac_app_release_check_failed"
  | "mac_app_restarting";

export function firmwareBlockedReason(
  code: string | undefined,
): FirmwareBlockedReason | null {
  return code === "firmware_check_failed" ||
    code === "mac_app_update_required" ||
    code === "mac_app_release_check_failed" ||
    code === "mac_app_restarting"
    ? code
    : null;
}

export const FIRMWARE_BLOCKED_COPY: Record<
  FirmwareBlockedReason,
  { action: string; description: string; title: string }
> = {
  // The check itself could not be made, so whether this VibeTV needs an update
  // is unknown. Saying nothing would leave the customer on firmware nobody
  // looked at.
  firmware_check_failed: {
    action: "Try again",
    description: "Check the internet connection, then try again.",
    title: "Could not check VibeTV's firmware",
  },
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
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

export function SetupFirmwareBlockedDialog({
  busy = false,
  onOpenChange,
  onResolve,
  open,
  reason,
  windowsHost = false,
}: BlockedDialogProps) {
  const copy = FIRMWARE_BLOCKED_COPY[reason];
  return (
    <SetupDialog
      description={copyForHost(copy.description, windowsHost)}
      icon={reason === "mac_app_update_required" ? Download : RefreshCw}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: copy.action, onSelect: onResolve }}
      title={copyForHost(copy.title, windowsHost)}
      tone={reason === "mac_app_update_required" ? "neutral" : "error"}
    />
  );
}

type UpdateFailedDialogProps = {
  attentionMessage?: string;
  busy?: boolean;
  onCreateSupportReport: () => void;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  open: boolean;
};

/** 02f — the update started and stopped part way through. */
export function SetupFirmwareUpdateFailedDialog({
  attentionMessage,
  busy = false,
  onCreateSupportReport,
  onOpenChange,
  onRetry,
  open,
}: UpdateFailedDialogProps) {
  return (
    <SetupDialog
      description={
        attentionMessage ||
        "Unplug VibeTV from power, plug it back in, then try again."
      }
      icon={CircleAlert}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={
        attentionMessage
          ? { busy, label: "Create support report", onSelect: onCreateSupportReport }
          : { busy, label: "Try update again", onSelect: onRetry }
      }
      secondaryAction={
        attentionMessage
          ? undefined
          : { label: "Create support report", onSelect: onCreateSupportReport }
      }
      title={
        attentionMessage
          ? "Firmware current — attention needed"
          : "Firmware update did not finish"
      }
    />
  );
}
