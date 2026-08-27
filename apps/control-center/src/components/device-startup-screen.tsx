"use client";

import {
  Cable,
  CircleAlert,
  Download,
  ExternalLink,
  Monitor,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  normalizedProviderStatus,
  providerRecoveryStatusRows,
  providerSetupHasEngineButNoEnabledProvider,
  providerSetupCodexBarAnswered,
  type ApiError,
  type DeviceCandidate,
  type DeviceSearchState,
  type ProviderSetupInfo,
  type SupportDiagnostics,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";
import { SupportReportActions } from "./support-report-actions";
import {
  DeviceCandidateList,
  WifiSetupInstructions,
} from "./setup-device-components";
import { SetupStatusScreen } from "./setup-status-screen";

type Props = {
  busyAction?: string | null;
  connectionModeChoiceRequired?: boolean;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  deviceTarget?: string;
  lastError?: ApiError | null;
  diagnostics?: SupportDiagnostics | null;
  onCreateSupportReport?: () => void;
  onOpenCodexBar?: () => void;
  onRepairUsageService?: () => void;
  onDeviceTargetChange?: (target: string) => void;
  onManualTarget?: (target: string) => void;
  onConfigureWiFi?: (ssid: string, password: string) => Promise<boolean>;
  onSelectConnectionMode?: (mode: "cable" | "wifi") => Promise<boolean>;
  onPair: () => void;
  onSearch: () => void;
  onSelect: (candidate: DeviceCandidate) => void;
  providerRecovery?: boolean;
  showCodexBarFallback?: boolean;
  providerSetup?: ProviderSetupInfo | null;
  selectingDeviceTarget?: string;
  supportReportBusy?: boolean;
  cableConnectionSupported?: boolean;
  wifiConnectionSupported?: boolean;
  wifiCredentialsRequired?: boolean;
  wifiConnectionInProgress?: boolean;
};

export function DeviceStartupScreen({
  busyAction,
  connectionModeChoiceRequired = false,
  deviceCandidates,
  deviceSearchState,
  deviceTarget = "",
  lastError,
  diagnostics,
  onCreateSupportReport,
  onOpenCodexBar,
  onRepairUsageService,
  onDeviceTargetChange,
  onManualTarget,
  onConfigureWiFi,
  onSelectConnectionMode,
  onPair,
  onSearch,
  onSelect,
  selectingDeviceTarget,
  supportReportBusy = false,
  cableConnectionSupported = true,
  wifiConnectionSupported = true,
  wifiCredentialsRequired = false,
  wifiConnectionInProgress = false,
  providerRecovery = false,
  showCodexBarFallback = false,
  providerSetup,
}: Props) {
  const [connectionModeChoice, setConnectionModeChoice] = useState<
    "cable" | "wifi" | null
  >(null);
  const [wifiName, setWifiName] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiValidationError, setWifiValidationError] = useState("");
  const selecting = busyAction === "select";
  const manualConnecting = busyAction === "manual-target";
  const reconnecting = busyAction === "repair";
  const searching =
    deviceSearchState === "searching" || busyAction === "search";
  const waiting = deviceSearchState === "waiting";
  const everyProviderSwitchedOff =
    providerSetupHasEngineButNoEnabledProvider(providerSetup);
  // Not "CodexBar listed something": CodexBar is there at all. A ready engine
  // is the Companion's proof of that, and it is what decides Open vs Download.
  const codexBarInstalled = providerSetupCodexBarAnswered(providerSetup);
  const providerRecoveryView = providerRecovery
    ? describeProviderRecovery(
        providerSetup,
        busyAction,
        lastError,
        showCodexBarFallback,
        everyProviderSwitchedOff,
        codexBarInstalled,
      )
    : null;
  // The customer's tools, by name and real state: which provider is failing
  // with what, and which is merely switched off (issue #405). Earned the same
  // way as the CodexBar choice -- the first automatic attempt stays a plain
  // "Try again" without internals. The all-off view already says everything is
  // off, and a checking view has no answer yet.
  const providerStatusRows =
    providerRecoveryView &&
    !providerRecoveryView.checking &&
    showCodexBarFallback &&
    !everyProviderSwitchedOff
      ? providerRecoveryStatusRows(providerSetup)
      : [];
  // A running request may disable the way out. A calm view may not: the
  // "ready but no picture yet" state reports checking with nothing actually in
  // flight, and disabling the button there rebuilt the dead end this screen
  // exists to remove.
  const providerRecoveryActionBusy =
    busyAction === "providers-retry" || busyAction === "usage-service-repair";
  const providerRecoveryBusy = Boolean(
    providerRecoveryView?.checking || providerRecoveryActionBusy,
  );
  // A checking view has no answer to act on yet, so the CodexBar choice is not
  // offered with it. The title and the buttons are decided in two places, and
  // without this the download rendered underneath "Starting AI usage".
  const offerCodexBarChoice =
    showCodexBarFallback && !providerRecoveryView?.checking;
  const choosing =
    deviceSearchState === "multiple" && deviceCandidates.length > 0;
  const legacyRecovery =
    lastError?.code === "legacy_pairing_recovery_required";
  const connectionAttention = isConnectionAttentionError(lastError);
  const wifiSetupNeeded =
    deviceSearchState === "not-found" &&
    !manualConnecting &&
    !selecting &&
    !connectionAttention;
  const repairFailed = deviceSearchState === "repair-failed";
  const searchFailed = deviceSearchState === "failed";
  const manualEntryAvailable =
    !providerRecoveryView &&
    (searching || choosing || wifiSetupNeeded || searchFailed || repairFailed) &&
    !legacyRecovery;
  const choosingConnectionMode =
    connectionModeChoiceRequired &&
    connectionModeChoice === null &&
    !wifiCredentialsRequired &&
    !wifiConnectionInProgress;
  const wifiConnectionModeSelected =
    wifiCredentialsRequired ||
    wifiConnectionInProgress ||
    (connectionModeChoiceRequired && connectionModeChoice === "wifi");
  const connectionModeBusy = busyAction === "connection-mode";
  const wifiCredentialsBusy = busyAction === "wifi-credentials";

  async function selectConnectionMode(mode: "cable" | "wifi") {
    if (await onSelectConnectionMode?.(mode)) {
      setConnectionModeChoice(mode);
    }
  }

  async function submitWiFiCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ssid = wifiName.trim();
    if (!ssid) {
      setWifiValidationError("Enter your WiFi name.");
      return;
    }
    setWifiValidationError("");
    if (await onConfigureWiFi?.(ssid, wifiPassword)) {
      setWifiPassword("");
    }
  }

  let title = "Set up your VibeTV";
  let detail = "Choose a VibeTV on your WiFi.";

  if (choosingConnectionMode) {
    title = wifiConnectionSupported
      ? "Choose how VibeTV connects"
      : "Connect VibeTV";
    detail = wifiConnectionSupported
      ? "Choose the connection that fits your setup."
      : "This VibeTV connects to this Mac by Cable.";
  } else if (wifiConnectionModeSelected && deviceSearchState === "idle") {
    title = "Connect VibeTV to WiFi";
    detail = wifiCredentialsRequired
      ? "Enter the same WiFi details this Mac uses."
      : "VibeTV is connecting. Scan again when it shows WiFi connected.";
  } else if (providerRecoveryView) {
    title = providerRecoveryView.title;
    detail = providerRecoveryView.detail;
  } else if (searching) {
    title = "Looking for your VibeTV";
    detail = "Searching your WiFi for a VibeTV.";
  } else if (selecting || manualConnecting) {
    title = "Connecting to VibeTV";
    detail = "Connecting to the selected VibeTV.";
  } else if (reconnecting) {
    title = "Reconnecting to your VibeTV";
    detail = "Connecting to your saved VibeTV.";
  } else if (waiting) {
    title = "Connecting to VibeTV";
    detail = "VibeTV was found. Waiting for the first live preview.";
  } else if (legacyRecovery) {
    title = "Reconnect this VibeTV";
    detail = "Follow these steps, then connect VibeTV again.";
  } else if (choosing) {
    title = "Choose a VibeTV";
    detail = "Choose the VibeTV you want to connect.";
  } else if (connectionAttention) {
    title = "Reconnect this VibeTV";
    detail = "VibeTV is reachable. Press Connect to reconnect it.";
  } else if (wifiSetupNeeded) {
    title = "We couldn't find your VibeTV";
    detail =
      "Connect VibeTV to WiFi, scan again, or enter the address shown on its screen.";
  } else if (repairFailed) {
    title = "VibeTV could not connect";
    detail = "The VibeTV was found, but the connection could not be completed.";
  } else if (searchFailed) {
    title = "VibeTV search could not finish";
    detail = "Check the Mac App and your WiFi, then search again.";
  }

  const statusLabel = connectionModeBusy
    ? "Changing connection…"
    : wifiCredentialsBusy
      ? "Saving WiFi details…"
      : providerRecoveryView?.checking
        ? "Checking AI setup…"
        : providerRecoveryView
          ? undefined
          : reconnecting
            ? "Reconnecting…"
            : waiting
              ? "Waiting for live preview…"
              : searching
                ? "Searching…"
                : undefined;

  const visual = choosingConnectionMode ? (
    <Cable aria-hidden />
  ) : wifiConnectionModeSelected && deviceSearchState === "idle" ? (
    <Wifi aria-hidden />
  ) : providerRecoveryView && !providerRecoveryView.checking ? (
    <CircleAlert aria-hidden />
  ) : choosing ? (
    <Monitor aria-hidden />
  ) : wifiSetupNeeded ? (
    <Wifi aria-hidden />
  ) : searchFailed ? (
    <WifiOff aria-hidden />
  ) : repairFailed || connectionAttention ? (
    <CircleAlert aria-hidden />
  ) : undefined;

  // Never leave recovery without a way out. The busy states used to render a
  // spinner and nothing else, so a provider that reported ready while the
  // device still had no picture became a dead end.
  const actions = providerRecoveryView ? (
    <div className="grid gap-3">
      <Button
        className="w-full"
        disabled={providerRecoveryActionBusy}
        onClick={onRepairUsageService}
        size="lg"
      >
        <RefreshCw data-icon="inline-start" aria-hidden />
        <span>Try again</span>
      </Button>
      {offerCodexBarChoice && codexBarInstalled ? (
        // CodexBar answered, so it is installed: whatever is still missing --
        // a switch, a sign-in, a macOS permission -- is settled inside it, and
        // the download page fixes none of those. The recovery screen has no
        // sidebar either, so Usage is out of reach from here.
        // Stopgap until #245 moves provider selection into setup and settings.
        <Button
          className="w-full"
          onClick={onOpenCodexBar}
          size="lg"
          variant="outline"
        >
          <ExternalLink data-icon="inline-start" aria-hidden />
          <span>Open CodexBar</span>
        </Button>
      ) : offerCodexBarChoice ? (
        <Button asChild className="w-full" size="lg" variant="outline">
          <a href="https://github.com/steipete/CodexBar/releases/latest">
            <Download data-icon="inline-start" aria-hidden />
            <span>Download CodexBar</span>
          </a>
        </Button>
      ) : null}
    </div>
  ) : legacyRecovery ? null : choosing ? (
    <StartupActions
      busy={Boolean(busyAction)}
      onSearch={onSearch}
      searchVariant="outline"
    />
  ) : searchFailed || repairFailed || connectionAttention ? (
    <StartupActions
      busy={Boolean(busyAction)}
      onSearch={connectionAttention ? onPair : onSearch}
      searchLabel={connectionAttention ? "Connect" : "Search again"}
    />
  ) : null;

  const manualEntryPrompt =
    searching || choosing
      ? "Or enter the IP address shown on your VibeTV screen:"
      : wifiSetupNeeded
        ? "Or enter the IP address shown on your VibeTV screen:"
        : "Enter the IP address shown on your VibeTV screen:";

  const manualTargetForm = manualEntryAvailable ? (
    <div className="grid gap-3">
      <p className="text-sm font-medium text-muted-foreground">
        {manualEntryPrompt}
      </p>
      <DeviceTargetForm
        busy={manualConnecting}
        buttonLabel="Connect"
        disabled={
          Boolean(busyAction) && busyAction !== "search" && !manualConnecting
        }
        id="startup-device-target"
        lastError={lastError}
        minimal
        onChange={onDeviceTargetChange}
        onSubmit={onManualTarget}
        searchingLabel="Connecting"
        value={deviceTarget}
      />
    </div>
  ) : null;

  return (
    <SetupStatusScreen
      actions={actions}
      busy={
        searching ||
        selecting ||
        manualConnecting ||
        reconnecting ||
        (waiting && !providerRecoveryView) ||
        connectionModeBusy ||
        wifiCredentialsBusy ||
        providerRecoveryBusy
      }
      description={detail}
      footer={
        <SupportReportActions
          align="center"
          creating={supportReportBusy}
          diagnostics={diagnostics}
          emphasis="secondary"
          onCreate={onCreateSupportReport}
          createLabel={
            providerRecoveryView
              ? "Create support report"
              : "Create report"
          }
        />
      }
      statusLabel={statusLabel}
      testId="device-startup-screen"
      title={title}
      visual={visual}
    >
      <div className="grid gap-5">
        {choosingConnectionMode ? (
          <div
            className={`grid gap-3 ${cableConnectionSupported && wifiConnectionSupported ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {cableConnectionSupported ? (
              <Button
                className="h-auto min-h-44 w-full flex-col items-start justify-between gap-5 whitespace-normal p-5 text-left"
                disabled={Boolean(busyAction)}
                onClick={() => void selectConnectionMode("cable")}
                size="lg"
                variant="outline"
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                    <Cable className="size-9" aria-hidden />
                  </span>
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
                    Recommended
                  </span>
                </span>
                <span className="grid gap-1.5">
                  <span className="text-lg font-black">Use Cable</span>
                  <span className="text-sm font-medium leading-5 text-muted-foreground">
                    Most reliable connection
                  </span>
                </span>
              </Button>
            ) : null}
            {wifiConnectionSupported ? (
              <Button
                className="h-auto min-h-44 w-full flex-col items-start justify-between gap-5 whitespace-normal p-5 text-left"
                disabled={Boolean(busyAction)}
                onClick={() => void selectConnectionMode("wifi")}
                size="lg"
                variant="outline"
              >
                <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
                  <Wifi className="size-9" aria-hidden />
                </span>
                <span className="grid gap-1.5">
                  <span className="text-lg font-black">Use WiFi</span>
                  <span className="text-sm font-medium leading-5 text-muted-foreground">
                    No data Cable to this Mac
                  </span>
                </span>
              </Button>
            ) : null}
          </div>
        ) : null}

        {wifiConnectionModeSelected &&
        wifiCredentialsRequired &&
        deviceSearchState === "idle" ? (
          <form className="grid gap-4 text-left" onSubmit={submitWiFiCredentials}>
            <FieldGroup className="grid gap-4">
              <Field data-invalid={Boolean(wifiValidationError)}>
                <FieldLabel htmlFor="startup-wifi-name">WiFi name</FieldLabel>
                <Input
                  autoComplete="off"
                  disabled={wifiCredentialsBusy}
                  id="startup-wifi-name"
                  onChange={(event) => {
                    setWifiName(event.target.value);
                    setWifiValidationError("");
                  }}
                  placeholder="Home WiFi"
                  value={wifiName}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="startup-wifi-password">
                  WiFi code
                </FieldLabel>
                <Input
                  autoComplete="off"
                  disabled={wifiCredentialsBusy}
                  id="startup-wifi-password"
                  onChange={(event) => setWifiPassword(event.target.value)}
                  type="password"
                  value={wifiPassword}
                />
              </Field>
            </FieldGroup>
            {wifiValidationError ? (
              <p className="text-sm font-medium text-destructive" role="alert">
                {wifiValidationError}
              </p>
            ) : null}
            <Button disabled={wifiCredentialsBusy} size="lg" type="submit">
              <span>{wifiCredentialsBusy ? "Saving…" : "Connect to WiFi"}</span>
            </Button>
          </form>
        ) : null}

        {wifiConnectionModeSelected &&
        !wifiCredentialsRequired &&
        deviceSearchState === "idle" ? (
          <>
            <Alert>
              <Wifi aria-hidden />
              <AlertTitle>VibeTV is connecting</AlertTitle>
              <AlertDescription>
                Keep VibeTV powered on. Continue when its screen says WiFi is
                connected.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={onSearch} size="lg">
              <RefreshCw data-icon="inline-start" aria-hidden />
              <span>Scan WiFi again</span>
            </Button>
          </>
        ) : null}

        {providerStatusRows.length > 0 ? (
          <ul
            className="grid gap-1.5 text-left text-sm text-muted-foreground"
            data-testid="provider-recovery-status-list"
          >
            {providerStatusRows.map((row) => (
              <li key={row.id}>
                <span className="font-medium text-foreground">{row.label}</span>
                {" — "}
                {row.text}
              </li>
            ))}
          </ul>
        ) : null}

        {!providerRecoveryView && choosing ? (
          <DeviceCandidateList
            busy={Boolean(busyAction) && !selecting}
            candidates={deviceCandidates}
            onSelect={onSelect}
            selectingTarget={selectingDeviceTarget}
          />
        ) : null}

        {!providerRecoveryView && wifiSetupNeeded ? (
          <>
            <WifiSetupInstructions />
            <Button className="w-full" onClick={onSearch} size="lg">
              <RefreshCw data-icon="inline-start" aria-hidden />
              <span>Scan WiFi again</span>
            </Button>
          </>
        ) : null}

        {!providerRecoveryView && legacyRecovery && !searching ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>Reconnect this VibeTV</AlertTitle>
            <AlertDescription>
              <ol className="grid list-decimal gap-2 pl-5">
                <li>
                  Unplug VibeTV and plug it back in three times. After the third
                  start, leave it powered on.
                </li>
                <li>
                  When VibeTV shows VibeTV-Setup, use your phone to connect it
                  to your home WiFi again.
                </li>
                <li>
                  Return to this app. When VibeTV appears, click Connect within
                  30 minutes.
                </li>
              </ol>
            </AlertDescription>
          </Alert>
        ) : lastError && !searching ? (
          <Alert variant={connectionAttention ? "destructive" : "default"}>
            <CircleAlert aria-hidden />
            <AlertTitle>{lastError.message}</AlertTitle>
            <AlertDescription>
              {startupErrorNextAction(lastError, repairFailed)}
            </AlertDescription>
          </Alert>
        ) : null}

        {manualTargetForm}
      </div>
    </SetupStatusScreen>
  );
}

function describeProviderRecovery(
  providerSetup: ProviderSetupInfo | null | undefined,
  busyAction: string | null | undefined,
  lastError: ApiError | null | undefined,
  showCodexBarFallback: boolean,
  everyProviderSwitchedOff: boolean,
  codexBarInstalled: boolean,
) {
  const setupStatus = normalizedProviderStatus(providerSetup?.status);
  // A retry the customer just pressed outranks the error from the attempt
  // before it. That error describes something already finished, and leaving it
  // on screen while the new attempt runs left nothing but a greyed-out button:
  // no way to tell whether anything was happening. Reported from the bench on
  // 2026-08-21, in exactly that state.
  const retryInFlight =
    busyAction === "providers-retry" || busyAction === "usage-service-repair";
  // "checking" is the Companion saying it is re-probing right now, not an
  // answer about this Mac -- providerSetupRequiresRecovery reads it the same
  // way. It arrives with no engine and no providers, so letting it reach the
  // branches below made every one of them read "CodexBar is missing" and
  // offered a download to a Mac that has it, flipping back on the next poll.
  // It outranks a stale lastError for the same reason a fresh retry does: that
  // error describes an attempt that is already over.
  if (
    retryInFlight ||
    setupStatus === "checking" ||
    (!lastError && !providerSetup)
  ) {
    return {
      checking: true,
      detail: "VibeTV is starting its built-in usage service and checking this Mac.",
      title: "Starting AI usage",
    };
  }

  if (showCodexBarFallback && everyProviderSwitchedOff) {
    return {
      checking: false,
      detail:
        "CodexBar is installed, but every AI provider in it is switched off. Open CodexBar, switch one on, then try again.",
      title: "No AI provider is switched on",
    };
  }

  if (showCodexBarFallback && codexBarInstalled) {
    return {
      checking: false,
      detail:
        "CodexBar is installed, but it still cannot read your AI usage. Open CodexBar, finish what it asks for, then try again.",
      title: "Finish AI setup in CodexBar",
    };
  }

  if (showCodexBarFallback) {
    return {
      checking: false,
      detail:
        "VibeTV needs CodexBar to read AI usage, but could not complete the setup here. Download and open CodexBar, then try again.",
      title: "CodexBar is needed",
    };
  }

  if (setupStatus === "ready") {
    return {
      checking: true,
      detail: "AI usage is ready. VibeTV is loading the first live image.",
      title: "Starting your VibeTV display",
    };
  }

  return {
    checking: false,
    detail:
      "VibeTV could not read AI usage on this Mac. Try again. If it still fails, create a support report.",
    title: "AI usage could not start",
  };
}

function StartupActions({
  busy,
  onSearch,
  searchLabel = "Search again",
  searchVariant = "default",
}: {
  busy: boolean;
  onSearch: () => void;
  searchLabel?: string;
  searchVariant?: "default" | "outline";
}) {
  return (
    <div className="grid gap-3">
      <Button
        className="w-full"
        disabled={busy}
        onClick={onSearch}
        size="lg"
        variant={searchVariant}
      >
        <RefreshCw data-icon="inline-start" aria-hidden />
        <span>{searchLabel}</span>
      </Button>
    </div>
  );
}

function startupErrorNextAction(error: ApiError, repairFailed: boolean) {
  if (isConnectionAttentionError(error)) {
    return error.nextAction || "Press Connect again.";
  }
  if (
    repairFailed &&
    (error.code === "pair_failed" || error.code === "connect_failed")
  ) {
    return "Keep VibeTV powered on, then search again.";
  }
  return error.nextAction;
}

function isConnectionAttentionError(error?: ApiError | null) {
  return (
    error?.code === "legacy_pairing_recovery_required" ||
    error?.code === "connect_failed" ||
    error?.code === "connect_temporarily_unavailable" ||
    error?.code === "pairing_token_rejected" ||
    error?.code === "pairing_window_closed" ||
    error?.code === "pairing_rate_limited"
  );
}
