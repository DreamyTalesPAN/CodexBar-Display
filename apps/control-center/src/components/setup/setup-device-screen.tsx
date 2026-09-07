"use client";

import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import type {
  DeviceCandidate,
  SupportDiagnostics,
} from "../control-center-types";
import { SetupDeviceCard } from "./setup-device-card";
import type { ConnectPhase } from "./setup-connect-log";
import { SetupLog, type SetupLogLine } from "./setup-log";
import {
  SetupWizardScreen,
  SetupWizardSubtitle,
  SetupWizardTitle,
} from "./setup-wizard-screen";

type SetupDeviceScreenProps = {
  candidates: DeviceCandidate[];
  connecting?: boolean;
  /** Names the work in flight, so the button reports it instead of "Connecting" throughout. */
  connectPhase?: ConnectPhase;
  logLines: SetupLogLine[];
  aiFixPrompt?: () => string;
  onConnect: () => void;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  onEnterAddressManually: () => void;
  onSearchAgain: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
  /** No scan has produced a result yet, so there is no count to report. */
  searching?: boolean;
  selectedTarget: string | null;
};

export function SetupDeviceScreen({
  candidates,
  connecting = false,
  connectPhase,
  logLines,
  aiFixPrompt,
  onConnect,
  onCreateSupportReport,
  onEnterAddressManually,
  onSearchAgain,
  onSelect,
  searching = false,
  selectedTarget,
}: SetupDeviceScreenProps) {
  return (
    <SetupWizardScreen
      label="Choose your VibeTV"
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Choose your VibeTV</SetupWizardTitle>
      {/*
        Once a VibeTV is being connected the count is no longer what the
        customer is waiting on -- the log below is. Reporting one there also
        outlived its own truth: the search state is neither idle nor searching
        during a connect, so the count was the only thing left to render.
      */}
      {connecting ? null : (
        <SetupWizardSubtitle>
          {searching
            ? "Looking for VibeTVs on your WiFi."
            : foundLabel(candidates.length)}
        </SetupWizardSubtitle>
      )}

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
        <span>{connecting ? connectingLabel(connectPhase) : "Connect"}</span>
      </Button>
      {/*
        The step's own way to try again, not a dialog's. Every dialog that
        offered one could be dismissed, and dismissing it left a scan that had
        answered with nothing on a screen whose only remaining control was the
        address field. One standing control covers every way a scan can end.
      */}
      {searching ? null : (
        <Button
          disabled={connecting}
          onClick={onSearchAgain}
          size="sm"
          type="button"
          variant="link"
        >
          Search again
        </Button>
      )}
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

/**
 * A firmware install is the longest thing behind this button and the one the
 * customer must not unplug through. Reporting all of it as "Connecting" hid
 * that entirely.
 */
function connectingLabel(phase: ConnectPhase | undefined): string {
  switch (phase) {
    case "checking-firmware":
      return "Checking firmware";
    case "updating-firmware":
      return "Updating firmware";
    default:
      return "Connecting";
  }
}

function foundLabel(count: number): string {
  return count === 1
    ? "1 VibeTV found on your WiFi."
    : `${count} VibeTVs found on your WiFi.`;
}
