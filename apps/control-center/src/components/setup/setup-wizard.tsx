"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DeviceCandidate,
  DeviceInfo,
  DeviceSearchState,
  ProviderDisplaySelection,
  SupportDiagnostics,
  UsageSnapshot,
} from "../control-center-types";
import type { DisplayFrameSnapshot } from "../live-vibetv-preview";
import type { ProviderItem } from "../provider-picker";
import { useSetupConnect, type SetupConnectSteps } from "./setup-connect";
import { connectLogLines } from "./setup-connect-log";
import {
  SetupAddressDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
} from "./setup-device-dialogs";
import { SetupDeviceScreen } from "./setup-device-screen";
import {
  SetupDisplayModeScreen,
  type SetupDisplayModePreview,
  type SetupDisplayModeProvider,
} from "./setup-display-mode-screen";
import {
  SetupFirmwareBlockedDialog,
  SetupFirmwareUpdateFailedDialog,
} from "./setup-firmware-dialogs";
import { SetupLiveScreen } from "./setup-live-screen";
import type { SetupLogLine } from "./setup-log";
import { SetupProvidersScreen } from "./setup-providers-screen";
import {
  previousSetupStep,
  resolveSetupStep,
  type SetupStep,
} from "./setup-step";
import {
  SetupThemeScreen,
  type SetupThemeOption,
} from "./setup-theme-screen";
import { SetupUsageDialog, type SetupUsageCause } from "./setup-usage-dialog";
import { SetupWelcomeScreen } from "./setup-welcome-screen";

export type SetupWizardProps = {
  aiFixPrompt: () => string;
  automaticPreviews: SetupDisplayModePreview[];
  connectSteps: SetupConnectSteps;
  device: DeviceInfo | null;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  displayFrame: DisplayFrameSnapshot | null;
  displayMode: ProviderDisplaySelection["mode"];
  displayProviderId: string | null;
  displayProviders: SetupDisplayModeProvider[];
  installingTheme: boolean;
  onConnectManualTarget: (target: string) => void;
  onCreateSupportReport: () => Promise<SupportDiagnostics | null>;
  onDisplayContinue: () => void;
  /** The closing step has been shown; the app can take the screen back. */
  onFinished: () => void;
  onDisplayModeChange: (mode: ProviderDisplaySelection["mode"]) => void;
  onDisplayProviderChange: (providerId: string) => void;
  onInstallTheme: () => void;
  onProviderCheck: (provider: ProviderItem) => void;
  onProviderRecover: (provider: ProviderItem) => void;
  onProviderToggle: (provider: ProviderItem, enabled: boolean) => void;
  onProvidersContinue: () => void;
  onRepairUsageService: () => void;
  onSearchDevices: () => void;
  onSelectTheme: (theme: SetupThemeOption) => void;
  providers: ProviderItem[];
  selectedThemeId: string | null;
  step: SetupStep;
  themeInstallLogs: string[];
  themes: SetupThemeOption[];
  usage: UsageSnapshot | null;
  /** Set while the usage service cannot answer; opens the usage dialog. */
  usageFailure: SetupUsageCause | null;
  welcomeLines: SetupLogLine[];
};

/**
 * The whole setup journey: which step is on screen, the connect sequence, and
 * which error is being shown over it.
 *
 * The step comes in derived from real state; the only thing kept here is where
 * the customer went back to, and even that is dropped the moment the state
 * moves past it.
 */
