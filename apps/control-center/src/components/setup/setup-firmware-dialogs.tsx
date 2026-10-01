"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { copyForHost } from "@/lib/customer-platform";
import { SetupDialog } from "./setup-dialog";

/**
 * Why the firmware step could not finish: either the check itself never
 * answered, or the app was restarting. The connect flow shows the customer
 * what to do instead of moving on without the update, or without knowing
 * whether one was needed. A newer app release never blocks it: the app
 * installs the firmware of its own release.
 */
export type FirmwareBlockedReason =
  | "firmware_check_failed"
  | "mac_app_restarting";

export function firmwareBlockedReason(
  code: string | undefined,
): FirmwareBlockedReason | null {
  return code === "firmware_check_failed" || code === "mac_app_restarting"
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
      icon={RefreshCw}
      onOpenChange={onOpenChange}
      open={open}
      primaryAction={{ busy, label: copy.action, onSelect: onResolve }}
      title={copyForHost(copy.title, windowsHost)}
      tone="error"
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
