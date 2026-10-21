"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DeviceCandidate,
  DeviceInfo,
  PreferenceHealthState,
} from "../control-center-types";
import type { DisplayFrame, DisplayFrameSnapshot } from "../live-vibetv-preview";
import type { SupportDiagnostics } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import { connectLogLines, type ConnectPhase } from "./setup-connect-log";
import {
  SetupAddressDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
} from "./setup-device-dialogs";
import { candidateKey } from "./setup-connection";
import { SetupDeviceScreen } from "./setup-device-screen";
import { SetupDisplayModeScreen } from "./setup-display-mode-screen";
import { displayPreviewFor } from "./setup-display-previews";
import {
  SetupFirmwareBlockedDialog,
  SetupFirmwareUpdateFailedDialog,
} from "./setup-firmware-dialogs";
import { SetupLiveScreen } from "./setup-live-screen";
import type { SetupLogLine } from "./setup-log";
import { SetupProvidersScreen } from "./setup-providers-screen";
import { SetupThemeScreen } from "./setup-theme-screen";
import { SetupUsageDialog } from "./setup-usage-dialog";
import { SetupEventsContext } from "../setup-event-log";
import type { SetupLog as SetupEventsLog } from "../control-center-types";
import { buildAiFixPrompt } from "./setup-ai-prompt";
import type { SetupStep } from "./setup-step";
import { SetupWelcomeScreen } from "./setup-welcome-screen";

const WELCOME_LINES: SetupLogLine[] = [
  { id: "service", text: "starting the Mac App", tone: "done" },
  { id: "usage", text: "reading your AI providers", tone: "done" },
  { id: "device", text: "looking for your VibeTV" },
];

const CANDIDATES: DeviceCandidate[] = [
  {
    transport: "wifi",
    target: "http://192.168.178.153",
    deviceId: "5804508",
    firmware: "1.0.55",
    known: true,
  },
  {
    transport: "wifi",
    target: "http://192.168.178.159",
    deviceId: "5863327",
    firmware: "1.0.55",
  },
];

/**
 * The VibeTV the preview pretends to be connected to: the first one of the
 * list, showing the Claude creature theme. Its screen is drawn from the theme
 * pack the Mac App serves, so without one the screen says "Loading preview".
 */
const PREVIEW_DEVICE = {
  deviceId: "5804508",
  target: "http://192.168.178.153",
  active: true,
  connected: true,
  paired: true,
  ready: true,
  board: "esp8266_smalltv_st7789",
  firmware: "1.0.55",
  activeTheme: "claude-creature",
  display: {
    themeSpec: {
      active: true,
      path: "/themes/u/claude--9-5c74ca.json",
      renderOk: true,
    },
  },
} as DeviceInfo;

const PREVIEW_FRAME: DisplayFrameSnapshot = {
  ok: true,
  savedAt: "2026-10-20T10:00:00Z",
  frame: {
    v: 2,
    provider: "claude",
    label: "Claude",
    usageMode: "remaining",
    resetSecs: 1380,
    usageSlots: [
      { id: "session", label: "Session", percent: 92, resetSecs: 1380 },
      { id: "weekly", label: "Weekly", percent: 90 },
    ],
  },
};

const CABLE_CANDIDATES: DeviceCandidate[] = CANDIDATES.map(
  (candidate, index) => ({
    ...candidate,
    transport: "cable",
    target: `/dev/cu.usbserial-preview-${index}`,
  }),
);

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
  provider({ health: "auth_required", label: "Cursor", providerId: "cursor" }),
  provider({ health: "healthy", label: "Claude", providerId: "claude" }),
  provider({
    health: "healthy",
    label: "Copilot",
    providerId: "copilot",
    value: false,
  }),
  provider({
    health: "healthy",
    label: "Gemini",
    providerId: "gemini",
    value: false,
  }),
];

const THEMES = [
  { id: "claude-creature", name: "Claude" },
  { id: "synthwave", name: "Synthwave" },
  { id: "clippy", name: "Clippy" },
  { id: "mini-classic", name: "Mini Classic" },
];

