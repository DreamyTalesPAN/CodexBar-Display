"use client";

import { useEffect, useState } from "react";
import { SetupDialog } from "./setup/setup-dialog";
import type { DeviceInfo } from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";
import { useOtherDialogOpen } from "./system-busy-dialog";

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

/**
 * Whether the customer closed the notice for the device under way. Closed stays
 * closed through a short disconnect, which keeps the Companion's weak snapshot,
 * and while that device stays weak. It opens again once the Companion reports the
 * signal recovered, or for another device.
 */
export function useWeakWiFiDismissal(
  device: DeviceInfo | null | undefined,
): [boolean, () => void] {
  const target = device?.target ?? null;
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // The Companion omits `weak` when the signal is fine, so a WiFi reading without it is a recovery.
  const recovered =
    deviceIsCustomerConnected(device) &&
    device.health?.wifi !== undefined &&
    device.health.wifi.weak !== true;
  useEffect(() => {
    if (!recovered) {
      return;
    }
    const timer = window.setTimeout(() => setDismissedFor(null), 0);
    return () => window.clearTimeout(timer);
  }, [recovered]);
  return [dismissedFor !== null && dismissedFor === target, () => setDismissedFor(target)];
}

/** An announcement over the page, like the busy computer notice (#606). */
export function WeakWiFiDialog({ onClose }: { onClose: () => void }) {
  // Waits for another dialog of the page, as the busy notice does (#606).
  if (useOtherDialogOpen(weakWiFiCopy.title)) {
    return null;
  }
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
