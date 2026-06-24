"use client";

import {
  Check,
  Clipboard,
  Copy,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ApiError,
  CompanionStatus,
  DeviceInfo,
  DeviceState,
} from "./control-center-types";
import { DeviceTargetForm } from "./device-target-form";

const DEFAULT_CONTROL_CENTER_ORIGIN = "https://app.vibetv.shop";
const INSTALLER_SCRIPT_PATH = "/install-control-center-companion.sh";

function buildAgentPrompt(terminalCommand: string) {
  return `Please install the VibeTV Mac App on this Mac.

VibeTV is a small WiFi desk display for showing usage and theme screens. Its firmware and Mac App source are open source here:
https://github.com/DreamyTalesPAN/CodexBar-Display

First check whether you can run Terminal commands on this Mac.

If you can run Terminal commands:
- check whether the required command-line tools are available
- if a required tool is missing, install the missing dependency first
- if macOS asks for admin approval, system permission, or manual approval, stop and tell me exactly what to approve

If you cannot run Terminal commands:
- do not stop
- tell me this prompt works best in a local coding agent with Terminal access, for example Claude Code or Codex
- if I can use one of those tools, tell me to paste this full prompt there instead
- if I cannot use one of those tools, continue with the manual steps below
- guide me click by click
- tell me to press Command + Space
- tell me to type Terminal
- tell me to press Enter
- tell me exactly what to paste
- tell me to press Enter again
- ask me to send you a screenshot of the result
- read the screenshot, decide whether setup worked, and give me the next exact step

Run this Terminal command:

${terminalCommand}

This command should install the Mac App helper as a user LaunchAgent so it keeps running after setup. Do not install a signed package.

After the command finishes, verify it with:

curl -fsS http://127.0.0.1:47832/v1/status

Then tell me:
- what was installed
- whether any dependencies were installed
- whether the status check worked
- the next step: return to app.vibetv.shop, choose Allow when the browser asks for access, and continue setup

Do not flash firmware, install themes, reset WiFi, or write to my VibeTV. Only install and verify the Mac App.`;
}

