"use client";

import {
  BarChart3,
  Check,
  Clipboard,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";
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
import { ControlCenterButton } from "./control-center-button";
import { DeviceTargetForm } from "./device-target-form";
import { ControlCenterStatusIcon } from "./control-center-status-icon";
import {
  ProviderSetupCard,
  providerSetupIsReady,
} from "./provider-setup-card";
import { SupportReportActions } from "./support-report-actions";

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
    !hostedMode &&
    showIntro &&
    !previewStep &&
    !lastError &&
    setupComplete;
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
        <section className="border-b border-[#747A60] py-8 lg:min-h-[330px] lg:py-12">
          <div className="flex items-start gap-5">
            <ControlCenterStatusIcon variant="complete">
              <Check size={38} aria-hidden />
            </ControlCenterStatusIcon>
            <div className="min-w-0">
              <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
                Setup complete
              </h2>
              <div className="mt-6">
                <PrimaryButton
                  busy={busyAction === "reset-setup"}
                  busyLabel="Resetting"
                  icon={<Clipboard size={18} aria-hidden />}
                  label="Run setup again"
                  onClick={onResetSetup}
                  size="large"
                />
              </div>
            </div>
          </div>
        </section>
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
        <section className="border-b border-[#747A60] py-8 lg:min-h-[330px] lg:py-12">
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
                  <SecondaryButton
                    busy={busyAction === "reset-setup"}
                    busyLabel="Resetting"
                    icon={<Clipboard size={16} aria-hidden />}
                    label="Run setup again"
                    onClick={onResetSetup}
                  />
                </div>
              ) : null}
              {lastError && !macAppMissing ? (
                <ErrorNote error={lastError} />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {!showIntro && lastError && !macAppMissing ? (
        <div className="pt-5">
          <ErrorNote error={lastError} />
        </div>
      ) : null}

      <section className="py-6">
        <ol className="grid gap-0 border-y border-[#747A60]">
          {!hostedMode && !forceMacAppStep ? (
            <SetupStep
              icon={<Wifi size={22} aria-hidden />}
              index={1}
              state={stepStates.wifi}
              title="Connect VibeTV to WiFi"
            >
              {activeStep === "wifi" ? (
                <div className="grid gap-5">
                  <ol className="grid gap-2 text-sm leading-6 text-[#444933]">
                    <li>1. Plug VibeTV into power.</li>
                    <li>2. Wait until VibeTV shows VibeTV-Setup.</li>
                    <li>3. Take your phone.</li>
                    <li>
                      4. Open WiFi settings and join{" "}
                      <strong className="font-black text-[#1B1B1B]">
                        VibeTV-Setup
                      </strong>
                      .
                    </li>
                    <li>
                      5. If the browser does not open automatically, open{" "}
                      <strong className="font-black text-[#1B1B1B]">
                        192.168.4.1
                      </strong>{" "}
                      on your phone.
                    </li>
                    <li>6. Choose your home WiFi and save.</li>
                    <li>
                      7. Wait until VibeTV says WiFi connected, then continue
                      here.
                    </li>
                  </ol>
                  <PrimaryButton
                    fullWidth
                    icon={<Check size={18} aria-hidden />}
                    label="VibeTV is on WiFi"
                    onClick={confirmWifi}
                    size="large"
                  />
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
                    <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4">
                      <a
                        className="vibetv-button vibetv-button--large vibetv-button--full vibetv-button--primary"
                        href={dmgUrl}
                        onClick={() => setDmgDownloadStarted(true)}
                      >
                        <Download size={18} aria-hidden />
                        <span>
                          {hostedMode
                            ? "Download Mac App"
                            : "Update"}
                        </span>
                      </a>
                    </div>
                  ) : (
                    <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4">
                      <p className="text-sm leading-6 text-[#444933]">
                        The signed Mac App download is not ready yet. Please try
                        again later.
                      </p>
                      <PrimaryButton
                        disabled
                        fullWidth
                        icon={<Download size={18} aria-hidden />}
                        label={
                          hostedMode
                            ? "Mac App download not ready"
                            : "New Mac App not ready"
                        }
                        size="large"
                      />
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
                      <PrimaryButton
                        busy={busyAction === "status"}
                        busyLabel="Checking"
                        disabled={!dmgDownloadStarted}
                        fullWidth
                        icon={<Check size={18} aria-hidden />}
                        label="Mac App is installed"
                        onClick={confirmMacApp}
                        size="large"
                      />
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
    <section className="border-b border-[#747A60] py-6">
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
          <a
            className="vibetv-button vibetv-button--large vibetv-button--primary w-full sm:w-auto"
            href={downloadUrl}
          >
            <Download size={18} aria-hidden />
            <span>Update</span>
          </a>
        ) : checkFailed ? (
          <PrimaryButton
            busy={checking}
            busyLabel="Checking"
            fullWidth
            icon={<RefreshCw size={18} aria-hidden />}
            label="Check again"
            onClick={onRetry}
            size="large"
          />
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
      <StatusNote
        icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
      >
        Searching for VibeTVs on your WiFi...
      </StatusNote>
    );
  }

  if (deviceSearchState === "alternate" && deviceCandidates[0]) {
    const candidate = deviceCandidates[0];
    return (
      <div className="grid gap-5" aria-live="polite">
        <div className="grid gap-2">
          <h4 className="text-xl font-black text-[#1B1B1B]">
            VibeTV found
          </h4>
          <p className="text-sm leading-6 text-[#444933]">
            Connect to this VibeTV?
          </p>
        </div>
        <DeviceCandidateCard candidate={candidate} />
        <div className="grid gap-3 sm:grid-cols-2">
          <PrimaryButton
            busy={busyAction === "select"}
            busyLabel="Connecting"
            disabled={Boolean(busyAction) && busyAction !== "select"}
            fullWidth
            icon={<Monitor size={18} aria-hidden />}
            label="Connect this VibeTV"
            onClick={() => onSelectDevice?.(candidate)}
            size="large"
          />
          <SecondaryButton
            disabled={Boolean(busyAction)}
            fullWidth
            label="Not now"
            onClick={onDeclineDevice}
            size="large"
          />
          <SecondaryButton
            disabled={Boolean(busyAction)}
            fullWidth
            icon={<RefreshCw size={18} aria-hidden />}
            label="Search again"
            onClick={onSearchDevices}
            size="large"
          />
        </div>
      </div>
    );
  }

  if (deviceSearchState === "multiple") {
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <h4 className="text-xl font-black text-[#1B1B1B]">
            Choose a VibeTV
          </h4>
          <p className="text-sm leading-6 text-[#444933]">
            More than one VibeTV was found. Choose the one you want to connect.
          </p>
        </div>
        <div className="grid gap-3">
          {deviceCandidates.map((candidate) => (
            <div
              className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={`${candidate.deviceId || "legacy"}-${candidate.target}`}
            >
              <DeviceCandidateDetails candidate={candidate} />
              <ControlCenterButton
                busy={busyAction === "select"}
                busyLabel="Connecting"
                disabled={Boolean(busyAction) && busyAction !== "select"}
                icon={<Monitor size={18} aria-hidden />}
                label="Connect this VibeTV"
                onClick={() => onSelectDevice?.(candidate)}
                variant="secondary"
              />
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SecondaryButton
            disabled={Boolean(busyAction)}
            fullWidth
            label="Not now"
            onClick={onDeclineDevice}
            size="large"
          />
          <SecondaryButton
            disabled={Boolean(busyAction)}
            fullWidth
            icon={<RefreshCw size={18} aria-hidden />}
            label="Search again"
            onClick={onSearchDevices}
            size="large"
          />
        </div>
      </div>
    );
  }

  if (deviceSearchState === "declined") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[#444933]">
          No VibeTV is selected. You can search again when you are ready.
        </p>
        <SecondaryButton
          fullWidth
          icon={<RefreshCw size={18} aria-hidden />}
          label="Search again"
          onClick={onSearchDevices}
          size="large"
        />
      </div>
    );
  }

  if (deviceSearchState === "not-found") {
    return (
      <div className="grid gap-5">
        <p className="text-sm leading-6 text-[#444933]">
          No VibeTV was found automatically. Enter the address shown on the
          VibeTV screen.
        </p>
        <DeviceTargetForm
          busy={busyAction === "repair"}
          buttonLabel="Connect VibeTV"
          className="grid gap-4"
          disabled={Boolean(busyAction)}
          id="setup-device-target"
          lastError={lastError}
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
        <p className="text-sm leading-6 text-[#444933]">
          Automatic search could not finish. Make sure VibeTV and this Mac are
          on the same WiFi, then try again.
        </p>
        <PrimaryButton
          fullWidth
          icon={<RefreshCw size={18} aria-hidden />}
          label="Try again"
          onClick={onSearchDevices}
          size="large"
        />
      </div>
    );
  }

  if (deviceSearchState === "repair-failed") {
    return (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[#444933]">
          VibeTV could not reconnect automatically. Make sure it is on the same
          WiFi as this Mac, then try again.
        </p>
        <PrimaryButton
          fullWidth
          icon={<RefreshCw size={18} aria-hidden />}
          label="Try again"
          onClick={onSearchDevices}
          size="large"
        />
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
    <StatusNote>
      {deviceState === "offline"
        ? "VibeTV is offline. Run setup again to search for it."
        : "Waiting for automatic VibeTV search."}
    </StatusNote>
  );
}

function DeviceCandidateCard({ candidate }: { candidate: DeviceCandidate }) {
  return (
    <div className="border border-[#747A60] bg-[#F9F9F9] p-4">
      <DeviceCandidateDetails candidate={candidate} />
    </div>
  );
}

function DeviceCandidateDetails({
  candidate,
}: {
  candidate: DeviceCandidate;
}) {
  const address = candidateAddress(candidate.target);
  return (
    <div className="min-w-0">
      <p className="break-words text-base font-black text-[#1B1B1B]">
        VibeTV {candidate.deviceId || address}
      </p>
      <p className="mt-1 break-words text-sm leading-6 text-[#444933]">
        IP address: {address}
        {candidate.firmware ? ` · Firmware ${candidate.firmware}` : ""}
      </p>
      {candidate.known ? (
        <p className="mt-1 text-sm font-bold text-[#506600]">
          Previously connected
        </p>
      ) : null}
    </div>
  );
}

function candidateAddress(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
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
  return (
    <li
      className={`grid gap-4 border-b border-[#747A60] px-0 py-5 last:border-b-0 md:grid-cols-[54px_minmax(0,1fr)] ${
        state === "blocked" ? "opacity-45" : ""
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
            Step {index}
          </p>
          <h3 className="text-xl font-black text-[#1B1B1B]">{title}</h3>
        </div>
        {children ? <div className="mt-4 min-w-0">{children}</div> : null}
      </div>
    </li>
  );
}

function PrimaryButton({
  busy,
  busyLabel,
  disabled,
  fullWidth,
  icon,
  label,
  onClick,
  size,
}: {
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  size?: "default" | "large" | "compact";
}) {
  return (
    <ControlCenterButton
      busy={busy}
      busyLabel={busyLabel}
      disabled={disabled}
      fullWidth={fullWidth}
      icon={icon}
      label={label}
      onClick={onClick}
      size={size}
      variant="primary"
    />
  );
}

function SecondaryButton({
  busy,
  busyLabel,
  disabled,
  fullWidth,
  icon,
  label,
  onClick,
  size,
}: {
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  size?: "default" | "large" | "compact";
}) {
  return (
    <ControlCenterButton
      busy={busy}
      busyLabel={busyLabel}
      disabled={disabled}
      fullWidth={fullWidth}
      icon={icon}
      label={label}
      onClick={onClick}
      size={size}
      variant="secondary"
    />
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
    <div
      className="inline-flex min-h-12 items-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-4 py-2 text-sm font-semibold text-[#444933]"
      role="status"
    >
      {icon || <Check size={16} aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

function ErrorNote({ error }: { error: ApiError }) {
  return (
    <div
      className="mt-4 grid max-w-[560px] gap-1 border border-[#747A60] bg-[#F9F9F9] px-4 py-3 text-sm text-[#444933]"
      role="alert"
    >
      <strong className="font-black text-[#1B1B1B]">{error.message}</strong>
      <span>{error.nextAction}</span>
    </div>
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
