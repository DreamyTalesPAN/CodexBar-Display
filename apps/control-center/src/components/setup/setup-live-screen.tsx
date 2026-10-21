"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DeviceInfo,
  SupportDiagnostics,
  UsageSnapshot,
} from "../control-center-types";
import {
  LiveVibeTVPreview,
  type DisplayFrameSnapshot,
} from "../live-vibetv-preview";
import { SetupVibeTV3DPreview, useHardware3D } from "./setup-3d-preview";
import {
  CALM_TITLE_CLASS,
  SetupWizardScreen,
  SetupWizardTitle,
} from "./setup-wizard-screen";

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
  // The same 3D VibeTV as the Overview: it starts after the first paint, only
  // on a hardware WebGL, and replaces the flat preview once its model is on
  // screen. The flat preview stays mounted underneath: it is the one that tells
  // the wizard VibeTV shows its theme, and it is all there is without WebGL.
  // With WebGL it draws only the screen, never the flat picture, and the area
  // stays empty until the model is on screen.
  const hardware3D = useHardware3D();
  const [threeState, setThreeState] = useState<"loading" | "ready" | "failed">("loading");
  const onThreeReady = useCallback(() => setThreeState("ready"), []);
  const onThreeFailed = useCallback(() => setThreeState("failed"), []);
  const threeReady = threeState === "ready";
  const preview3D = threeState === "failed" ? false : hardware3D;
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
      <SetupWizardTitle className={CALM_TITLE_CLASS}>Your VibeTV is live</SetupWizardTitle>
      <div className="relative mt-8 flex w-full justify-center">
        {preview3D ? (
          <div
            // Until the 3D is revealed it is only drawn in the background: the
            // flat preview is the one screen readers get.
            aria-hidden={threeReady ? undefined : true}
            className={
              threeReady
                ? "flex w-full justify-center"
                : "absolute inset-0 flex justify-center opacity-0"
            }
            inert={threeReady ? undefined : true}
          >
            <SetupVibeTV3DPreview
              className="-my-[22px] aspect-[640/411] w-[min(640px,calc(100vw-48px))] max-w-none shrink-0"
              device={device}
              displayFrame={displayFrame}
              onReady={onThreeReady}
              onFailed={onThreeFailed}
              usage={usage}
            />
          </div>
        ) : null}
        <div
          className={
            threeReady
              ? "hidden"
              : preview3D === false
                ? "w-full"
                : "invisible aspect-[640/411] w-[min(640px,calc(100vw-48px))]"
          }
        >
          <LiveVibeTVPreview
            device={device}
            displayFrame={displayFrame}
            onPreviewReady={threeReady || preview3D === false ? onPreviewReady : undefined}
            screenOnly={preview3D !== false}
            usage={usage}
          />
        </div>
      </div>
    </SetupWizardScreen>
  );
}
