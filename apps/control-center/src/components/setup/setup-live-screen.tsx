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
  onPreviewReady?: () => void;
  onBack?: () => void;
  usage: UsageSnapshot | null;
};

/**
 * The wizard leaves once the first frame renders. Back keeps theme recovery
 * available when the active custom preview was lost with the Mac's data.
 */
export function SetupLiveScreen({
  device,
  displayFrame,
  aiFixPrompt,
  onCreateSupportReport,
  onPreviewReady,
  onBack,
  usage,
}: SetupLiveScreenProps) {
  return (
    <SetupWizardScreen
      label="Your VibeTV is live"
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
      onBack={onBack}
    >
      <SetupWizardTitle>Your VibeTV is live</SetupWizardTitle>
      <LiveVibeTVPreview
        device={device}
        displayFrame={displayFrame}
        onPreviewReady={onPreviewReady}
        usage={usage}
      />
    </SetupWizardScreen>
  );
}
