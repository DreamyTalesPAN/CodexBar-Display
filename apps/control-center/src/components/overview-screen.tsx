"use client";

import { AgentSessions, type AgentSnapshot } from "./agent-sessions";
import type {
  CompanionStatus,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { deviceIsCustomerConnected } from "./control-center-types";
import type { DisplayFrameSnapshot } from "./live-vibetv-preview";
import { VibeTV3DPreview } from "./vibetv-3d-preview";

type OverviewScreenProps = {
  agents?: AgentSnapshot | null;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  displayFrame?: DisplayFrameSnapshot | null;
  firmwareUpdateStatus?: {
    phase?: string;
    stage?: string;
  } | null;
  usage?: UsageSnapshot | null;
};

export function OverviewScreen({
  agents = null,
  companionStatus,
  device,
  displayFrame = null,
  firmwareUpdateStatus = null,
  usage,
}: OverviewScreenProps) {
  const updateOwnedDisconnect = Boolean(
    !deviceIsCustomerConnected(device) &&
      firmwareUpdateStatus?.phase === "installing",
  );

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col items-center gap-8 py-6 sm:py-10">
      <VibeTV3DPreview
        device={device}
        displayFrame={displayFrame}
        updateOwnedDisconnect={updateOwnedDisconnect}
        usage={usage || null}
      />
      <AgentSessions snapshot={companionStatus === "online" ? agents : null} />
    </div>
  );
}
