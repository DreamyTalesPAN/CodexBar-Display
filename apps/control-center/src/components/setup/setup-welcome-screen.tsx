"use client";

import { Button } from "@/components/ui/button";
import type { SupportDiagnostics } from "../control-center-types";
import { SetupLog, type SetupLogLine } from "./setup-log";
import { ControlCenterBrand } from "../control-center-brand";
import { cn } from "@/lib/utils";
import { CALM_LINK_CLASS, SetupWizardScreen } from "./setup-wizard-screen";

type SetupWelcomeScreenProps = {
  lines: SetupLogLine[];
  /** Whether the WiFi search is still running; its log says so only then. */
  searching?: boolean;
  aiFixPrompt?: () => string;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /** The app runs on Windows; the Help menu words its outcomes for it. */
  windowsHost?: boolean;
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
  searching = true,
  aiFixPrompt,
  onCreateSupportReport,
  windowsHost,
  onEnterAddressManually,
}: SetupWelcomeScreenProps) {
  return (
    <SetupWizardScreen
      centered
      label="Welcome"
      aiFixPrompt={aiFixPrompt}
      onCreateSupportReport={onCreateSupportReport}
      windowsHost={windowsHost}
    >
      <p className="text-[13px] text-muted-foreground">Welcome to</p>
      <ControlCenterBrand className="mt-3.5" variant="hero" />
      <SetupLog className="mt-8" lines={lines} running={searching} />
      {onEnterAddressManually ? (
        <Button
          className={cn(CALM_LINK_CLASS, "mt-5")}
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
