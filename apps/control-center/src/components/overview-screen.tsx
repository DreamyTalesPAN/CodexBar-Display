"use client";

import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";
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
  usage,
}: OverviewScreenProps) {
  const connected = deviceIsCustomerConnected(device);
  const updateOwnedDisconnect = Boolean(
    !connected && firmwareUpdateStatus?.phase === "installing",
  );

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

    </div>
  );
}
