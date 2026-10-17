"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";
import { SetupDialog } from "./setup/setup-dialog";
import type { DisplayFrameSnapshot } from "./live-vibetv-preview";
import { VibeTV3DPreview } from "./vibetv-3d-preview";

type OverviewScreenProps = {
  companionVersion?: string;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  displayFrame?: DisplayFrameSnapshot | null;
  firmwareUpdateStatus?: {
    phase?: string;
    stage?: string;
  } | null;
  /** Opens the existing "Run setup again?" confirmation. */
  onRunSetupAgain?: () => void;
  usage?: UsageSnapshot | null;
  /** The app runs on Windows; the wording says "computer" instead of "Mac". */
  windowsHost?: boolean;
};

/**
 * Overview shows only the VibeTV, centered in 3D. The status line above it is
 * the only text. The Mac App, VibeTV, Display and firmware tiles are gone (the
 * approved calm Overview, #713). Calm rule 12 is deliberately not applied to
 * this page: the device is centered, not left-aligned.
 */
export function OverviewScreen({
  device,
  displayFrame = null,
  firmwareUpdateStatus = null,
  onRunSetupAgain,
  usage,
  windowsHost = false,
}: OverviewScreenProps) {
  const connected = deviceIsCustomerConnected(device);
  const updateOwnedDisconnect = Boolean(
    !connected && firmwareUpdateStatus?.phase === "installing",
  );
  const notFound =
    !connected && device?.stream?.errorCode === "device_not_found";
  // "Not now" hides the dialog until this Overview is opened again.
  const [notFoundDismissed, setNotFoundDismissed] = useState(false);

  return (
    <div className="mx-auto max-w-[1180px] py-4">
      <section aria-labelledby="vibetv-overview-title">
        <h2
          className="text-[28px] font-semibold leading-tight tracking-tight text-foreground"
          id="vibetv-overview-title"
        >
          {connected
            ? "VibeTV is connected"
            : updateOwnedDisconnect
              ? "VibeTV is restarting"
              : "VibeTV status"}
        </h2>

        <div className="mt-6 flex w-full justify-center">
          <VibeTV3DPreview
            className="aspect-[14/9] max-w-[900px]"
            device={device}
            displayFrame={displayFrame}
            updateOwnedDisconnect={updateOwnedDisconnect}
            usage={usage || null}
          />
        </div>
      </section>

      <SetupDialog
        description={`Check that VibeTV is plugged in and on the same WiFi as this ${windowsHost ? "computer" : "Mac"}.`}
        icon={CircleAlert}
        onOpenChange={() => setNotFoundDismissed(true)}
        open={notFound && !notFoundDismissed}
        primaryAction={{
          label: "Run setup again",
          onSelect: () => {
            setNotFoundDismissed(true);
            onRunSetupAgain?.();
          },
        }}
        secondaryAction={{
          label: "Not now",
          onSelect: () => setNotFoundDismissed(true),
        }}
        showCloseButton={false}
        title="We couldn't find your VibeTV"
      />
    </div>
  );
}