/** A made-up setup log, so the Help menu's "Show setup log" has something to show. */
const EVENT_ROWS: [string, string, string, string][] = [
  ["14:02:11", "service_restart", "started", "Mac App started"],
  ["14:02:13", "device_search", "started", "Searching on WiFi"],
  ["14:02:19", "device_search", "succeeded", "2 found"],
  ["14:02:24", "device_select", "succeeded", "VibeTV 4F2A chosen"],
  ["14:02:31", "wifi_setup", "succeeded", "WiFi details sent"],
  ["14:02:58", "firmware_update", "started", "1.3.9 to 1.4.2"],
  ["14:03:40", "firmware_update", "succeeded", "Updated"],
  ["14:03:52", "wifi_setup", "started", "Waiting for VibeTV"],
];
const SAMPLE_EVENTS: SetupEventsLog = {
  sessionId: "preview",
  startedAt: new Date(2026, 9, 19, 14, 2, 11).toISOString(),
  truncated: false,
  dropped: 0,
  events: EVENT_ROWS.map(([clock, stage, status, message], index) => {
    const [h, m, sec] = clock.split(":").map(Number);
    return {
      seq: index + 1,
      at: new Date(2026, 9, 19, h, m, sec).toISOString(),
      stage,
      status,
      message,
    };
  }),
};
const loadSampleEvents = async () => SAMPLE_EVENTS;