function buildTerminalCommand(origin: string) {
  const installerUrl = `${origin}${INSTALLER_SCRIPT_PATH}`;
  const args = ["--launchagent"];
  if (origin !== DEFAULT_CONTROL_CENTER_ORIGIN) {
    args.push("--dev-origin", shellQuote(origin));
  }
  const installCommand = `curl -fsSL ${installerUrl} | bash -s -- ${args.join(" ")}`;
  if (origin === DEFAULT_CONTROL_CENTER_ORIGIN) {
    return installCommand;
  }
  return installCommand;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

type SetupScreenProps = {
  busyAction?: string | null;
  companionStatus: CompanionStatus;
  device: DeviceInfo | null;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onCheckCompanion?: () => void | Promise<void>;
  onDeviceTargetChange?: (target: string) => void;
  onRepairConnection?: (targetOverride?: string) => void;
  onResetSetup?: () => void;
  previewStep?: "mac-app" | null;
  setupComplete: boolean;
};

type StepId = "wifi" | "mac-app" | "browser-access" | "finish";
type SetupMode = "agentic" | "manual";
type StepState = "active" | "blocked" | "complete" | "pending";

export function SetupScreen({
  busyAction,
  companionStatus,
  device,
  deviceState,
  deviceTarget,
  lastError,
  onCheckCompanion,
  onDeviceTargetChange,
  onRepairConnection,
  onResetSetup,
  previewStep,
  setupComplete,
}: SetupScreenProps) {
  const [wifiConfirmedState, setWifiConfirmedState] = useState(false);
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const [macAppConfirmedState, setMacAppConfirmedState] = useState(false);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [terminalCommandCopied, setTerminalCommandCopied] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>("agentic");
  const autoConnectStarted = useRef(false);
  const localAccessNeeded = isLocalNetworkAccessError(lastError);
  const macAppMissing = isCompanionMissingError(lastError);
  const macAppReady = companionStatus === "online";
  const macAppConfirmed =
    !macAppMissing && (macAppConfirmedState || macAppReady || setupComplete);
  const connected = Boolean(device?.connected && device.paired);
  const wifiConfirmed =
    wifiConfirmedState || setupComplete || previewStep === "mac-app";
  const connecting =
    busyAction === "status" ||
    busyAction === "connect" ||
    busyAction === "discover" ||
    busyAction === "repair";
  const controlCenterOrigin =
    typeof window === "undefined"
      ? DEFAULT_CONTROL_CENTER_ORIGIN
      : window.location.origin;
  const terminalCommand = buildTerminalCommand(controlCenterOrigin);
  const agentPrompt = useMemo(
    () => buildAgentPrompt(terminalCommand),
    [terminalCommand],
  );

  useEffect(() => {
    if (
      !wifiConfirmed ||
      !macAppReady ||
      setupComplete ||
      connected ||
      connecting ||
      localAccessNeeded ||
      autoConnectStarted.current
    ) {
      return;
    }
    autoConnectStarted.current = true;
    onRepairConnection?.();
  }, [
    connected,
    connecting,
    localAccessNeeded,
    macAppReady,
    onRepairConnection,
    setupComplete,
    wifiConfirmed,
  ]);

  const activeStep = useMemo(
    () =>
      previewStep ||
      buildActiveStep({
        companionStatus,
        localAccessNeeded,
        macAppConfirmed,
        macAppReady,
        setupComplete,
        wifiConfirmed,
      }),
    [
      companionStatus,
      localAccessNeeded,
      macAppConfirmed,
      macAppReady,
      previewStep,
      setupComplete,
      wifiConfirmed,
    ],
  );
  const stepStates = useMemo(
    () =>
      buildStepStates({
        activeStep,
        macAppConfirmed,
        macAppReady,
        setupComplete,
        wifiConfirmed,
      }),
    [activeStep, macAppConfirmed, macAppReady, setupComplete, wifiConfirmed],
  );

  function confirmWifi() {
    setWifiConfirmedState(true);
    runCheckCompanion();
  }

  function confirmMacApp() {
    setMacAppConfirmedState(true);
    runCheckCompanion();
  }

  function runCheckCompanion() {
    void Promise.resolve(onCheckCompanion?.()).catch(() => undefined);
  }

  function retryConnect() {
    autoConnectStarted.current = true;
    onRepairConnection?.();
  }

  return (
    <div className="mx-auto max-w-[980px]">
      <section className="border-b border-[#747A60] py-8 lg:min-h-[330px] lg:py-12">
        <div className="flex items-start gap-5">
          <div className="grid size-16 shrink-0 place-items-center rounded-full border border-[#747A60] bg-[#EEEEEE] text-[#1B1B1B]">
            {setupComplete ? (
              <Check size={38} aria-hidden />
            ) : (
              <Clipboard size={34} aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="max-w-[520px] text-[clamp(2.8rem,5vw,4.5rem)] font-black leading-[1.05] tracking-normal text-[#1B1B1B]">
              {setupComplete ? "Setup complete" : "Set up your VibeTV"}
            </h2>
            <div className="mt-6 flex flex-wrap gap-3">
              <PrimaryButton
                busy={busyAction === "repair"}
                busyLabel="Reconnecting"
                icon={<RefreshCw size={18} aria-hidden />}
                label="Fix connection"
                onClick={() => onRepairConnection?.()}
              />
              <SecondaryButton
                busy={busyAction === "reset-setup"}
                busyLabel="Resetting"
                icon={<Clipboard size={16} aria-hidden />}
                label="Run setup again"
                onClick={onResetSetup}
              />
            </div>
            {lastError ? <ErrorNote error={lastError} /> : null}
          </div>
        </div>
      </section>

      <section className="py-6">
        <ol className="grid gap-0 border-y border-[#747A60]">
          <SetupStep
            icon={<Wifi size={22} aria-hidden />}
            index={1}
            state={stepStates.wifi}
            title="Connect VibeTV to WiFi"
          >
            {activeStep === "wifi" ? (
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
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
                  icon={<Check size={18} aria-hidden />}
                  label="VibeTV is on WiFi"
                  onClick={confirmWifi}
                />
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            icon={<Download size={22} aria-hidden />}
            index={2}
            state={stepStates["mac-app"]}
            title="Install Mac App"
          >
            {activeStep === "mac-app" ? (
              <div className="grid min-w-0 gap-4">
                <div
                  aria-label="Mac App setup method"
                  className="grid max-w-[440px] grid-cols-2 border border-[#747A60]"
                  role="tablist"
                >
                  <SetupModeTab
                    active={setupMode === "agentic"}
                    label="Agentic setup"
                    onClick={() => setSetupMode("agentic")}
                  />
                  <SetupModeTab
                    active={setupMode === "manual"}
                    label="Manual setup"
                    onClick={() => setSetupMode("manual")}
                  />
                </div>

                {setupMode === "agentic" ? (
                  <div className="grid min-w-0 gap-4">
                    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div className="min-w-0 max-w-full overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
                        <button
                          aria-expanded={promptPreviewOpen}
                          className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-bold text-[#1B1B1B]"
                          onClick={() =>
                            setPromptPreviewOpen((current) => !current)
                          }
                          type="button"
                        >
                          <span>Prompt preview</span>
                          <span className="text-[#506600]">
                            {promptPreviewOpen ? "Hide" : "Show"}
                          </span>
                        </button>
                        {!promptPreviewOpen ? (
                          <p className="border-t border-[#747A60] px-4 py-3 text-xs leading-5 text-[#444933] [overflow-wrap:anywhere]">
                            Please install the VibeTV Mac App on this Mac.
                            VibeTV is a small WiFi desk display for showing
                            usage and theme screens.
                          </p>
                        ) : null}
                        {promptPreviewOpen ? (
                          <pre className="max-h-[280px] w-full max-w-full overflow-auto whitespace-pre-wrap border-t border-[#747A60] bg-[#EEEEEE] p-4 text-xs leading-5 text-[#1B1B1B] [overflow-wrap:anywhere]">
                            {agentPrompt}
                          </pre>
                        ) : null}
                      </div>
                      <PrimaryButton
                        icon={<Copy size={18} aria-hidden />}
                        label={agentPromptCopied ? "Prompt copied" : "Copy prompt"}
                        onClick={async () => {
                          await copyText(agentPrompt);
                          setAgentPromptCopied(true);
                        }}
                      />
                    </div>

                    {agentPromptCopied ? (
                      <StatusNote>
                        Paste the prompt into your coding agent. This page will
                        move on when the Mac App is running.
                      </StatusNote>
                    ) : null}
                  </div>
                ) : null}

                {setupMode === "manual" ? (
                  <div className="grid gap-3 border border-[#747A60] bg-[#F9F9F9] p-4">
                    <p className="text-sm leading-6 text-[#444933]">
                      Open Terminal, paste this command, then press Enter.
                    </p>
                    <code
                      className="block overflow-x-auto border border-[#747A60] bg-[#EEEEEE] p-3 text-xs text-[#1B1B1B]"
                      suppressHydrationWarning
                    >
                      {terminalCommand}
                    </code>
                    <SecondaryButton
                      icon={<Copy size={16} aria-hidden />}
                      label={
                        terminalCommandCopied
                          ? "Command copied"
                          : "Copy terminal command"
                      }
                      onClick={async () => {
                        await copyText(terminalCommand);
                        setTerminalCommandCopied(true);
                      }}
                    />
                  </div>
                ) : null}

                {macAppMissing ? (
                  <StatusNote icon={<RefreshCw size={16} aria-hidden />}>
                    Mac App is not running. Run Agentic setup again, then click
                    Mac App is installed.
                  </StatusNote>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <PrimaryButton
                    busy={busyAction === "status"}
                    busyLabel="Checking"
                    icon={<RefreshCw size={18} aria-hidden />}
                    label="Mac App is installed"
                    onClick={confirmMacApp}
                  />
                </div>
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            icon={<Wifi size={22} aria-hidden />}
            index={3}
            state={stepStates["browser-access"]}
            title="Allow browser access"
          >
            {activeStep === "browser-access" ? (
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <p className="text-sm leading-6 text-[#444933]">
                  Chrome needs permission so this website can talk to the Mac
                  App on this computer.
                </p>
                <PrimaryButton
                  busy={busyAction === "status"}
                  busyLabel="Checking"
                  icon={<Wifi size={18} aria-hidden />}
                  label="Allow access"
                  onClick={runCheckCompanion}
                />
              </div>
            ) : null}
          </SetupStep>

          <SetupStep
            icon={<Monitor size={22} aria-hidden />}
            index={4}
            state={stepStates.finish}
            title="Finish setup"
          >
            {activeStep === "finish" ? (
              <FinishSetupContent
                busyAction={busyAction}
                deviceState={deviceState}
                deviceTarget={deviceTarget}
                lastError={lastError}
                onDeviceTargetChange={onDeviceTargetChange}
                onRepairConnection={retryConnect}
                setupComplete={setupComplete}
              />
            ) : null}
          </SetupStep>
        </ol>
      </section>
    </div>
  );
}

function FinishSetupContent({
  busyAction,
  deviceState,
  deviceTarget,
  lastError,
  onDeviceTargetChange,
  onRepairConnection,
  setupComplete,
}: {
  busyAction?: string | null;
  deviceState: DeviceState;
  deviceTarget: string;
  lastError?: ApiError | null;
  onDeviceTargetChange?: (target: string) => void;
  onRepairConnection?: (targetOverride?: string) => void;
  setupComplete: boolean;
}) {
  if (setupComplete) {
    return <StatusNote>VibeTV is ready.</StatusNote>;
  }

  if (deviceState === "offline") {
    return (
      <div className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm leading-6 text-[#444933]">
            Make sure VibeTV is powered on and connected to the same WiFi.
          </p>
          <PrimaryButton
            icon={<RefreshCw size={18} aria-hidden />}
            label="Fix connection"
            onClick={() => onRepairConnection?.()}
          />
        </div>
        <DeviceTargetForm
          busy={busyAction === "repair"}
          buttonLabel="Fix this address"
          className="grid gap-4"
          disabled={Boolean(busyAction)}
          id="setup-device-target"
          lastError={lastError}
          onChange={onDeviceTargetChange}
          onSubmit={onRepairConnection}
          searchingLabel="Reconnecting"
          value={deviceTarget}
        />
      </div>
    );
  }

  if (
    busyAction === "connect" ||
    busyAction === "discover" ||
    busyAction === "repair"
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
    <StatusNote
      icon={<Loader2 className="animate-spin" size={16} aria-hidden />}
    >
      Connecting VibeTV...
    </StatusNote>
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
  return (
    <li
      className={`grid gap-4 border-b border-[#747A60] px-0 py-5 last:border-b-0 md:grid-cols-[54px_minmax(0,1fr)] ${
        state === "blocked" ? "opacity-45" : ""
      }`}
    >
      <div
        className={`grid size-11 place-items-center rounded-full border ${
          complete
            ? "border-[#1B1B1B] bg-[#CCFF00] text-[#1B1B1B]"
            : active
              ? "border-[#1B1B1B] bg-[#1B1B1B] text-[#CCFF00]"
              : "border-[#747A60] bg-[#F9F9F9] text-[#506600]"
        }`}
      >
        {complete ? <Check size={22} aria-hidden /> : icon}
      </div>
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

function SetupModeTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`min-h-12 border-r border-[#747A60] px-4 py-2 text-sm font-black last:border-r-0 ${
        active
          ? "bg-[#1B1B1B] text-[#EDEDED]"
          : "bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#EEEEEE]"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {label}
    </button>
  );
}

function PrimaryButton({
  busy,
  busyLabel,
  icon,
  label,
  onClick,
}: {
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-12 min-w-[220px] items-center justify-center gap-2 border border-[#1B1B1B] bg-[#1B1B1B] px-5 py-2 text-sm font-bold text-[#EDEDED] transition hover:bg-[#CCFF00] hover:text-[#1B1B1B] disabled:cursor-not-allowed disabled:border-[#747A60] disabled:bg-[#EEEEEE] disabled:text-[#444933]"
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <Loader2 className="animate-spin" size={18} aria-hidden /> : icon}
      <span>{busy ? busyLabel || label : label}</span>
    </button>
  );
}

function SecondaryButton({
  busy,
  busyLabel,
  icon,
  label,
  onClick,
}: {
  busy?: boolean;
  busyLabel?: string;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="inline-flex min-h-12 min-w-[190px] items-center justify-center gap-2 border border-[#747A60] bg-[#F9F9F9] px-5 py-2 text-sm font-semibold text-[#1B1B1B] transition hover:bg-[#EEEEEE] disabled:cursor-not-allowed disabled:bg-[#EEEEEE] disabled:text-[#444933]"
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      {busy ? <Loader2 className="animate-spin" size={16} aria-hidden /> : icon}
      <span>{busy ? busyLabel || label : label}</span>
    </button>
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

function buildActiveStep({
  companionStatus,
  localAccessNeeded,
  macAppConfirmed,
  macAppReady,
  setupComplete,
  wifiConfirmed,
}: {
  companionStatus: CompanionStatus;
  localAccessNeeded: boolean;
  macAppConfirmed: boolean;
  macAppReady: boolean;
  setupComplete: boolean;
  wifiConfirmed: boolean;
}): StepId {
  if (setupComplete) {
    return "finish";
  }
  if (!wifiConfirmed) {
    return "wifi";
  }
  if (!macAppReady && !macAppConfirmed) {
    return "mac-app";
  }
  if (localAccessNeeded) {
    return "browser-access";
  }
  if (!macAppReady && companionStatus !== "online") {
    return "mac-app";
  }
  return "finish";
}

function buildStepStates({
  activeStep,
  macAppConfirmed,
  macAppReady,
  setupComplete,
  wifiConfirmed,
}: {
  activeStep: StepId;
  macAppConfirmed: boolean;
  macAppReady: boolean;
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
    "mac-app": macAppConfirmed || macAppReady || setupComplete
      ? "complete"
      : activeStep === "mac-app"
        ? "active"
        : wifiConfirmed
          ? "pending"
          : "blocked",
    "browser-access": macAppReady
      ? "complete"
      : activeStep === "browser-access"
        ? "active"
        : "blocked",
    finish: setupComplete
      ? "complete"
      : activeStep === "finish"
        ? "active"
        : "blocked",
  };
}

function isLocalNetworkAccessError(error?: ApiError | null): boolean {
  return error?.code === "LOCAL_NETWORK_ACCESS_REQUIRED";
}

function isCompanionMissingError(error?: ApiError | null): boolean {
  return error?.code === "COMPANION_UNREACHABLE";
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