export function SetupWizard(props: SetupWizardProps) {
  const {
    aiFixPrompt,
    connectSteps,
    deviceCandidates,
    deviceSearchState,
    onCreateSupportReport,
    onSearchDevices,
    step: derivedStep,
  } = props;

  const [wentBackTo, setWentBackTo] = useState<SetupStep | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [dismissedSearchState, setDismissedSearchState] =
    useState<DeviceSearchState | null>(null);
  const [usageDialogDismissed, setUsageDialogDismissed] = useState(false);
  const connect = useSetupConnect(connectSteps);

  const step = resolveSetupStep(derivedStep, wentBackTo);
  const back = previousSetupStep(step);
  const goBack = back ? () => setWentBackTo(back) : undefined;

  const preselected = useMemo(() => {
    if (selectedTarget) {
      return selectedTarget;
    }
    const known = deviceCandidates.find((candidate) => candidate.known);
    return known?.target ?? deviceCandidates[0]?.target ?? null;
  }, [deviceCandidates, selectedTarget]);

  const searchFailed =
    deviceSearchState === "not-found" && dismissedSearchState !== "not-found";

  const startConnect = useCallback(() => {
    const candidate = deviceCandidates.find(
      (entry) => entry.target === preselected,
    );
    if (candidate) {
      void connect.run(candidate);
    }
  }, [connect, deviceCandidates, preselected]);

  const help = {
    aiFixPrompt,
    onCreateSupportReport,
  };

  if (step === "welcome") {
    return <SetupWelcomeScreen {...help} lines={props.welcomeLines} />;
  }

  if (step === "device") {
    const connecting =
      connect.state.phase !== "idle" &&
      connect.state.phase !== "done" &&
      connect.state.phase !== "failed";
    return (
      <>
        <SetupDeviceScreen
          {...help}
          candidates={deviceCandidates}
          connecting={connecting}
          logLines={connectLogLines(connect.state)}
          onConnect={startConnect}
          onEnterAddressManually={() => setAddressDialogOpen(true)}
          onSelect={(candidate) => setSelectedTarget(candidate.target)}
          selectedTarget={preselected}
        />
        <SetupAddressDialog
          onConnect={(target) => {
            setAddressDialogOpen(false);
            props.onConnectManualTarget(target);
          }}
          onOpenChange={setAddressDialogOpen}
          open={addressDialogOpen}
        />
        <SetupDeviceNotFoundDialog
          onEnterAddressManually={() => {
            setDismissedSearchState("not-found");
            setAddressDialogOpen(true);
          }}
          onOpenChange={(open) =>
            setDismissedSearchState(open ? null : "not-found")
          }
          onScanAgain={() => {
            setDismissedSearchState("not-found");
            onSearchDevices();
          }}
          open={searchFailed}
        />
        <SetupConnectFailedDialog
          description={
            connect.failure?.kind === "connect"
              ? connect.failure.description
              : ""
          }
          onEnterAddressManually={() => {
            connect.dismissFailure();
            setAddressDialogOpen(true);
          }}
          onOpenChange={(open) => !open && connect.dismissFailure()}
          onSearchAgain={() => {
            connect.reset();
            onSearchDevices();
          }}
          open={connect.failure?.kind === "connect"}
          title={
            connect.failure?.kind === "connect" ? connect.failure.title : ""
          }
        />
        {connect.failure?.kind === "firmware-blocked" ? (
          <SetupFirmwareBlockedDialog
            onOpenChange={(open) => !open && connect.dismissFailure()}
            onResolve={startConnect}
            open
            reason={connect.failure.reason}
          />
        ) : null}
        <SetupFirmwareUpdateFailedDialog
          onCreateSupportReport={() => void onCreateSupportReport()}
          onOpenChange={(open) => !open && connect.dismissFailure()}
          onRetry={startConnect}
          open={connect.failure?.kind === "firmware-update"}
        />
      </>
    );
  }

  if (step === "providers") {
    return (
      <>
        <SetupProvidersScreen
          {...help}
          onBack={goBack}
          onCheckAgain={props.onProviderCheck}
          onContinue={props.onProvidersContinue}
          onRecover={props.onProviderRecover}
          onToggle={props.onProviderToggle}
          providers={props.providers}
        />
        {props.usageFailure && !usageDialogDismissed ? (
          <SetupUsageDialog
            cause={props.usageFailure}
            onCreateSupportReport={() => void onCreateSupportReport()}
            onOpenChange={(open) => setUsageDialogDismissed(!open)}
            onRepair={props.onRepairUsageService}
            open
          />
        ) : null}
      </>
    );
  }

  if (step === "display") {
    return (
      <SetupDisplayModeScreen
        {...help}
        automaticPreview={props.automaticPreviews[0] ?? null}
        automaticPreviews={props.automaticPreviews}
        manualPreview={
          props.automaticPreviews.find(
            (preview) =>
              preview.providerLabel ===
              props.displayProviders.find(
                (provider) => provider.id === props.displayProviderId,
              )?.label,
          ) ?? null
        }
        mode={props.displayMode}
        onBack={goBack}
        onContinue={props.onDisplayContinue}
        onSelectMode={props.onDisplayModeChange}
        onSelectProvider={props.onDisplayProviderChange}
        providers={props.displayProviders}
        selectedProviderId={props.displayProviderId}
      />
    );
  }

  if (step === "theme") {
    return (
      <SetupThemeScreen
        {...help}
        installLogs={props.themeInstallLogs}
        installing={props.installingTheme}
        onBack={goBack}
        onInstall={props.onInstallTheme}
        onSelect={props.onSelectTheme}
        selectedThemeId={props.selectedThemeId}
        themes={props.themes}
      />
    );
  }

  return (
    <SetupFinalStep
      {...help}
      device={props.device}
      displayFrame={props.displayFrame}
      onFinished={props.onFinished}
      usage={props.usage}
    />
  );
}

const HANDOVER_MS = 2500;

/** Shows VibeTV running, then hands the screen back to the app on its own. */
function SetupFinalStep({
  onFinished,
  ...live
}: {
  aiFixPrompt: () => string;
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  onCreateSupportReport: () => Promise<SupportDiagnostics | null>;
  onFinished: () => void;
  usage: UsageSnapshot | null;
}) {
  // Kept in a ref so a re-render cannot restart the timer and leave the
  // customer parked on this step forever.
  const finish = useRef(onFinished);

  useEffect(() => {
    finish.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    const timer = window.setTimeout(() => finish.current(), HANDOVER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return <SetupLiveScreen {...live} />;
}
