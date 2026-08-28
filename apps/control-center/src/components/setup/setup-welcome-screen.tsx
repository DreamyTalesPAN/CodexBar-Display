"use client";

import { SetupLog, type SetupLogLine } from "./setup-log";
import { SetupWizardScreen } from "./setup-wizard-screen";

type SetupWelcomeScreenProps = {
  lines: SetupLogLine[];
  onAskAiToFix?: () => boolean | Promise<boolean>;
  onCreateSupportReport?: () => void;
};

/**
 * First step. It has no controls: the wizard advances on its own as soon as the
 * background service, the usage read and the device search have answered.
 */
export function SetupWelcomeScreen({
  lines,
  onAskAiToFix,
  onCreateSupportReport,
}: SetupWelcomeScreenProps) {
  return (
    <SetupWizardScreen
      label="Welcome"
      onAskAiToFix={onAskAiToFix}
      onCreateSupportReport={onCreateSupportReport}
    >
      <p className="text-xs font-semibold tracking-[0.3em] text-muted-foreground uppercase">
        Welcome to
      </p>
      <p className="text-[64px] leading-none font-black uppercase">
        VIBE<span className="text-[var(--vibetv-support)]">TV</span>
      </p>
      <SetupLog className="mt-3 h-auto max-h-[118px]" lines={lines} running />
    </SetupWizardScreen>
  );
}
