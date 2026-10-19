"use client";

import type { DeviceInfo } from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";
import { SetupDialog } from "./setup/setup-dialog";

/** VibeTV is not found on the cable or the WiFi while the Overview is open. */
export function vibetvNotFound(device: DeviceInfo | null) {
  return (
    !deviceIsCustomerConnected(device) &&
    device?.stream?.errorCode === "device_not_found"
  );
}

type VibeTVNotFoundDialogProps = {
  onDismiss: () => void;
  onRunSetupAgain: () => void;
  /** The app runs on Windows; the wording says "computer" instead of "Mac". */
  windowsHost?: boolean;
};

/** A dialog over the page, with no close button (calm rule 13). */
export function VibeTVNotFoundDialog({
  onDismiss,
  onRunSetupAgain,
  windowsHost = false,
}: VibeTVNotFoundDialogProps) {
  return (
    <SetupDialog
      description={`Check that VibeTV is plugged in and on the same WiFi as this ${windowsHost ? "computer" : "Mac"}.`}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      open
      primaryAction={{ label: "Run setup again", onSelect: onRunSetupAgain }}
      secondaryAction={{ label: "Not now", onSelect: onDismiss }}
      showCloseButton={false}
      title="We couldn't find your VibeTV"
    />
  );
}
