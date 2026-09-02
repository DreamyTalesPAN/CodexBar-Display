"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  DeviceCandidate,
  PreferenceHealthState,
} from "../control-center-types";
import type { SupportDiagnostics } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import { connectLogLines, type ConnectPhase } from "./setup-connect-log";
import {
  SetupAddressDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
} from "./setup-device-dialogs";
import { SetupDeviceScreen } from "./setup-device-screen";
import { SetupDisplayModeScreen } from "./setup-display-mode-screen";
import {
  SetupFirmwareBlockedDialog,
  SetupFirmwareUpdateFailedDialog,
} from "./setup-firmware-dialogs";
import { SetupLiveScreen } from "./setup-live-screen";
import type { SetupLogLine } from "./setup-log";
import { SetupProvidersScreen } from "./setup-providers-screen";
import { SetupThemeScreen } from "./setup-theme-screen";
import { SetupUsageDialog } from "./setup-usage-dialog";
import { buildAiFixPrompt } from "./setup-ai-prompt";
import type { SetupStep } from "./setup-step";
import { SetupWelcomeScreen } from "./setup-welcome-screen";

const WELCOME_LINES: SetupLogLine[] = [
  { id: "service", text: "starting background service", tone: "done" },
  { id: "usage", text: "reading provider usage on this Mac", tone: "done" },
  { id: "wifi", text: "scanning your WiFi", tone: "done" },
  { id: "device", text: "looking for your VibeTV" },
];

const CANDIDATES: DeviceCandidate[] = [
  {
    target: "http://192.168.178.153",
    deviceId: "5804508",
    firmware: "1.0.55",
    known: true,
  },
  {
    target: "http://192.168.178.159",
    deviceId: "5863327",
    firmware: "1.0.55",
  },
];

/** The phases a connect walks through, with the dwell time of each. */
const CONNECT_SCRIPT: { ms: number; phase: ConnectPhase }[] = [
  { ms: 1200, phase: "connecting" },
  { ms: 1200, phase: "checking-firmware" },
  { ms: 2600, phase: "updating-firmware" },
  { ms: 900, phase: "done" },
];

function provider(fields: {
  health: PreferenceHealthState;
  label: string;
  message?: string;
  providerId: string;
  value?: boolean;
}): ProviderItem {
  const value = fields.value ?? true;
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: value,
    health: {
      message: fields.message || "",
      service: "operational",
      state: fields.health,
    },
    id: `codexbar.providers.${fields.providerId}.enabled`,
    label: fields.label,
    owner: "codexbar",
    providerId: fields.providerId,
    section: "providers",
    type: "boolean",
    value,
    writable: true,
    writeStrategy: "codexbar_command",
  };
}

const PROVIDERS: ProviderItem[] = [
  provider({ health: "healthy", label: "Codex", providerId: "codex" }),
  provider({ health: "checking", label: "Cursor", providerId: "cursor" }),
  provider({ health: "auth_required", label: "Claude", providerId: "claude" }),
  provider({
    health: "permission_required",
    label: "Gemini",
    providerId: "gemini",
  }),
  provider({ health: "timeout", label: "Copilot", providerId: "copilot" }),
  provider({
    health: "healthy",
    label: "Mistral",
    providerId: "mistral",
    value: false,
  }),
  provider({
    health: "no_usage_available",
    label: "OpenCode",
    providerId: "opencode",
  }),
  provider({
    health: "service_outage",
    label: "DeepSeek",
    providerId: "deepseek",
  }),
];

const THEMES = [
  { id: "claude-creature", name: "Claude Creature" },
  { id: "clippy", name: "Clippy" },
  { id: "mini-classic", name: "Mini Classic" },
  { id: "synthwave", name: "Synthwave" },
];

const AUTOMATIC_PREVIEWS = [
  {
    providerLabel: "Codex",
    resetLabel: "RESET IN 3H",
    sessionPercent: 42,
    weeklyPercent: 26,
  },
  {
    providerLabel: "Cursor",
    resetLabel: "RESET IN 11H",
    sessionPercent: 18,
    weeklyPercent: 63,
  },
  {
    providerLabel: "Claude",
    resetLabel: "RESET IN 5H",
    sessionPercent: 71,
    weeklyPercent: 44,
  },
];

