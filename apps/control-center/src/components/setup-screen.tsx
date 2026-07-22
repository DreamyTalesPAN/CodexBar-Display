"use client";

import {
  BarChart3,
  Check,
  CircleHelp,
  Clipboard,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useMemo, useState, type ReactNode } from "react";
import {
  availableMacAppDmgDownloadUrl,
  type CompanionReleaseInfo,
} from "@/lib/companion-release";
import type {
  ApiError,
  CompanionStatus,
  DeviceCandidate,
  DeviceSearchState,
  DeviceState,
  DeviceInfo,
  ProviderSetupInfo,
  SupportDiagnostics,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";
import { ControlCenterStatusIcon } from "./control-center-status-icon";
import { ProviderSetupCard, providerSetupIsReady } from "./provider-setup-card";
import { SupportReportActions } from "./support-report-actions";
import {
  DeviceCandidateList,
  WifiSetupInstructions,
} from "./setup-device-components";

type SetupScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  deviceCandidates?: DeviceCandidate[];
  deviceSearchState?: DeviceSearchState;
  deviceState: DeviceState;
  device: DeviceInfo | null;
  deviceTarget: string;
  lastError?: ApiError | null;
  onCheckCompanion?: () => void | Promise<void>;
  onCheckUpdates?: () => void | Promise<void>;
  onDeviceTargetChange?: (target: string) => void;
  onSearchDevices?: () => void;
  onSelectDevice?: (candidate: DeviceCandidate) => void;
  onDeclineDevice?: () => void;
  onRepairConnection?: (targetOverride?: string) => void;
  onResetSetup?: () => void;
  onOpenCodexBar?: () => void;
  onRepairCodexBar?: () => void;
  onRetryProviders?: () => void;
  hostedMode?: boolean;
  macAppRelease?: CompanionReleaseInfo | null;
  previewStep?: "mac-app" | null;
  providerSetup?: ProviderSetupInfo | null;
  diagnostics?: SupportDiagnostics | null;
  onCreateSupportReport?: () => void;
  requiresMacAppMigration?: boolean;
  showIntro?: boolean;
  setupComplete: boolean;
};

type StepId = "wifi" | "mac-app" | "finish" | "provider";
type StepState = "active" | "blocked" | "complete" | "pending";

