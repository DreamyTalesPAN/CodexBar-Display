"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { ControlCenterBrand } from "../control-center-brand";
import { SetupWizardScreen } from "./setup-wizard-screen";

type SetupWelcomeScreenProps = {
  lines: SetupLogLine[];
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
};

/**
 * First step. It has no controls: the wizard advances on its own as soon as the
 * background service, the usage read and the device search have answered.
 */
export function SetupWelcomeScreen({
  lines,
  aiFixPrompt,
  onCreateSupportReport,
}: SetupWelcomeScreenProps) {
  return (
    <SetupWizardScreen
      label="Welcome"
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
    >
      <p className="text-xs font-semibold tracking-[0.3em] text-muted-foreground uppercase">
        Welcome to
      </p>
      <ControlCenterBrand variant="hero" />
      <SetupLog className="mt-3" lines={lines} running />
    </SetupWizardScreen>
  );
}
