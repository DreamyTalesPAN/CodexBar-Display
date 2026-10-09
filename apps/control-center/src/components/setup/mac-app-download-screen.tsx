"use client";

import type { SupportDiagnostics } from "../control-center-types";
import { Download, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  availableMacAppDmgDownloadUrl,
  availableWindowsAppSetupDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import type { CustomerPlatform } from "@/lib/customer-platform";
import type { ThemeProduct } from "@/lib/themes";
import { isRemoteThemePackUrl } from "@/lib/theme-pack-url";
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
  theme?: ThemeProduct;
};

/**
 * What app.vibetv.shop serves. The device prints that address on its own screen
 * once it joins WiFi. The plain entry offers the app download; a valid shop
 * theme entry first opens an installed app at that theme, with the download as
 * fallback. Everything after the handoff happens inside the app.
 */
export function MacAppDownloadScreen({
  onCreateSupportReport,
  platform = "unknown",
  release,
  theme,
}: MacAppDownloadScreenProps) {
  const downloadUrl = availableMacAppDmgDownloadUrl(release);
  const windowsDownloadUrl = availableWindowsAppSetupDownloadUrl(release);
  const openThemeUrl =
    theme?.source === "shopify" &&
    theme.isFree &&
    theme.themeId.length >= 3 &&
    theme.themeId.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme.themeId) &&
    isRemoteThemePackUrl(theme.packUrl) &&
    /^[a-f0-9]{64}$/i.test(theme.packSha256 || "") &&
    Number.isSafeInteger(theme.packSizeBytes) &&
    (theme.packSizeBytes || 0) > 0
      ? `vibetv://install-theme/${theme.themeId}`
      : undefined;

  if (platform === "windows") {
    return (
      <DownloadScreenFrame
        onCreateSupportReport={onCreateSupportReport}
        subtitle={
          openThemeUrl
            ? "Open this theme in Control Center."
            : "Get the app, then it takes you through the rest."
        }
      >
        <OpenControlCenter href={openThemeUrl} />
        <PrimaryDownload
          href={windowsDownloadUrl}
          label="Download for Windows"
          secondary={Boolean(openThemeUrl)}
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
        subtitle={
          openThemeUrl
            ? "Open this theme in Control Center."
            : "Get the app for your computer, then it takes you through the rest."
        }
      >
        <OpenControlCenter href={openThemeUrl} />
        <PrimaryDownload
          href={downloadUrl}
          label="Download for macOS"
          secondary={Boolean(openThemeUrl)}
        />
        {windowsDownloadUrl ? (
          <PrimaryDownload
            href={windowsDownloadUrl}
            label="Download for Windows"
            secondary={Boolean(openThemeUrl)}
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
        {openThemeUrl
          ? "Open this theme in the Mac App."
          : "Get the Mac App, then it takes you through the rest."}
      </SetupWizardSubtitle>

      <OpenControlCenter href={openThemeUrl} />
      {downloadUrl ? (
        <Button
          asChild
          className="mt-4 w-full"
          size="lg"
          variant={openThemeUrl ? "outline" : "default"}
        >
          <a href={downloadUrl}>
            <Download data-icon="inline-start" aria-hidden />
            <span>Download</span>
          </a>
        </Button>
      ) : (
        <>
          <Button
            className="mt-4 w-full"
            disabled
            size="lg"
            type="button"
            variant={openThemeUrl ? "outline" : "default"}
          >
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
  secondary = false,
}: {
  href: string | undefined;
  label: string;
  secondary?: boolean;
}) {
  if (href) {
    return (
      <Button
        asChild
        className="mt-4 w-full"
        size="lg"
        variant={secondary ? "outline" : "default"}
      >
        <a href={href}>
          <Download data-icon="inline-start" aria-hidden />
          <span>{label}</span>
        </a>
      </Button>
    );
  }
  return (
    <>
      <Button
        className="mt-4 w-full"
        disabled
        size="lg"
        type="button"
        variant={secondary ? "outline" : "default"}
      >
        <Download data-icon="inline-start" aria-hidden />
        <span>{label}</span>
      </Button>
      <SetupWizardSubtitle>
        The signed download is not ready yet. Please try again later.
      </SetupWizardSubtitle>
    </>
  );
}

function OpenControlCenter({ href }: { href: string | undefined }) {
  if (!href) {
    return null;
  }
  return (
    <Button asChild className="mt-4 w-full" size="lg">
      <a href={href}>
        <ExternalLink data-icon="inline-start" aria-hidden />
        <span>Open Control Center</span>
      </a>
    </Button>
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
