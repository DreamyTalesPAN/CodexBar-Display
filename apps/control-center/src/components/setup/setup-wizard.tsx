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
import { SetupUsageDialog, type SetupUsageCause } from "./setup-usage-dialog";
import { SetupWelcomeScreen } from "./setup-welcome-screen";

export type SetupWizardProps = {
  aiFixPrompt: (setupLog: string[]) => string;
  /**
   * The usage service itself is broken. Shown only where the step has no
   * dialog of its own: every one of these is centred, so two at once land on
   * each other and the lower one's buttons cannot be reached.
   */
  usageFailure?: SetupUsageCause | null;
  onRepairUsageService?: () => void;
  /** The customer put the incident away; it returns only if a new one starts. */
  onDismissUsageFailure?: () => void;
  automaticPreviews: SetupDisplayModePreview[];
  connectSteps: SetupConnectSteps;
  device: DeviceInfo | null;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  displayFrame: DisplayFrameSnapshot | null;
  displayMode: ProviderDisplaySelection["mode"];
  displayProviderId: string | null;
  displayProviders: SetupDisplayModeProvider[];
  /** A display choice is being written; its step has not finished yet. */
  displaySavePending: boolean;
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
  onProviderToggle: (provider: ProviderItem, enabled: boolean) => void;
  /**
   * Resolving false keeps the customer on the step: the companion can refuse
   * completion, and the step it would otherwise hand them to has nowhere to
   * show that. A refusal the provider screen carries no control for resolves
   * the step that does carry one, and the wizard shows that step with the same
   * refusal over it.
   */
  onProvidersContinue: () => void | Promise<SetupStep | boolean | void>;
  /** What the companion refused the provider or display step, if anything. */
  providerError: ApiError | null;
  onDismissProviderError: () => void;
  /** Ask the companion again for whatever the step could not read. */
  onRetryProviders: () => void;
  onSearchDevices: () => void;
  /** Providers whose exact check is queued or running. */
  pendingCheckIds: Set<string>;
  /** Preferences whose on/off write is in flight, by preference id. */
  pendingPreferenceIds: Set<string>;
  /** Hand the customer to Sparkle: only it can update the Mac App. */
  onUpdateMacApp: () => void;
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
  // The completion this step asked for is still on its way. Held here rather
  // than passed in: the wizard is what awaits it.
  const [providersContinuing, setProvidersContinuing] = useState(false);
  // Which manual lookup is still the customer's. Leaving the dialog ends the
  // attempt that was running, and the lookup can take a while: its
  // continuation pairs the VibeTV and can start a firmware install, so without
  // this Cancel left both to happen anyway.
  const manualAttemptRef = useRef(0);
  const [searchErrorDismissed, setSearchErrorDismissed] = useState(false);
  // Held rather than written on every touch: writing on selection ends the
  // step, so Continue was only ever reachable by not changing anything.
  const [displayDraft, setDisplayDraft] = useState<{
    mode: ProviderDisplaySelection["mode"];
    providerId: string | null;
  } | null>(null);
  // The counterpart to goBack. Without it the override outlives the visit it
  // was made for: Continue answers, the derived step is already ahead, and the
  // customer is held on the step they came back to with no Back button left.
  // The device step has no Continue; there the connect sequence finishing is
  // what moves on.
  const goForward = useCallback(() => setWentBackTo(null), []);
  const connect = useSetupConnect(
    connectSteps,
    props.firmwareProgress,
    goForward,
  );

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
  // The step is held for the whole sequence, and a failure is not the end of
  // it -- it is the sequence waiting for the customer. Every dialog that
  // offers the retry lives on this step, so leaving would unmount the one
  // explaining it and put them past a firmware check or install that never
  // finished. Deliberately keyed on the phase rather than on `connect.failure`:
  // that object is cleared by dismissing the dialog, which is not the same as
  // the firmware being dealt with. Only a retry that succeeds ("done") or a
  // reset ("idle") releases the step.
  const connectSettled =
    connect.state.phase === "idle" || connect.state.phase === "done";
  const derived = connectSettled
    ? resolveSetupStep(derivedStep, wentBackTo)
    : "device";
  // The display choice is written optimistically so it does not flicker, and
  // the derived step reads that optimism as done -- which would put the
  // customer on the theme step, picking or even installing, on the strength of
  // a write that can still roll back. Held here rather than in
  // `setupDisplayIsConfigured`: that value also decides whether setup owns the
  // screen at all, so waiting there threw a customer out of Settings and back
  // into the wizard for the length of every display save.
  const step =
    props.displaySavePending && derived === "theme" ? "display" : derived;
  const back = previousSetupStep(step);
  // Counted so a write started before a Back press cannot undo it: the display
  // save can still be running when the customer leaves, and its continuation
  // used to release the override and carry them forward from the step they had
  // just gone back to.
  const navigations = useRef(0);
  const goBack = back
    ? () => {
        navigations.current += 1;
        setWentBackTo(back);
      }
    : undefined;
  const preselected = useMemo(() => {
    // Only while it is still one of the answers. A scan that no longer returns
    // the VibeTV the customer had picked left the choice pointing at nothing:
    // no card drawn as selected, Connect still live, and pressing it silently
    // doing nothing because the target is not in the list any more.
    if (
      selectedTarget &&
      deviceCandidates.some((candidate) => candidate.target === selectedTarget)
    ) {
      return selectedTarget;
    }
    const known = deviceCandidates.find((candidate) => candidate.known);
    // With nothing in the list, the sequence that failed is still the thing to
    // press: connecting empties the discovered VibeTVs, so dismissing a
    // firmware dialog left a step that is deliberately held for that failure
    // with a closed Connect and a full rescan as the only way back to it.
    return (
      known?.target ??
      deviceCandidates[0]?.target ??
      (connect.state.phase === "failed" ? connect.state.address : null)
    );
  }, [connect.state, deviceCandidates, selectedTarget]);

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
      return;
    }
    // Nothing in the list matches, which is the failed attempt above: it runs
    // again against the VibeTV it ran against, which is the one the customer
    // is half way through setting up.
    connect.retry();
  }, [connect, deviceCandidates, preselected]);

  // The connect log lives in the wizard, the prompt builder one level up, so
  // "Ask AI to fix" used to copy an app event log that setup barely writes to
  // while the log the customer was looking at never left this component.
  // Shared by welcome and device: both steps offer manual entry, and two
  // copies of this dialog would be two attempt counters.
  const openAddressDialog = () => {
    setNotFoundDismissed(true);
    setAddressDialogOpen(true);
  };
  const addressDialog = (
    <SetupAddressDialog
      onConnect={async (target) => {
        const attempt = (manualAttemptRef.current += 1);
        const abandoned = () => attempt !== manualAttemptRef.current;
        try {
          const candidate = await props.onFindManualTarget(target);
          if (abandoned()) {
            return null;
          }
          // Closed here rather than through onOpenChange: that would clear
          // notFoundDismissed and re-open "We couldn't find your VibeTV" over
          // the connecting screen, because the search state only clears once
          // the connect answers.
          setAddressDialogOpen(false);
          void connect.run(candidate);
          return null;
        } catch (error) {
          if (abandoned()) {
            return null;
          }
          const failure = error as ApiError;
          return (
            [failure?.message, failure?.nextAction].filter(Boolean).join(" ") ||
            null
          );
        }
      }}
      onOpenChange={(open) => {
        setAddressDialogOpen(open);
        if (!open) {
          manualAttemptRef.current += 1;
          setNotFoundDismissed(false);
        }
      }}
      open={addressDialogOpen}
    />
  );

  // Lowest precedence by construction: a step passes it only when it has no
  // failure of its own to report. The incident does not go away meanwhile --
  // it is raised again the moment the step's own dialog is answered. Closing
  // it is the customer's call and holds for this incident; the step stays
  // usable behind it either way.
  const usageDialog =
    props.usageFailure && props.onRepairUsageService ? (
      <SetupUsageDialog
        cause={props.usageFailure}
        onCreateSupportReport={() => void onCreateSupportReport()}
        onOpenChange={(open) => {
          if (!open) {
            props.onDismissUsageFailure?.();
          }
        }}
        onRepair={props.onRepairUsageService}
        open
      />
    ) : null;

  const help = {
    aiFixPrompt: () =>
      aiFixPrompt(connectLogLines(connect.state).map((line) => line.text)),
    onCreateSupportReport,
  };

  if (step === "welcome") {
    return (
      <>
        <SetupWelcomeScreen
          {...help}
          lines={props.welcomeLines}
          onEnterAddressManually={openAddressDialog}
        />
        {addressDialog}
        {addressDialogOpen ? null : usageDialog}
      </>
    );
  }

  if (step === "device") {
    const connecting = connectInFlight;
    return (
      <>
        <SetupDeviceScreen
          {...help}
          candidates={deviceCandidates}
          connecting={connecting}
          connectPhase={connect.state.phase}
          logLines={connectLogLines(connect.state)}
          onConnect={startConnect}
          onEnterAddressManually={openAddressDialog}
          onSearchAgain={searchAgain}
          onSelect={(candidate) => setSelectedTarget(candidate.target)}
          searching={searchingForDevices}
          selectedTarget={preselected}
        />
        {addressDialog}
        <SetupDeviceNotFoundDialog
          onEnterAddressManually={openAddressDialog}
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
            // "Update" means update the Mac App, and only Sparkle can do that.
            // Retrying the firmware install just meets the same refusal, and
            // the automatic update prompt does not reach a customer who is
            // still inside setup.
            onResolve={
              connect.failure.reason === "mac_app_update_required"
                ? props.onUpdateMacApp
                : connect.retry
            }
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
        {/*
          Last. A failed firmware check landing on top of "Finish AI setup on
          this Mac" left a customer with two stacked cards and neither
          answerable. A scan that could not be made is a failure of this step
          too, so its dialog wins the same way.
        */}
        {connect.failure ||
        searchFailed ||
        (props.searchError && !searchErrorDismissed) ||
        addressDialogOpen
          ? null
          : usageDialog}
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
          continuing={providersContinuing}
          onContinue={() => {
            // Not goForward() first: coming back here from the theme step
            // leaves the derived step ahead, so a refusal would carry the
            // customer on to a screen that cannot render it.
            setProvidersContinuing(true);
            void Promise.resolve(props.onProvidersContinue())
              .then((done) => {
                if (done === false) {
                  return;
                }
                // A refusal this screen carries no control for names the step
                // that does. That step is behind the derived one -- the
                // completion the customer is repeating already succeeded once --
                // which is exactly the position the override is for.
                if (typeof done === "string") {
                  setWentBackTo(done);
                  return;
                }
                goForward();
              })
              .finally(() => setProvidersContinuing(false));
          }}
          onToggle={props.onProviderToggle}
          pendingCheckIds={props.pendingCheckIds}
          pendingPreferenceIds={props.pendingPreferenceIds}
          providers={props.providers}
        />
        <SetupProviderStepFailedDialog
          error={props.providerError}
          onOpenChange={(open) => !open && props.onDismissProviderError()}
          onRetry={props.onRetryProviders}
        />
      {props.providerError ? null : usageDialog}
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
            const navigation = navigations.current;
            void Promise.resolve(
              props.onDisplayContinue({
                mode: displayMode,
                providerIds:
                  displayMode === "fixed" && displayProviderId
                    ? [displayProviderId]
                    : props.displayProviders.map((provider) => provider.id),
              }),
            ).then((saved) => {
              // A Back press while the save was running is the customer's
              // later word on where they want to be, and the save landing
              // does not undo it.
              if (saved !== false && navigation === navigations.current) {
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
          saving={props.displaySavePending}
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
