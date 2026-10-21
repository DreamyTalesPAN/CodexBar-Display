"use client";

import { SetupDialog } from "./setup/setup-dialog";
import type { DeviceInfo } from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";

/** Issue #265: the approved wording for a WiFi VibeTV the Companion calls weak. */
export const weakWiFiCopy = {
  title: "VibeTV's Wi-Fi is weak",
  description:
    "VibeTV stopped getting updates. Move it closer to your router or check your Wi-Fi.",
  action: "OK",
};

/**
 * Whether the Companion reports a weak WiFi signal for a connected VibeTV. The
 * Companion sets `wifi.weak` only for a VibeTV on WiFi, so a cable VibeTV never
 * gets the notice.
 */
export function weakWiFiSignal(device: DeviceInfo | null | undefined): boolean {
  return deviceIsCustomerConnected(device) && device.health?.wifi?.weak === true;
}

/** An announcement over the page, like the busy computer notice (#606). */
export function WeakWiFiDialog({ onClose }: { onClose: () => void }) {
  return (
    <SetupDialog
      description={weakWiFiCopy.description}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      primaryAction={{ label: weakWiFiCopy.action, onSelect: onClose }}
      // The app behind it keeps working, as with the busy notice.
      scrim={false}
      showCloseButton={false}
      title={weakWiFiCopy.title}
    />
  );
}
