"use client";

import { Button } from "@/components/ui/button";
import type { SupportDiagnostics } from "../control-center-types";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { ControlCenterBrand } from "../control-center-brand";
import { SetupWizardScreen } from "./setup-wizard-screen";

type SetupWelcomeScreenProps = {
  lines: SetupLogLine[];
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /**
   * Offered while the WiFi search runs. Deliberately a departure from the
   * artboard, which gives this step no controls at all: the search owns up to
   * 40 seconds here, and a customer on a large network who already knows the
   * address must not have to sit through a scan to type it.
   */
  onEnterAddressManually?: () => void;
};

/**
 * First step, and the one that covers the whole start: the background service
 * coming up, the provider read, and the WiFi search. It advances on its own as
 * soon as there is a VibeTV to choose.
 */
export function SetupWelcomeScreen({
  lines,
  aiFixPrompt,
  onCreateSupportReport,
  onEnterAddressManually,
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
      {onEnterAddressManually ? (
        <Button
          className="text-foreground"
          onClick={onEnterAddressManually}
          size="sm"
          type="button"
          variant="link"
        >
          Enter IP address manually
        </Button>
      ) : null}
    </SetupWizardScreen>
  );
}