const THEME_INSTALL_LOGS = [
  "Preparing theme install",
  "Uploading theme to VibeTV",
  "Activating theme",
];

const STEP_ORDER = ["01", "02", "03", "04", "05", "06"] as const;
type Step = (typeof STEP_ORDER)[number];

type Entry = { id: string; label: string };

/** Every 02x artboard is a state of the device step, and so on. */
function galleryStep(entryId: string): SetupStep {
  switch (entryId.slice(0, 2)) {
    case "01":
      return "welcome";
    case "03":
      return "providers";
    case "04":
      return "display";
    case "05":
      return "theme";
    case "06":
      return "live";
    default:
      return "device";
  }
}

const ENTRIES: Entry[] = [
  { id: "01", label: "01 Welcome" },
  { id: "02", label: "02 Choose" },
  { id: "03", label: "03 Providers" },
  { id: "04", label: "04 Display" },
  { id: "05", label: "05 Theme" },
  { id: "06", label: "06 Live" },
  { id: "02b", label: "· Enter IP" },
  { id: "02c", label: "· Not found" },
  { id: "02d", label: "· Connect failed" },
  { id: "02f", label: "· Update failed" },
  { id: "02g", label: "· App behind" },
  { id: "03b", label: "· Usage failed" },
];

/**
 * Development-only walkthrough of the setup steps, mirroring the internal UI
 * kit route. The signal button on each step advances, and Connect runs the real
 * log derivation on a script, so the flow can be checked against the design
 * before the wizard is wired into the app.
 */
