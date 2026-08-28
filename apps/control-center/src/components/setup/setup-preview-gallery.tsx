"use client";

import { useState, type ReactNode } from "react";
import type { DeviceCandidate } from "../control-center-types";
import {
  SetupAddressDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
} from "./setup-device-dialogs";
import { SetupDeviceScreen } from "./setup-device-screen";
import {
  SetupFirmwareBlockedDialog,
  SetupFirmwareUpdateFailedDialog,
} from "./setup-firmware-dialogs";
import { SetupDisplayModeScreen } from "./setup-display-mode-screen";
import type { SetupLogLine } from "./setup-log";
import { SetupProvidersScreen } from "./setup-providers-screen";
import { SetupThemeScreen } from "./setup-theme-screen";
import { SetupUsageDialog } from "./setup-usage-dialog";
import { SetupWelcomeScreen } from "./setup-welcome-screen";
import type { PreferenceHealthState } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";

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

const CONNECT_LINES: SetupLogLine[] = [
  { id: "1", text: "connecting to 192.168.178.153" },
  { id: "2", text: "connected · VibeTV 5804508" },
  { id: "3", text: "checking firmware version" },
  { id: "4", text: "firmware update available · 1.0.55 → 1.0.61" },
  { id: "5", text: "updating firmware — keep VibeTV powered on" },
];

const UPDATE_FAILED_LINES: SetupLogLine[] = [
  ...CONNECT_LINES.slice(0, 4),
  { id: "5", text: "updating firmware — stopped at 55%" },
  { id: "6", text: "error: update did not finish", tone: "error" },
];

const FAILED_LINES: SetupLogLine[] = [
  { id: "1", text: "connecting to 192.168.178.153" },
  { id: "2", text: "error: connection could not be completed", tone: "error" },
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

/**
 * Development-only gallery for the setup steps, mirroring the internal UI kit
 * route. It is how each screen is checked against the design before the wizard
 * is wired into the app.
 */
export function SetupPreviewGallery() {
  const [active, setActive] = useState("01");
  const [dialogOpen, setDialogOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(CANDIDATES[0].target);
  const [displayMode, setDisplayMode] = useState<"automatic" | "fixed">(
    "automatic",
  );
  const [displayProvider, setDisplayProvider] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<string | null>("clippy");

  const noop = () => undefined;

  function deviceScreen(options: {
    connecting?: boolean;
    busyLabel?: string;
    lines?: SetupLogLine[];
  } = {}) {
    return (
      <SetupDeviceScreen
        busyLabel={options.busyLabel}
        candidates={CANDIDATES}
        connecting={options.connecting}
        logLines={options.lines ?? []}
        onConnect={noop}
        onEnterAddressManually={noop}
        onSelect={(candidate) => setSelected(candidate.target)}
        selectedTarget={selected}
      />
    );
  }

  const entries: { id: string; label: string; render: () => ReactNode }[] = [
    {
      id: "01",
      label: "01 Welcome",
      render: () => <SetupWelcomeScreen lines={WELCOME_LINES} />,
    },
    { id: "02", label: "02 Choose", render: () => deviceScreen() },
    {
      id: "02-connect",
      label: "02 Connecting",
      render: () =>
        deviceScreen({
          connecting: true,
          busyLabel: "Updating firmware",
          lines: CONNECT_LINES,
        }),
    },
    {
      id: "02b",
      label: "02b Enter IP",
      render: () => (
        <>
          {deviceScreen()}
          <SetupAddressDialog
            onConnect={noop}
            onOpenChange={setDialogOpen}
            open={dialogOpen}
          />
        </>
      ),
    },
    {
      id: "02c",
      label: "02c Not found",
      render: () => (
        <>
          <SetupWelcomeScreen lines={WELCOME_LINES} />
          <SetupDeviceNotFoundDialog
            onEnterAddressManually={noop}
            onOpenChange={setDialogOpen}
            onScanAgain={noop}
            open={dialogOpen}
          />
        </>
      ),
    },
    {
      id: "02d",
      label: "02d Connect failed",
      render: () => (
        <>
          {deviceScreen({ lines: FAILED_LINES })}
          <SetupConnectFailedDialog
            description="It was found, but the connection could not be completed. Keep VibeTV powered on, then search again."
            onEnterAddressManually={noop}
            onOpenChange={setDialogOpen}
            onSearchAgain={noop}
            open={dialogOpen}
            title="VibeTV could not connect"
          />
        </>
      ),
    },
    {
      id: "02f",
      label: "02f Update failed",
      render: () => (
        <>
          {deviceScreen({ lines: UPDATE_FAILED_LINES })}
          <SetupFirmwareUpdateFailedDialog
            onCreateSupportReport={noop}
            onOpenChange={setDialogOpen}
            onRetry={noop}
            open={dialogOpen}
          />
        </>
      ),
    },
    {
      id: "02g",
      label: "02g App behind",
      render: () => (
        <>
          {deviceScreen({ lines: CONNECT_LINES.slice(0, 4) })}
          <SetupFirmwareBlockedDialog
            onOpenChange={setDialogOpen}
            onResolve={noop}
            open={dialogOpen}
            reason="mac_app_update_required"
          />
        </>
      ),
    },
    {
      id: "03",
      label: "03 Providers",
      render: () => (
        <SetupProvidersScreen
          onBack={noop}
          onCheckAgain={noop}
          onContinue={noop}
          onRecover={noop}
          onToggle={noop}
          providers={PROVIDERS}
        />
      ),
    },
    {
      id: "03b",
      label: "03b Usage failed",
      render: () => (
        <>
          <SetupProvidersScreen
            onCheckAgain={noop}
            onContinue={noop}
            onRecover={noop}
            onToggle={noop}
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
      ),
    },
    {
      id: "04",
      label: "04 Display Mode",
      render: () => (
        <SetupDisplayModeScreen
          automaticPreview={{
            providerLabel: "Codex",
            resetLabel: "RESET IN 3H",
            sessionPercent: 42,
            weeklyPercent: 26,
          }}
          manualPreview={{
            providerLabel: "Claude",
            resetLabel: "RESET IN 5H",
            sessionPercent: 45,
            weeklyPercent: 26,
          }}
          mode={displayMode}
          onBack={noop}
          onContinue={noop}
          onSelectMode={setDisplayMode}
          onSelectProvider={setDisplayProvider}
          providers={[
            { id: "codex", label: "Codex" },
            { id: "cursor", label: "Cursor" },
            { id: "claude", label: "Claude" },
          ]}
          selectedProviderId={displayProvider}
        />
      ),
    },
    {
      id: "05",
      label: "05 Theme",
      render: () => (
        <SetupThemeScreen
          onBack={noop}
          onInstall={noop}
          onSelect={(theme) => setThemeId(theme.id)}
          selectedThemeId={themeId}
          themes={THEMES}
        />
      ),
    },
  ];

  const current = entries.find((entry) => entry.id === active) ?? entries[0];

  return (
    <div className="min-h-svh bg-muted">
      <nav className="fixed top-2 left-1/2 z-70 flex -translate-x-1/2 flex-wrap gap-1 rounded-full bg-foreground/90 p-1.5 shadow-lg">
        {entries.map((entry) => (
          <button
            className={
              entry.id === active
                ? "rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground"
                : "rounded-full px-3 py-1 text-xs font-semibold text-background/70 hover:text-background"
            }
            key={entry.id}
            onClick={() => {
              setActive(entry.id);
              setDialogOpen(true);
            }}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="relative">{current.render()}</div>
    </div>
  );
}