// Fixture previews: usage-shaped readings for the plain tile, plus the frame the
// companion would deliver for the theme tile.
const GALLERY_COLLECTED_AT = new Date().toISOString();
const galleryPreview = (
  id: string,
  label: string,
  session: number,
  weekly: number,
  resetSecs: number,
) => {
  const preview = displayPreviewFor({
    id,
    label,
    session,
    weekly,
    resetSecs,
    usageMode: "used",
    collectedAt: GALLERY_COLLECTED_AT,
    windows: [
      { id: "session", label: "Session", usedPercent: session, resetSecs },
      { id: "weekly", label: "Weekly", usedPercent: weekly, resetSecs: resetSecs * 24 },
    ],
  })!;
  const frame: DisplayFrame = {
    v: 2,
    provider: id,
    label,
    session,
    weekly,
    resetSecs,
    usageMode: "used",
    usageWindows: [
      { id: "session", label: "Session", percent: session, resetSecs },
      { id: "weekly", label: "Weekly", percent: weekly, resetSecs: resetSecs * 24 },
    ],
    resetTrust: "live",
    resetTrustSecs: 5 * 3600,
    resetSource: id,
  };
  return { ...preview, frame, pinnedFrame: frame, frameAt: GALLERY_COLLECTED_AT };
};
const AUTOMATIC_PREVIEWS = [
  galleryPreview("codex", "Codex", 42, 26, 3 * 3600),
  galleryPreview("cursor", "Cursor", 18, 63, 11 * 3600),
  galleryPreview("claude", "Claude", 71, 44, 5 * 3600),
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
  { id: "02", label: "02 Connection" },
  { id: "02-cable", label: "· Cable devices" },
  { id: "02-cable-connecting", label: "· Cable connecting" },
  { id: "02-checking", label: "· Checking firmware" },
  { id: "02-firmware", label: "· Updating firmware" },
  { id: "02-wifi", label: "· WiFi devices" },
  { id: "02-wifi-setup", label: "· WiFi over cable" },
  { id: "02-phone", label: "· Cable help" },
  { id: "03", label: "03 Providers" },
  { id: "03-loading", label: "· Providers loading" },
  { id: "04", label: "04 Display" },
  { id: "05", label: "05 Theme" },
  { id: "06", label: "06 Live" },
  { id: "02b", label: "· Enter IP" },
  { id: "02c", label: "· Not found" },
  { id: "02d", label: "· Connect failed" },
  { id: "02f", label: "· Update failed" },
  { id: "02g", label: "· Check failed" },
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
  const [wifiWaiting, setWiFiWaiting] = useState(false);
  const [selected, setSelected] = useState<string | null>(
    candidateKey(CANDIDATES[0]),
  );
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
      setWiFiWaiting(false);
      setSelected(
        candidateKey(
          step.startsWith("02-cable") ? CABLE_CANDIDATES[0] : CANDIDATES[0],
        ),
      );
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

  const selectedCandidate = [...CANDIDATES, ...CABLE_CANDIDATES].find(
    (candidate) => candidateKey(candidate) === selected,
  );
  const connectState = {
    address:
      selectedCandidate?.transport === "cable"
        ? "VibeTV by Cable"
        : selectedCandidate?.target.replace(/^https?:\/\//, "") || "",
    deviceLabel: `VibeTV ${selectedCandidate?.deviceId || ""}`,
    firmwareFrom: "1.0.55",
    firmwareTo: "1.0.61",
    phase:
      active === "02-cable-connecting"
        ? ("connecting" as const)
        : active === "02-checking"
          ? ("checking-firmware" as const)
          : active === "02-firmware"
            ? ("updating-firmware" as const)
            : connectPhase,
  };
  const connecting =
    connectState.phase !== "idle" &&
    connectState.phase !== "done" &&
    connectState.phase !== "failed";

  function deviceScreen(lines?: SetupLogLine[]) {
    return (
      <SetupDeviceScreen
        previewDevice={PREVIEW_DEVICE}
        previewFrame={PREVIEW_FRAME}
        connectPhase={connectState.phase}
        firmwarePercent={active === "02-firmware" ? 42 : undefined}
        onWiFiError={() => {}}
        aiFixPrompt={aiFixPrompt}
        onCreateSupportReport={createSupportReport}
        candidates={
          active.startsWith("02-cable")
            ? CABLE_CANDIDATES
            : active === "02"
              ? [CABLE_CANDIDATES[0], ...CANDIDATES]
              : active === "02-phone"
                ? []
                : CANDIDATES
        }
        transport={active.startsWith("02-cable") ? "cable" : "wifi"}
        showModeChoice={active === "02"}
        showCandidates={
          ![
            "02",
            "02-phone",
            "02-wifi-setup",
            "02-cable-connecting",
            "02-checking",
            "02-firmware",
          ].includes(active)
        }
        wifiSetupPhase={
          active === "02-phone"
            ? "waiting"
            : active === "02-wifi-setup"
              ? wifiWaiting
                ? "waiting"
                : "credentials"
              : undefined
        }
        wifiWaitingViaCable={active === "02-wifi-setup"}
        wifiCredentialsSent={wifiWaiting}
        wifiNetworks={[
          { ssid: "Home WiFi", rssi: -48, encrypted: true },
          { ssid: "Guest", rssi: -70, encrypted: false },
        ]}
        onBack={() => goTo("02")}
        onEditWiFi={() => setWiFiWaiting(false)}
        connecting={connecting}
        logLines={
          lines ??
          connectLogLines(
            connectState,
            active === "02-firmware" ? 42 : undefined,
          )
        }
        onConnect={runConnect}
        onChooseTransport={(transport) =>
          goTo(transport === "cable" ? "02-cable" : "02-wifi-setup")
        }
        onConfigureWiFi={async () => {
          setWiFiWaiting(true);
          timers.current.push(setTimeout(() => goTo("03"), 6000));
        }}
        onEnterAddressManually={() => setActive("02b")}
        onSearchAgain={() => setActive("02")}
        onScanWiFiNetworks={() => {}}
        onSelect={(candidate) => setSelected(candidateKey(candidate))}
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
        {
          id: "2",
          at: "14:02:41",
          label: "Search finished",
          detail: "2 found",
        },
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
            onEnterAddressManually={() => setActive("02b")}
            onCreateSupportReport={createSupportReport}
          />
        );
      case "02":
      case "02-cable":
      case "02-cable-connecting":
      case "02-checking":
      case "02-firmware":
      case "02-wifi":
      case "02-wifi-setup":
      case "02-phone":
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
              onUseCable={() => goTo("02-cable")}
              onUseWiFi={() => goTo("02-phone")}
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
              reason="firmware_check_failed"
            />
          </>
        );
      case "03":
      case "03-loading":
        return (
          <SetupProvidersScreen
            aiFixPrompt={aiFixPrompt}
            loading={active === "03-loading"}
            onOpenSignIn={noop}
            onCreateSupportReport={createSupportReport}
            onBack={() => goTo("02")}
            onCheckAgain={noop}
            onContinue={() => goTo("04")}
            onToggle={noop}
            pendingCheckIds={NO_PENDING_CHECKS}
            pendingPreferenceIds={NO_PENDING_CHECKS}
            usage={null}
            providers={PROVIDERS}
          />
        );
      case "03b":
        return (
          <>
            <SetupProvidersScreen
              onCheckAgain={noop}
              onContinue={noop}
              onToggle={noop}
              pendingCheckIds={NO_PENDING_CHECKS}
              pendingPreferenceIds={NO_PENDING_CHECKS}
              usage={null}
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
            manualPreview={
              AUTOMATIC_PREVIEWS.find(
                (preview) =>
                  preview.providerLabel ===
                  (displayProvider === "claude" ? "Claude" : "Codex"),
              ) ?? null
            }
            mode={displayMode}
            theme={{ id: "claude-creature" }}
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
            device={PREVIEW_DEVICE}
            displayFrame={PREVIEW_FRAME}
            usage={null}
          />
        );
    }
  }

  const stepIndex = STEP_ORDER.indexOf(active as Step);

  return (
    <SetupEventsContext.Provider value={loadSampleEvents}>
    <div className="min-h-svh bg-muted">
      <div className="relative">{screen()}</div>
      <details
        className="fixed top-3 right-3 z-70 w-36 rounded-xl bg-foreground/90 p-1.5 text-background shadow-lg"
        open
      >
        <summary className="cursor-pointer px-2.5 py-1 text-xs font-semibold">
          Preview screens
        </summary>
        <nav className="flex flex-col gap-0.5">
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
      </details>
    </div>
    </SetupEventsContext.Provider>
  );
}
