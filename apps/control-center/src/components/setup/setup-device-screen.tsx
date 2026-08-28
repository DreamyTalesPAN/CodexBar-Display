"use client";

import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import type { DeviceCandidate } from "../control-center-types";
import { SetupDeviceCard } from "./setup-device-card";
import { SetupLog, type SetupLogLine } from "./setup-log";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

type SetupDeviceScreenProps = {
  /** Label on the disabled Connect button while the sequence runs. */
  busyLabel?: string;
  candidates: DeviceCandidate[];
  connecting?: boolean;
  logLines: SetupLogLine[];
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onConnect: () => void;
  onCreateSupportReport?: () => void;
  onEnterAddressManually: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
  selectedTarget: string | null;
};

export function SetupDeviceScreen({
  busyLabel = "Connecting",
  candidates,
  connecting = false,
  logLines,
  onAskAiToFix,
  onConnect,
  onCreateSupportReport,
  onEnterAddressManually,
  onSelect,
  selectedTarget,
}: SetupDeviceScreenProps) {
  return (
    <SetupWizardScreen
      label="Choose your VibeTV"
      onAskAiToFix={onAskAiToFix}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Choose your VibeTV</SetupWizardTitle>
      <SetupWizardSubtitle>{foundLabel(candidates.length)}</SetupWizardSubtitle>

      <ItemGroup
        aria-label="VibeTVs found on your WiFi"
        className="mt-4 gap-3"
        role="radiogroup"
      >
        {candidates.map((candidate) => (
          <SetupDeviceCard
            candidate={candidate}
            key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
            onSelect={() => onSelect(candidate)}
            selected={selectedTarget === candidate.target}
          />
        ))}
      </ItemGroup>

      <Button
        className="mt-4 w-full"
        disabled={connecting || !selectedTarget}
        onClick={onConnect}
        type="button"
      >
        {connecting ? <Spinner data-icon="inline-start" /> : null}
        <span>{connecting ? busyLabel : "Connect"}</span>
      </Button>
      <Button
        disabled={connecting}
        onClick={onEnterAddressManually}
        size="sm"
        type="button"
        variant="link"
      >
        Enter IP address manually
      </Button>

      <SetupLog className="mt-4" lines={logLines} running={connecting} />
    </SetupWizardScreen>
  );
}

function foundLabel(count: number): string {
  return count === 1
    ? "1 VibeTV found on your WiFi."
    : `${count} VibeTVs found on your WiFi.`;
}
