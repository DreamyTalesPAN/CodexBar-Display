"use client";

import type { DeviceInfo, UsageSnapshot } from "../control-center-types";
import {
  LiveVibeTVPreview,
  type DisplayFrameSnapshot,
} from "../live-vibetv-preview";
import { SetupWizardScreen, SetupWizardTitle } from "./setup-wizard-screen";

type SetupLiveScreenProps = {
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onCreateSupportReport?: () => void;
  usage: UsageSnapshot | null;
};

/**
 * Last step. It has no controls and no way back: the wizard leaves on its own
 * once the first frame renders, so the only thing left to show is the frame.
 */
export function SetupLiveScreen({
  device,
  displayFrame,
  onAskAiToFix,
  onCreateSupportReport,
  usage,
}: SetupLiveScreenProps) {
  return (
    <SetupWizardScreen
      label="Your VibeTV is live"
      onAskAiToFix={onAskAiToFix}
      onCreateSupportReport={onCreateSupportReport}
    >
      <LiveVibeTVPreview
        device={device}
        displayFrame={displayFrame}
        usage={usage}
      />
      <SetupWizardTitle>Your VibeTV is live</SetupWizardTitle>
    </SetupWizardScreen>
  );
}