export function SetupScreen({
  busyAction,
  companionStatus,
  deviceCandidates = [],
  deviceSearchState = "idle",
  deviceState,
  device,
  deviceTarget,
  lastError,
  onCheckCompanion,
  onCheckUpdates,
  onDeviceTargetChange,
  onSearchDevices,
  onSelectDevice,
  onDeclineDevice,
  onRepairConnection,
  onResetSetup,
  onOpenCodexBar,
  onRepairCodexBar,
  onRetryProviders,
  hostedMode = false,
  macAppRelease = null,
  previewStep,
  providerSetup,
  diagnostics,
  onCreateSupportReport,
  requiresMacAppMigration = false,
  showIntro = true,
  setupComplete,
}: SetupScreenProps) {
  const [wifiConfirmedState, setWifiConfirmedState] = useState(false);
  const [dmgDownloadStarted, setDmgDownloadStarted] = useState(false);
  const [macAppConfirmedState, setMacAppConfirmedState] = useState(false);
  const macAppMissing = isCompanionMissingError(lastError);
  const macAppReady = companionStatus === "online";
  const macAppCheckFailed = macAppMissing && macAppConfirmedState;
  const forceMacAppStep = previewStep === "mac-app";
  const macAppConfirmed =
    !forceMacAppStep &&
    !macAppMissing &&
    (macAppConfirmedState || macAppReady || setupComplete);
  const deviceSelectionInProgress = deviceSearchState !== "idle";
  const deviceConnectionComplete = Boolean(
    setupComplete ||
    (device?.connected &&
      device.paired &&
      device.connectionState !== "reconnecting"),
  );
  const providerPending = Boolean(
    providerSetup && !providerSetupIsReady(providerSetup),
  );
  const wifiConfirmed =
    wifiConfirmedState ||
    deviceSelectionInProgress ||
    (providerPending && deviceConnectionComplete) ||
    setupComplete ||
    previewStep === "mac-app" ||
    hostedMode;
  const dmgUrl = availableMacAppDmgDownloadUrl(macAppRelease);
  const macAppReleaseCheckFailed = Boolean(
    macAppRelease?.status === "check_failed" ||
    macAppRelease?.dmgDownloadStatus === "check_failed",
  );
  const macAppStepTitle = hostedMode
    ? dmgUrl
      ? "Download Mac App"
      : "Mac App download not ready"
    : dmgUrl
      ? "Update available"
      : "Update not ready";
  const showControlCenterLauncher =
    !hostedMode && showIntro && !previewStep && !lastError && setupComplete;
  const migrationNotice = requiresMacAppMigration ? (
    <LegacyMacAppMigrationNotice
      checkFailed={macAppReleaseCheckFailed}
      checking={busyAction === "firmware-check"}
      downloadUrl={dmgUrl}
      onRetry={() => void onCheckUpdates?.()}
    />
  ) : null;

  const activeStep = useMemo(
    () =>
      hostedMode
        ? "mac-app"
        : previewStep ||
          (!wifiConfirmed
            ? "wifi"
            : deviceConnectionComplete && providerPending
              ? "provider"
              : "finish"),
    [
      hostedMode,
      previewStep,
      deviceConnectionComplete,
      providerPending,
      wifiConfirmed,
    ],
  );
  const stepStates = useMemo(
    () =>
      buildStepStates({
        activeStep,
        forceMacAppStep,
        macAppConfirmed,
        macAppReady,
        deviceConnectionComplete,
        providerReady: providerSetupIsReady(providerSetup),
        providerVisible: Boolean(providerSetup),
        setupComplete,
        wifiConfirmed,
      }),
    [
      activeStep,
      forceMacAppStep,
      macAppConfirmed,
      macAppReady,
      deviceConnectionComplete,
      providerSetup,
      setupComplete,
      wifiConfirmed,
    ],
  );

  function confirmWifi() {
    setWifiConfirmedState(true);
    onSearchDevices?.();
  }

  function confirmMacApp() {
    setMacAppConfirmedState(true);
    runCheckCompanion();
  }

  function runCheckCompanion() {
    void Promise.resolve(onCheckCompanion?.()).catch(() => undefined);
  }

  function retryConnect(targetOverride?: string) {
    onRepairConnection?.(targetOverride);
  }

  if (showControlCenterLauncher) {
    return (
      <div className="mx-auto max-w-[980px]">
        {migrationNotice}
        <SetupIntro
          busyAction={busyAction}
          hostedMode={hostedMode}
          onResetSetup={onResetSetup}
          setupComplete
        />
        <div className="py-6">
          <SupportReportActions
            busyAction={busyAction}
            diagnostics={diagnostics}
            onCreate={onCreateSupportReport}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[980px]">
      {migrationNotice}
      {showIntro ? (
        <SetupIntro
          busyAction={busyAction}
          error={lastError && !macAppMissing ? lastError : null}
          hostedMode={hostedMode}
          onResetSetup={onResetSetup}
          setupComplete={setupComplete}
        />
      ) : null}

      {!showIntro && lastError && !macAppMissing ? (
        <div className="pt-5">
          <ErrorNote error={lastError} />
        </div>
      ) : null}

      <section className="py-6">
        <ol className="grid gap-0">
          {!hostedMode && !forceMacAppStep ? (
            <SetupStep
              icon={<Wifi size={22} aria-hidden />}
              index={1}
              state={stepStates.wifi}
              title="Connect VibeTV to WiFi"
            >
              {activeStep === "wifi" ? (
                <div className="grid gap-5">
                  <WifiSetupInstructions />
                  <Button className="w-full" onClick={confirmWifi} size="lg" type="button">
                    <RefreshCw data-icon="inline-start" aria-hidden />
                    <span>Scan WiFi again</span>
                  </Button>
                </div>
              ) : null}
            </SetupStep>
          ) : null}

          {hostedMode || forceMacAppStep ? (
            <SetupStep
              icon={<Download size={22} aria-hidden />}
              index={1}
              state={stepStates["mac-app"]}
              title={macAppStepTitle}
            >
              {activeStep === "mac-app" ? (
                <div className="grid min-w-0 gap-4">
                  {dmgUrl ? (
                    <div className="grid gap-3 border border-border bg-card p-4">
                      <Button asChild className="w-full" size="lg">
                        <a href={dmgUrl} onClick={() => setDmgDownloadStarted(true)}>
                        <Download data-icon="inline-start" />
                        <span>
                          {hostedMode ? "Download Mac App" : "Update"}
                        </span>
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 border border-border bg-card p-4">
                      <p className="text-sm leading-6 text-[#444933]">
                        The signed Mac App download is not ready yet. Please try
                        again later.
                      </p>
                      <Button className="w-full" disabled size="lg" type="button">
                        <Download data-icon="inline-start" aria-hidden />
                        <span>
                          {hostedMode
                            ? "Mac App download not ready"
                            : "New Mac App not ready"}
                        </span>
                      </Button>
                    </div>
                  )}

                  {macAppCheckFailed ? (
                    <StatusNote icon={<RefreshCw size={16} aria-hidden />}>
                      Mac App did not answer. Make sure VibeTV Control Center is
                      in Applications and open, then try again.
                    </StatusNote>
                  ) : null}

                  {!hostedMode && dmgUrl ? (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        className="w-full"
                        disabled={!dmgDownloadStarted || busyAction === "status"}
                        onClick={confirmMacApp}
                        size="lg"
                        type="button"
                      >
                        {busyAction === "status" ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Check data-icon="inline-start" aria-hidden />
                        )}
                        <span>
                          {busyAction === "status" ? "Checking" : "Mac App is installed"}
                        </span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </SetupStep>
          ) : null}

          {!hostedMode && !forceMacAppStep ? (
            <SetupStep
              icon={<Monitor size={22} aria-hidden />}
              index={2}
              state={stepStates.finish}
              title="Verify VibeTV connection"
            >
              {activeStep === "finish" ? (
                <FinishSetupContent
                  busyAction={busyAction}
                  deviceCandidates={deviceCandidates}
                  deviceSearchState={deviceSearchState}
                  deviceState={deviceState}
                  deviceTarget={deviceTarget}
                  lastError={lastError}
                  onDeviceTargetChange={onDeviceTargetChange}
                  onSearchDevices={onSearchDevices}
                  onSelectDevice={onSelectDevice}
                  onDeclineDevice={onDeclineDevice}
                  onRepairConnection={retryConnect}
                  setupComplete={setupComplete}
                />
              ) : null}
            </SetupStep>
          ) : null}

          {!hostedMode && !forceMacAppStep && providerSetup ? (
            <SetupStep
              icon={<BarChart3 size={22} aria-hidden />}
              index={3}
              state={stepStates.provider}
              title="Connect an AI provider"
            >
              {activeStep === "provider" ? (
                <ProviderSetupCard
                  busyAction={busyAction}
                  onOpenCodexBar={onOpenCodexBar}
                  onRepairCodexBar={onRepairCodexBar}
                  onRetry={onRetryProviders}
                  providerSetup={providerSetup}
                />
              ) : null}
            </SetupStep>
          ) : null}
        </ol>

        <div className="border-t border-[#747A60] py-6">
          <SupportReportActions
            busyAction={busyAction}
            diagnostics={diagnostics}
            onCreate={onCreateSupportReport}
          />
        </div>
      </section>
    </div>
  );
}

function SetupIntro({
  busyAction,
  error,
  hostedMode,
  onResetSetup,
  setupComplete,
}: {
  busyAction?: string | null;
  error?: ApiError | null;
  hostedMode: boolean;
  onResetSetup?: () => void;
  setupComplete: boolean;
}) {
  return (
    <section className="py-8 lg:min-h-[330px] lg:py-12">
      <div className="flex items-start gap-5">
        <ControlCenterStatusIcon
          variant={setupComplete ? "complete" : "neutral"}
        >
          {setupComplete ? (
            <Check size={38} aria-hidden />
          ) : (
            <Clipboard size={34} aria-hidden />
          )}
        </ControlCenterStatusIcon>
        <div className="min-w-0">
          <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
            {setupComplete
              ? "Setup complete"
              : hostedMode
                ? "Get the VibeTV Mac App"
                : "Set up your VibeTV"}
          </h2>
          {setupComplete ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                disabled={busyAction === "reset-setup"}
                onClick={onResetSetup}
                size="lg"
                type="button"
                variant="outline"
              >
                {busyAction === "reset-setup" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Clipboard data-icon="inline-start" aria-hidden />
                )}
                <span>
                  {busyAction === "reset-setup" ? "Resetting" : "Run setup again"}
                </span>
              </Button>
            </div>
          ) : null}
          {error ? <ErrorNote error={error} /> : null}
        </div>
      </div>
    </section>
  );
}

function LegacyMacAppMigrationNotice({
  checkFailed,
  checking,
  downloadUrl,
  onRetry,
}: {
  checkFailed: boolean;
  checking: boolean;
  downloadUrl?: string;
  onRetry: () => void;
}) {
  return (
    <section className="py-6">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-4">
          <ControlCenterStatusIcon size="step" variant="active">
            <Download size={22} aria-hidden />
          </ControlCenterStatusIcon>
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-[#1B1B1B]">
              {downloadUrl ? "Update available" : "Update not ready"}
            </h2>
          </div>
        </div>
        {downloadUrl ? (
          <Button asChild className="w-full sm:w-auto" size="lg">
            <a href={downloadUrl}><Download data-icon="inline-start" /><span>Update</span></a>
          </Button>
        ) : checkFailed ? (
          <Button
            className="w-full"
            disabled={checking}
            onClick={onRetry}
            size="lg"
            type="button"
          >
            {checking ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" aria-hidden />
            )}
            <span>{checking ? "Checking" : "Check again"}</span>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function FinishSetupContent({
  busyAction,
  deviceCandidates,
  deviceSearchState,
  deviceState,
  deviceTarget,
  lastError,
  onDeviceTargetChange,
  onSearchDevices,
  onSelectDevice,
  onDeclineDevice,
  onRepairConnection,
  setupComplete,
}: {
  busyAction?: string | null;
  deviceCandidates: DeviceCandidate[];
  deviceSearchState: DeviceSearchState;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onDeviceTargetChange?: (target: string) => void;
  onSearchDevices?: () => void;
  onSelectDevice?: (candidate: DeviceCandidate) => void;
  onDeclineDevice?: () => void;
  onRepairConnection?: (targetOverride?: string) => void;
  setupComplete: boolean;
}) {
  if (setupComplete) {
    return <StatusNote>VibeTV is ready.</StatusNote>;
  }

  if (deviceSearchState === "searching" || busyAction === "search") {
    return (
      <div className="grid gap-4">
        <StatusNote
          icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
        >
          Searching for VibeTVs on your WiFi...
        </StatusNote>
        <ManualDeviceTargetOption
          busyAction={busyAction}
          deviceTarget={deviceTarget}
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
        />
      </div>
    );
  }

  if (deviceSearchState === "multiple") {
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <h4 className="text-xl font-black text-[#1B1B1B]">Choose a VibeTV</h4>
          <p className="text-sm leading-6 text-[#444933]">
            More than one VibeTV was found. Choose the one you want to connect.
          </p>
        </div>
        <DeviceCandidateList
          busy={Boolean(busyAction) && busyAction !== "select"}
          buttonVariant="outline"
          candidates={deviceCandidates}
          onSelect={(candidate) => onSelectDevice?.(candidate)}
          selecting={busyAction === "select"}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="w-full"
            disabled={Boolean(busyAction)}
            onClick={onDeclineDevice}
            size="lg"
            type="button"
            variant="outline"
          >
            Not now
          </Button>
          <Button
            className="w-full"
            disabled={Boolean(busyAction)}
            onClick={onSearchDevices}
            size="lg"
            type="button"
            variant="outline"
          >
            <RefreshCw data-icon="inline-start" aria-hidden />
            <span>Search again</span>
          </Button>
        </div>
        <ManualDeviceTargetOption
          busyAction={busyAction}
          deviceTarget={deviceTarget}
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
        />
      </div>
    );
  }

  if (deviceSearchState === "not-found") {
    return (
      <div className="grid gap-5">
        <p className="text-sm font-semibold leading-6 text-[#444933]">
          We couldn&apos;t find your VibeTV. Enter the IP address shown on your
          VibeTV screen:
        </p>
        <DeviceTargetForm
          busy={busyAction === "manual-target" || busyAction === "select"}
          buttonLabel="Connect VibeTV"
          className="grid gap-4"
          disabled={
            Boolean(busyAction) &&
            busyAction !== "search" &&
            busyAction !== "manual-target" &&
            busyAction !== "select"
          }
          id="setup-device-target"
          lastError={lastError}
          minimal
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
          searchingLabel="Connecting"
          value={deviceTarget}
        />
      </div>
    );
  }

  if (deviceSearchState === "failed") {
    return (
      <div className="grid gap-4">
        <ManualDeviceTargetOption
          busyAction={busyAction}
          deviceTarget={deviceTarget}
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
          prompt="We couldn't find your VibeTV. Enter the IP address shown on your VibeTV screen:"
        />
        <Button className="w-full" onClick={onSearchDevices} size="lg" type="button">
          <RefreshCw data-icon="inline-start" aria-hidden />
          <span>Try again</span>
        </Button>
      </div>
    );
  }

  if (deviceSearchState === "repair-failed") {
    return (
      <div className="grid gap-4">
        <ManualDeviceTargetOption
          busyAction={busyAction}
          deviceTarget={deviceTarget}
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
          prompt="We couldn't reconnect your VibeTV. Enter the IP address shown on your VibeTV screen:"
        />
        <Button className="w-full" onClick={onSearchDevices} size="lg" type="button">
          <RefreshCw data-icon="inline-start" aria-hidden />
          <span>Try again</span>
        </Button>
      </div>
    );
  }

  if (
    busyAction === "connect" ||
    busyAction === "discover" ||
    busyAction === "repair" ||
    busyAction === "select"
  ) {
    return (
      <StatusNote
        icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
      >
        Reconnecting VibeTV...
      </StatusNote>
    );
  }

  return (
    <div className="grid gap-4">
      <StatusNote>
        {deviceState === "offline"
          ? "VibeTV is offline. Run setup again to search for it."
          : "Waiting for automatic VibeTV search."}
      </StatusNote>
      <ManualDeviceTargetOption
        busyAction={busyAction}
        deviceTarget={deviceTarget}
        lastError={lastError}
        onChange={onDeviceTargetChange}
        onSubmit={onRepairConnection}
      />
    </div>
  );
}

function ManualDeviceTargetOption({
  busyAction,
  deviceTarget,
  lastError,
  onChange,
  onSubmit,
  prompt = "Or enter the IP address shown on your VibeTV screen:",
}: {
  busyAction?: string | null;
  deviceTarget: string;
  lastError?: ApiError | null;
  onChange?: (target: string) => void;
  onSubmit?: (targetOverride?: string) => void;
  prompt?: string;
}) {
  const connecting =
    busyAction === "manual-target" || busyAction === "select";
  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold leading-6 text-[#444933]">
        {prompt}
      </p>
      <DeviceTargetForm
        busy={connecting}
        buttonLabel="Connect VibeTV"
        className="grid gap-4"
        disabled={Boolean(busyAction) && busyAction !== "search" && !connecting}
        id="setup-device-target"
        lastError={lastError}
        minimal
        onChange={onChange}
        onSubmit={onSubmit}
        searchingLabel="Connecting"
        value={deviceTarget}
      />
    </div>
  );
}

function SetupStep({
  children,
  icon,
  index,
  state,
  title,
}: {
  children?: ReactNode;
  icon: ReactNode;
  index: number;
  state: StepState;
  title: string;
}) {
  const active = state === "active";
  const complete = state === "complete";
  const stateLabel = complete
    ? "complete"
    : active
      ? "current"
      : state === "blocked"
        ? "blocked"
        : "pending";
  return (
    <li
      aria-current={active ? "step" : undefined}
      aria-disabled={state === "blocked" || undefined}
      className={`grid gap-4 border-b border-border px-0 py-5 last:border-b-0 md:grid-cols-[54px_minmax(0,1fr)] ${
        state === "blocked" ? "opacity-70" : ""
      }`}
    >
      <ControlCenterStatusIcon
        size="step"
        variant={complete ? "complete" : active ? "active" : "pending"}
      >
        {complete ? <Check size={22} aria-hidden /> : icon}
      </ControlCenterStatusIcon>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-bold uppercase text-[#506600]">
            Step {index}<span className="sr-only">, {stateLabel}</span>
          </p>
          <h3 className="text-xl font-black text-[#1B1B1B]">{title}</h3>
        </div>
        {children ? <div className="mt-4 min-w-0">{children}</div> : null}
      </div>
    </li>
  );
}

function StatusNote({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Alert className="max-w-[560px]" role="status">
      {icon || <Check aria-hidden />}
      <AlertTitle>{children}</AlertTitle>
    </Alert>
  );
}

function ErrorNote({ error }: { error: ApiError }) {
  return (
    <Alert className="mt-4 max-w-[560px]" variant="destructive">
      <CircleHelp aria-hidden />
      <AlertTitle>{error.message}</AlertTitle>
      <AlertDescription>{error.nextAction}</AlertDescription>
    </Alert>
  );
}

function buildStepStates({
  activeStep,
  forceMacAppStep,
  macAppConfirmed,
  macAppReady,
  deviceConnectionComplete,
  providerReady,
  providerVisible,
  setupComplete,
  wifiConfirmed,
}: {
  activeStep: StepId;
  forceMacAppStep: boolean;
  macAppConfirmed: boolean;
  macAppReady: boolean;
  deviceConnectionComplete: boolean;
  providerReady: boolean;
  providerVisible: boolean;
  setupComplete: boolean;
  wifiConfirmed: boolean;
}): Record<StepId, StepState> {
  return {
    wifi:
      wifiConfirmed || setupComplete
        ? "complete"
        : activeStep === "wifi"
          ? "active"
          : "blocked",
    "mac-app": forceMacAppStep
      ? "active"
      : macAppConfirmed || macAppReady || setupComplete
        ? "complete"
        : activeStep === "mac-app"
          ? "active"
          : wifiConfirmed
            ? "pending"
            : "blocked",
    finish: forceMacAppStep
      ? "blocked"
      : setupComplete || deviceConnectionComplete
        ? "complete"
        : activeStep === "finish"
          ? "active"
          : "blocked",
    provider: !providerVisible
      ? "blocked"
      : setupComplete || providerReady
        ? "complete"
        : activeStep === "provider"
          ? "active"
          : deviceConnectionComplete
            ? "pending"
            : "blocked",
  };
}

function isCompanionMissingError(error?: ApiError | null): boolean {
  return error?.code === "COMPANION_UNREACHABLE";
}
