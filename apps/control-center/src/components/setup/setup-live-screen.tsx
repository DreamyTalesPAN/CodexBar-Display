"use client";

import { useEffect } from "react";
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
  /** This app already finished setup for this VibeTV once. */
  alreadySetUp?: boolean;
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /** The app runs on Windows; the Help menu words its outcomes for it. */
  windowsHost?: boolean;
  onPreviewReady?: () => void;
  usage: UsageSnapshot | null;
};

/**
 * The wizard leaves once VibeTV shows its theme with real usage and the preview
 * has drawn it, or VibeTV alone confirms a theme this app cannot draw. A VibeTV
 * set up before skips this screen. There is no Back: nothing here is a choice.
 */
export function SetupLiveScreen({
  device,
  displayFrame,
  alreadySetUp,
  aiFixPrompt,
  onCreateSupportReport,
  windowsHost,
  onPreviewReady,
  usage,
}: SetupLiveScreenProps) {
  useEffect(() => {
    if (alreadySetUp) {
      onPreviewReady?.();
    }
  }, [alreadySetUp, onPreviewReady]);
  if (alreadySetUp) {
    return null;
  }
  return (
    <SetupWizardScreen
      label="Your VibeTV is live"
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <SetupWizardTitle>Your VibeTV is live</SetupWizardTitle>
      <div className="mt-6 w-full">
        <LiveVibeTVPreview
          device={device}
          displayFrame={displayFrame}
          onPreviewReady={onPreviewReady}
          usage={usage}
        />
      </div>
    </SetupWizardScreen>
  );
}
