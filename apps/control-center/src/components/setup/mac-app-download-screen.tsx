"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  availableMacAppDmgDownloadUrl,
  availableWindowsAppSetupDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import type { CustomerPlatform } from "@/lib/customer-platform";
import { ControlCenterBrand } from "../control-center-brand";
import { SetupWizardScreen, SetupWizardSubtitle } from "./setup-wizard-screen";

const INSTALL_STEPS = [
  "Open the downloaded DMG.",
  "Drag VibeTV Control Center to Applications and wait for the copy to finish.",
  "Open VibeTV Control Center from Applications. If macOS asks, choose Open.",
];

const WINDOWS_INSTALL_STEPS = [
  "Open the downloaded installer.",
  "Confirm the installation and wait for it to finish.",
  "Open VibeTV Control Center from the Start menu.",
];

type MacAppDownloadScreenProps = {
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  /**
   * The system this customer is most likely on. "unknown" is the rare case
   * where the browser says nothing usable, and then neither download wins.
   */
  platform?: CustomerPlatform;
  release: CompanionReleaseInfo | null;
};

/**
 * What app.vibetv.shop serves. The device prints that address on its own screen
 * once it joins WiFi, so this page only has one job: hand over the app for the
 * system the customer is actually on. Everything after the install happens
 * inside the app itself. The other system stays reachable through a quiet link,
 * so a wrong guess costs one click instead of the whole setup.
 */
export function MacAppDownloadScreen({
  onCreateSupportReport,
  platform = "unknown",
  release,
}: MacAppDownloadScreenProps) {
  const downloadUrl = availableMacAppDmgDownloadUrl(release);
  const windowsDownloadUrl = availableWindowsAppSetupDownloadUrl(release);

  if (platform === "windows") {
    return (
      <DownloadScreenFrame
        onCreateSupportReport={onCreateSupportReport}
        subtitle="Get the app, then it takes you through the rest."
      >
        <PrimaryDownload
          href={windowsDownloadUrl}
          label="Download for Windows"
        />
        <InstallSteps steps={WINDOWS_INSTALL_STEPS} />
        <QuietAlternative
          href={downloadUrl}
          label="Using a Mac? Download for macOS"
        />
      </DownloadScreenFrame>
    );
  }

  if (platform === "unknown") {
    // Nothing reliable to go on, so neither download may claim to be "yours".
    // The Mac path keeps its existing not-ready fallback; the Windows offer
    // only appears once it can actually work, as the design requires.
    return (
      <DownloadScreenFrame
        onCreateSupportReport={onCreateSupportReport}
        subtitle="Get the app for your computer, then it takes you through the rest."
      >
        <PrimaryDownload href={downloadUrl} label="Download for macOS" />
        {windowsDownloadUrl ? (
          <PrimaryDownload
            href={windowsDownloadUrl}
            label="Download for Windows"
          />
        ) : null}
      </DownloadScreenFrame>
    );
  }

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

function DownloadScreenFrame({
  children,
  onCreateSupportReport,
  subtitle,
}: {
  children: ReactNode;
  onCreateSupportReport?: () => Promise<SupportDiagnostics | null>;
  subtitle: string;
}) {
  return (
    <SetupWizardScreen
      label="Download VibeTV Control Center"
      onCreateSupportReport={onCreateSupportReport}
    >
      <p className="text-xs font-semibold tracking-[0.3em] text-muted-foreground uppercase">
        Welcome to
      </p>
      <ControlCenterBrand variant="hero" />
      <SetupWizardSubtitle>{subtitle}</SetupWizardSubtitle>
      {children}
    </SetupWizardScreen>
  );
}

function PrimaryDownload({
  href,
  label,
}: {
  href: string | undefined;
  label: string;
}) {
  if (href) {
    return (
      <Button asChild className="mt-4 w-full" size="lg">
        <a href={href}>
          <Download data-icon="inline-start" aria-hidden />
          <span>{label}</span>
        </a>
      </Button>
    );
  }
  return (
    <>
      <Button className="mt-4 w-full" disabled size="lg" type="button">
        <Download data-icon="inline-start" aria-hidden />
        <span>{label}</span>
      </Button>
      <SetupWizardSubtitle>
        The signed download is not ready yet. Please try again later.
      </SetupWizardSubtitle>
    </>
  );
}

/**
 * The rescue for a wrong guess. It is a link, never a button, so the screen
 * keeps exactly one primary action.
 */
function QuietAlternative({
  href,
  label,
}: {
  href: string | undefined;
  label: string;
}) {
  if (!href) {
    return null;
  }
  return (
    <a
      className="mt-4 text-sm text-muted-foreground underline underline-offset-4"
      href={href}
    >
      {label}
    </a>
  );
}

function InstallSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="mt-4 grid list-decimal gap-2 pl-5 text-left text-sm text-muted-foreground">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}
