"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiError,
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
import { SetupProviderStepFailedDialog } from "./setup-provider-dialogs";
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
  /** Percent of the running firmware install, for the frozen log line. */
  firmwareProgress?: number;
  installingTheme: boolean;
  /** Resolves with the VibeTV at that address, or rejects with what to show. */
  onFindManualTarget: (target: string) => Promise<DeviceCandidate>;
  onCreateSupportReport: () => Promise<SupportDiagnostics | null>;
  /**
   * Called once, with what the customer settled on. Resolving false keeps them
   * on the step: a save that did not land must not read as one that did.
   */
  onDisplayContinue: (
    selection: Pick<ProviderDisplaySelection, "mode" | "providerIds">,
  ) => void | Promise<boolean | void>;
  /** The closing step has been shown; the app can take the screen back. */
  onFinished: () => void;
  onInstallTheme: () => void;
  onProviderCheck: (provider: ProviderItem) => void;
  onProviderRecover: (provider: ProviderItem) => void;
  onProviderToggle: (provider: ProviderItem, enabled: boolean) => void;
  onProvidersContinue: () => void;
  /** What the companion refused the provider or display step, if anything. */
  providerError: ApiError | null;
  onDismissProviderError: () => void;
  /** Ask the companion again for whatever the step could not read. */
  onRetryProviders: () => void;
  onSearchDevices: () => void;
  /** Why the last scan could not be made, when that is what happened. */
  searchError: ApiError | null;
  onSelectTheme: (theme: SetupThemeOption) => void;
  providers: ProviderItem[];
  selectedThemeId: string | null;
  step: SetupStep;
  themeInstallLogs: string[];
  themes: SetupThemeOption[];
  usage: UsageSnapshot | null;
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
  const [notFoundDismissed, setNotFoundDismissed] = useState(false);
  const [searchErrorDismissed, setSearchErrorDismissed] = useState(false);
  // Held rather than written on every touch: writing on selection ends the
  // step, so Continue was only ever reachable by not changing anything.
  const [displayDraft, setDisplayDraft] = useState<{
    mode: ProviderDisplaySelection["mode"];
    providerId: string | null;
  } | null>(null);
  const connect = useSetupConnect(connectSteps, props.firmwareProgress);

  // Pairing publishes the connected VibeTV before the firmware check and any
  // install have finished, so the derived step can move on while the connect
  // sequence is still running -- and the firmware progress and its failure
  // dialogs live on this step. Leaving would run the update out of sight and
  // strand its failure on a screen nobody is on, which is how a customer ends
  // up past a firmware step that never completed.
  const connectInFlight =
    connect.state.phase !== "idle" &&
    connect.state.phase !== "done" &&
    connect.state.phase !== "failed";
  const step = connectInFlight
    ? "device"
    : resolveSetupStep(derivedStep, wentBackTo);
  const back = previousSetupStep(step);
  const goBack = back ? () => setWentBackTo(back) : undefined;
  // The counterpart to goBack. Without it the override outlives the visit it
  // was made for: Continue answers, the derived step is already ahead, and the
  // customer is held on the step they came back to with no Back button left.
  const goForward = useCallback(() => setWentBackTo(null), []);

  const preselected = useMemo(() => {
    if (selectedTarget) {
      return selectedTarget;
    }
    const known = deviceCandidates.find((candidate) => candidate.known);
    return known?.target ?? deviceCandidates[0]?.target ?? null;
  }, [deviceCandidates, selectedTarget]);

  const searchFailed = deviceSearchState === "not-found" && !notFoundDismissed;
  // "idle" is before the first scan was started, so like "searching" it has no
  // result to report. Claiming a count there told the customer none were found
  // while the scan that would find them had not answered, or not even run.
  const searchingForDevices =
    deviceSearchState === "idle" || deviceSearchState === "searching";

  // Searching again clears the dismissal, so a second empty scan is explained
  // rather than leaving the customer on an empty list with no reason for it.
  const searchAgain = useCallback(() => {
    setNotFoundDismissed(false);
    setSearchErrorDismissed(false);
    onSearchDevices();
  }, [onSearchDevices]);

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
    const connecting = connectInFlight;
    return (
      <>
        <SetupDeviceScreen
          {...help}
          candidates={deviceCandidates}
          connecting={connecting}
          logLines={connectLogLines(connect.state)}
          onConnect={startConnect}
          onEnterAddressManually={() => {
            setNotFoundDismissed(true);
            setAddressDialogOpen(true);
          }}
          onSearchAgain={searchAgain}
          onSelect={(candidate) => setSelectedTarget(candidate.target)}
          searching={searchingForDevices}
          selectedTarget={preselected}
        />
        <SetupAddressDialog
          onConnect={async (target) => {
            try {
              const candidate = await props.onFindManualTarget(target);
              // Closed here rather than through onOpenChange: that would clear
              // notFoundDismissed and re-open "We couldn't find your VibeTV"
              // over the connecting screen, because the search state only
              // clears once the connect answers.
              setAddressDialogOpen(false);
              void connect.run(candidate);
              return null;
            } catch (error) {
              const failure = error as ApiError;
              return (
                [failure?.message, failure?.nextAction]
                  .filter(Boolean)
                  .join(" ") || null
              );
            }
          }}
          onOpenChange={(open) => {
            setAddressDialogOpen(open);
            if (!open) {
              setNotFoundDismissed(false);
            }
          }}
          open={addressDialogOpen}
        />
        <SetupDeviceNotFoundDialog
          onEnterAddressManually={() => {
            setNotFoundDismissed(true);
            setAddressDialogOpen(true);
          }}
          onOpenChange={(open) => setNotFoundDismissed(!open)}
          onScanAgain={searchAgain}
          open={searchFailed}
        />
        {/*
          A scan that could not be made at all. Without this the step showed a
          count of zero and kept the reason -- a refused Local Network
          permission, a companion that did not answer -- to itself, so the
          customer could only try the same thing again.
        */}
        <SetupConnectFailedDialog
          description={
            props.searchError
              ? [props.searchError.message, props.searchError.nextAction]
                  .filter(Boolean)
                  .join(" ")
              : ""
          }
          onEnterAddressManually={() => {
            setSearchErrorDismissed(true);
            setAddressDialogOpen(true);
          }}
          onOpenChange={(open) => setSearchErrorDismissed(!open)}
          onSearchAgain={searchAgain}
          open={Boolean(props.searchError) && !searchErrorDismissed}
          title="We couldn't search for your VibeTV"
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
            searchAgain();
          }}
          open={connect.failure?.kind === "connect"}
          title={
            connect.failure?.kind === "connect" ? connect.failure.title : ""
          }
        />
        {connect.failure?.kind === "firmware-blocked" ? (
          <SetupFirmwareBlockedDialog
            onOpenChange={(open) => !open && connect.dismissFailure()}
            onResolve={connect.retry}
            open
            reason={connect.failure.reason}
          />
        ) : null}
        <SetupFirmwareUpdateFailedDialog
          onCreateSupportReport={() => void onCreateSupportReport()}
          onOpenChange={(open) => !open && connect.dismissFailure()}
          onRetry={connect.retry}
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
          onContinue={() => {
            goForward();
            props.onProvidersContinue();
          }}
          onRecover={props.onProviderRecover}
          onToggle={props.onProviderToggle}
          providers={props.providers}
        />
        <SetupProviderStepFailedDialog
          error={props.providerError}
          onOpenChange={(open) => !open && props.onDismissProviderError()}
          onRetry={props.onRetryProviders}
        />
      </>
    );
  }

  if (step === "display") {
    const displayMode = displayDraft?.mode ?? props.displayMode;
    const displayProviderId =
      displayDraft?.providerId ?? props.displayProviderId;
    return (
      <>
        <SetupDisplayModeScreen
          {...help}
          automaticPreview={props.automaticPreviews[0] ?? null}
          automaticPreviews={props.automaticPreviews}
          manualPreview={
            props.automaticPreviews.find(
              (preview) =>
                preview.providerLabel ===
                props.displayProviders.find(
                  (provider) => provider.id === displayProviderId,
                )?.label,
            ) ?? null
          }
          mode={displayMode}
          onBack={goBack}
          onContinue={() => {
            // Deliberately not goForward() first: a failed save rolls the
            // selection back, so the derived step stays on theme and the
            // customer would be carried off this step believing the new choice
            // was kept.
            void Promise.resolve(
              props.onDisplayContinue({
                mode: displayMode,
                providerIds:
                  displayMode === "fixed" && displayProviderId
                    ? [displayProviderId]
                    : props.displayProviders.map((provider) => provider.id),
              }),
            ).then((saved) => {
              if (saved !== false) {
                goForward();
              }
            });
          }}
          onSelectMode={(mode) =>
            setDisplayDraft({ mode, providerId: displayProviderId })
          }
          onSelectProvider={(providerId) =>
            setDisplayDraft({ mode: displayMode, providerId })
          }
          providers={props.displayProviders}
          selectedProviderId={displayProviderId}
        />
        <SetupProviderStepFailedDialog
          error={props.providerError}
          onOpenChange={(open) => !open && props.onDismissProviderError()}
          onRetry={props.onRetryProviders}
        />
      </>
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
