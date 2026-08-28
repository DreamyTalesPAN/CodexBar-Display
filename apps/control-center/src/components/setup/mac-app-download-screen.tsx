"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import { ControlCenterBrand } from "../control-center-brand";
import { SetupWizardScreen, SetupWizardSubtitle } from "./setup-wizard-screen";

const INSTALL_STEPS = [
  "Open the downloaded DMG.",
  "Drag VibeTV Control Center to Applications and wait for the copy to finish.",
  "Open VibeTV Control Center from Applications. If macOS asks, choose Open.",
];

type MacAppDownloadScreenProps = {
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  release: CompanionReleaseInfo | null;
};

/**
 * What app.vibetv.shop serves. The device prints that address on its own screen
 * once it joins WiFi, so this page only has one job: hand over the Mac App.
 * Everything after the install happens inside the app itself.
 */
export function MacAppDownloadScreen({
  onCreateSupportReport,
  release,
}: MacAppDownloadScreenProps) {
  const downloadUrl = availableMacAppDmgDownloadUrl(release);

  return (
    <SetupWizardScreen
      label="Download VibeTV Control Center"
      onCreateSupportReport={onCreateSupportReport}
    >
      <p className="text-xs font-semibold tracking-[0.3em] text-muted-foreground uppercase">
        Welcome to
      </p>
      <ControlCenterBrand variant="hero" />
      <SetupWizardSubtitle>
        Get the Mac App, then it takes you through the rest.
      </SetupWizardSubtitle>

      {downloadUrl ? (
        <Button asChild className="mt-4 w-full" size="lg">
          <a href={downloadUrl}>
            <Download data-icon="inline-start" aria-hidden />
            <span>Download</span>
          </a>
        </Button>
      ) : (
        <>
          <Button className="mt-4 w-full" disabled size="lg" type="button">
            <Download data-icon="inline-start" aria-hidden />
            <span>Download</span>
          </Button>
          <SetupWizardSubtitle>
            The signed download is not ready yet. Please try again later.
          </SetupWizardSubtitle>
        </>
      )}

      <ol className="mt-4 grid list-decimal gap-2 pl-5 text-left text-sm text-muted-foreground">
        {INSTALL_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </SetupWizardScreen>
  );
}