export function SetupPreviewGallery() {
  const [active, setActive] = useState<string>("01");
  const [dialogOpen, setDialogOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(CANDIDATES[0].target);
  const [connectPhase, setConnectPhase] = useState<ConnectPhase>("idle");
  const [displayMode, setDisplayMode] = useState<"automatic" | "fixed">(
    "automatic",
  );
  const [displayProvider, setDisplayProvider] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string | null>("clippy");
  const reportStep = useRef(0);
  const [installing, setInstalling] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const goTo = useCallback(
    (step: string) => {
      clearTimers();
      setActive(step);
      setDialogOpen(true);
      setConnectPhase("idle");
      setInstalling(false);
    },
    [clearTimers],
  );

  // Welcome has no controls: it advances as soon as the checks behind it answer.
  useEffect(() => {
    if (active !== "01") {
      return;
    }
    const timer = setTimeout(() => setActive("02"), 2600);
    return () => clearTimeout(timer);
  }, [active]);

  function runConnect() {
    clearTimers();
    let elapsed = 0;
    for (const stage of CONNECT_SCRIPT) {
      elapsed += stage.ms;
      timers.current.push(
        setTimeout(() => setConnectPhase(stage.phase), elapsed - stage.ms),
      );
    }
    timers.current.push(setTimeout(() => goTo("03"), elapsed + 700));
  }

  function runInstall() {
    setInstalling(true);
    timers.current.push(setTimeout(() => goTo("06"), 1800));
  }

  const selectedCandidate = CANDIDATES.find(
    (candidate) => candidate.target === selected,
  );
  const connectState = {
    address: selectedCandidate?.target.replace(/^https?:\/\//, "") || "",
    deviceLabel: `VibeTV ${selectedCandidate?.deviceId || ""}`,
    firmwareFrom: "1.0.55",
    firmwareTo: "1.0.61",
    phase: connectPhase,
  };
  const connecting =
    connectPhase !== "idle" && connectPhase !== "done" && connectPhase !== "failed";

  function deviceScreen(lines?: SetupLogLine[]) {
    return (
      <SetupDeviceScreen
        aiFixPrompt={aiFixPrompt}
            onCreateSupportReport={createSupportReport}
        candidates={CANDIDATES}
        connecting={connecting}
        logLines={lines ?? connectLogLines(connectState)}
        onConnect={runConnect}
        onEnterAddressManually={() => setActive("02b")}
        onSearchAgain={() => setActive("02")}
        onSelect={(candidate) => setSelected(candidate.target)}
        selectedTarget={selected}
      />
    );
  }

  const noop = () => undefined;
  const NO_PENDING_CHECKS = new Set<string>();

  // Cycles saved -> saved with gaps -> failed, so all three outcomes of the
  // Help menu can be seen without breaking anything to reach them.
  const createSupportReport = async (): Promise<SupportDiagnostics | null> => {
    const step = reportStep.current;
    reportStep.current = (step + 1) % 3;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (step === 2) {
      return null;
    }
    return {
      generatedAt: "2026-08-28T12:00:00Z",
      checks: [],
      collectionErrors:
        step === 1
          ? [{ source: "mac-app", message: "The Mac App did not answer." }]
          : undefined,
    } as SupportDiagnostics;
  };

  const aiFixPrompt = () =>
    buildAiFixPrompt({
      appVersion: "1.4.2",
      deviceSummary: selectedCandidate
        ? `VibeTV ${selectedCandidate.deviceId} on ${connectState.address}`
        : "not found yet",
      // The app's event log prepends, so the newest entry is first.
      events: [
        { id: "2", at: "14:02:41", label: "Search finished", detail: "2 found" },
        { id: "1", at: "14:02:11", label: "Search started", detail: "en0" },
      ],
      osVersion: "15.2",
      screen: galleryStep(active),
    });

  function screen(): ReactNode {
    switch (active) {
      case "01":
        return (
          <SetupWelcomeScreen
            aiFixPrompt={aiFixPrompt}
            lines={WELCOME_LINES}
            onCreateSupportReport={createSupportReport}
          />
        );
      case "02":
        return deviceScreen();
      case "02b":
        return (
          <>
            {deviceScreen([])}
            <SetupAddressDialog
              // Only the address of the demo VibeTV succeeds, so the failure
              // the customer sees for a wrong one is walkable here too.
              onConnect={async (target) =>
                target === CANDIDATES[0].target
                  ? (goTo("03"), null)
                  : "No VibeTV answered at that IP address. Check the IP address shown on the VibeTV screen, then try again."
              }
              onOpenChange={setDialogOpen}
              open={dialogOpen}
            />
          </>
        );
      case "02c":
        return (
          <>
            <SetupWelcomeScreen lines={WELCOME_LINES} />
            <SetupDeviceNotFoundDialog
              onEnterAddressManually={() => setActive("02b")}
              onOpenChange={setDialogOpen}
              onScanAgain={() => goTo("02")}
              open={dialogOpen}
            />
          </>
        );
      case "02d":
        return (
          <>
            {deviceScreen(
              connectLogLines({
                ...connectState,
                errorText: "connection could not be completed",
                failedAt: "connecting",
                firmwareFrom: undefined,
                firmwareTo: undefined,
                phase: "failed",
              }),
            )}
            <SetupConnectFailedDialog
              description="It was found, but the connection could not be completed. Keep VibeTV powered on, then search again."
              onEnterAddressManually={() => setActive("02b")}
              onOpenChange={setDialogOpen}
              onSearchAgain={() => goTo("02")}
              open={dialogOpen}
              title="VibeTV could not connect"
            />
          </>
        );
      case "02f":
        return (
          <>
            {deviceScreen(
              connectLogLines({
                ...connectState,
                errorText: "update did not finish",
                failedAt: "updating-firmware",
                phase: "failed",
                updateProgress: 55,
              }),
            )}
            <SetupFirmwareUpdateFailedDialog
              onCreateSupportReport={noop}
              onOpenChange={setDialogOpen}
              onRetry={() => goTo("02")}
              open={dialogOpen}
            />
          </>
        );
      case "02g":
        return (
          <>
            {deviceScreen(
              connectLogLines({ ...connectState, phase: "checking-firmware" }),
            )}
            <SetupFirmwareBlockedDialog
              onOpenChange={setDialogOpen}
              onResolve={noop}
              open={dialogOpen}
              reason="mac_app_update_required"
            />
          </>
        );
      case "03":
        return (
          <SetupProvidersScreen
            aiFixPrompt={aiFixPrompt}
            onCreateSupportReport={createSupportReport}
            onBack={() => goTo("02")}
            onCheckAgain={noop}
            onContinue={() => goTo("04")}
            onRecover={noop}
            onToggle={noop}
            pendingCheckIds={NO_PENDING_CHECKS}
            pendingPreferenceIds={NO_PENDING_CHECKS}
            providers={PROVIDERS}
          />
        );
      case "03b":
        return (
          <>
            <SetupProvidersScreen
              onCheckAgain={noop}
              onContinue={noop}
              onRecover={noop}
              onToggle={noop}
              pendingCheckIds={NO_PENDING_CHECKS}
              pendingPreferenceIds={NO_PENDING_CHECKS}
              providers={PROVIDERS.slice(0, 3)}
            />
            <SetupUsageDialog
              cause="unknown"
              onCreateSupportReport={noop}
              onOpenChange={setDialogOpen}
              onRepair={noop}
              open={dialogOpen}
            />
          </>
        );
      case "04":
        return (
          <SetupDisplayModeScreen
            aiFixPrompt={aiFixPrompt}
            onCreateSupportReport={createSupportReport}
            automaticPreview={AUTOMATIC_PREVIEWS[0]}
            automaticPreviews={AUTOMATIC_PREVIEWS}
            manualPreview={{
              providerLabel: displayProvider === "claude" ? "Claude" : "Codex",
              resetLabel: "RESET IN 5H",
              sessionPercent: 45,
              weeklyPercent: 26,
            }}
            mode={displayMode}
            onBack={() => goTo("03")}
            onContinue={() => goTo("05")}
            onSelectMode={setDisplayMode}
            onSelectProvider={setDisplayProvider}
            providers={[
              { id: "codex", label: "Codex" },
              { id: "cursor", label: "Cursor" },
              { id: "claude", label: "Claude" },
            ]}
            selectedProviderId={displayProvider}
          />
        );
      case "05":
        return (
          <SetupThemeScreen
            aiFixPrompt={aiFixPrompt}
            onCreateSupportReport={createSupportReport}
            installLogs={installing ? THEME_INSTALL_LOGS : []}
            installing={installing}
            onBack={() => goTo("04")}
            onInstall={runInstall}
            onSelect={(theme) => setThemeId(theme.id)}
            selectedThemeId={themeId}
            themes={THEMES}
          />
        );
      default:
        return (
          <SetupLiveScreen
            aiFixPrompt={aiFixPrompt}
            onCreateSupportReport={createSupportReport}
            device={null}
            displayFrame={null}
            usage={null}
          />
        );
    }
  }

  const stepIndex = STEP_ORDER.indexOf(active as Step);

  return (
    <div className="min-h-svh bg-muted">
      <div className="relative">{screen()}</div>
      <nav className="fixed top-3 left-3 z-70 flex w-36 flex-col gap-0.5 rounded-xl bg-foreground/90 p-1.5 shadow-lg">
        {ENTRIES.map((entry) => (
          <button
            className={
              entry.id === active
                ? "rounded-lg bg-background px-2.5 py-1 text-left text-xs font-semibold text-foreground"
                : "rounded-lg px-2.5 py-1 text-left text-xs font-semibold text-background/70 hover:text-background"
            }
            key={entry.id}
            onClick={() => goTo(entry.id)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
        <button
          className="mt-1 rounded-lg border-t border-background/20 px-2.5 pt-1.5 text-left text-xs font-semibold text-background/70 hover:text-background"
          onClick={() => goTo(STEP_ORDER[0])}
          type="button"
        >
          {stepIndex >= 0 ? `↻ restart (${stepIndex + 1}/6)` : "↻ restart"}
        </button>
      </nav>
    </div>
  );
}
