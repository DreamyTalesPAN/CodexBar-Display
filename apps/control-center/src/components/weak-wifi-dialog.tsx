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
    "Updates may be delayed. Move VibeTV closer to your router or check your Wi-Fi.",
  action: "OK",
};

/**
 * Whether the Companion reports a weak WiFi signal for a connected VibeTV. The
 * Companion sets `wifi.weak` only for a VibeTV on WiFi, so a cable VibeTV never
 * gets the notice.
 */
export function weakWiFiSignal(device: DeviceInfo | null | undefined): boolean {
  return deviceIsCustomerConnected(device) &&
    device.connectionState !== "reconnecting" &&
    device.health?.wifi?.weak === true;
}

/**
 * Whether the customer closed the notice for the device under way. Closed stays
 * closed through a short disconnect, which keeps the Companion's weak snapshot,
 * and while that device stays weak. It opens again once the Companion reports that
 * device's signal recovered. Each VibeTV keeps its own closed notice. The VibeTV is
 * keyed by its id, not its address, so a reconnect on a new DHCP address keeps the
 * notice closed.
 */
export function useWeakWiFiDismissal(
  device: DeviceInfo | null | undefined,
): [boolean, () => void] {
  const key = device?.deviceId ?? device?.target ?? "";
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // Only affirmative recovery clears dismissal; unconfirmed low readings also omit `weak`.
  const recovered =
    deviceIsCustomerConnected(device) &&
    device.connectionState !== "reconnecting" &&
    device.health?.wifi?.recovered === true;
  useEffect(() => {
    if (!recovered) {
      return;
    }
    const timer = window.setTimeout(
      () =>
        setDismissed((set) => {
          const next = new Set(set);
          next.delete(key);
          return next;
        }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [recovered, key]);
  return [
    dismissed.has(key),
    () => setDismissed((set) => new Set(set).add(key)),
  ];
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
