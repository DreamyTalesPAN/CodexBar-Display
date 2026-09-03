"use client";

import type {
  DeviceInfo,
  SupportDiagnostics,
  UsageSnapshot,
} from "../control-center-types";
import {
  LiveVibeTVPreview,
  type DisplayFrameSnapshot,
} from "../live-vibetv-preview";
import { SetupWizardScreen, SetupWizardTitle } from "./setup-wizard-screen";

type SetupLiveScreenProps = {
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  onPreviewReadyChange?: (ready: boolean) => void;
  usage: UsageSnapshot | null;
};

/**
 * Last step. It has no controls and no way back: the wizard leaves on its own
 * once the first frame renders, so the only thing left to show is the frame.
 */
export function SetupLiveScreen({
  device,
  displayFrame,
  aiFixPrompt,
  onCreateSupportReport,
  onPreviewReadyChange,
  usage,
}: SetupLiveScreenProps) {
  return (
    <SetupWizardScreen
      label="Your VibeTV is live"
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
    >
      <SetupWizardTitle>Your VibeTV is live</SetupWizardTitle>
      <LiveVibeTVPreview
        device={device}
        displayFrame={displayFrame}
        onPreviewReadyChange={onPreviewReadyChange}
        usage={usage}
      />
    </SetupWizardScreen>
  );
}
