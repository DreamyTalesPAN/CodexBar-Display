"use client";

import { useState, type ReactNode } from "react";
import type { DeviceCandidate } from "../control-center-types";
import {
  SetupAddressDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
} from "./setup-device-dialogs";
import { SetupDeviceScreen } from "./setup-device-screen";
import type { SetupLogLine } from "./setup-log";
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

const CONNECT_LINES: SetupLogLine[] = [
  { id: "1", text: "connecting to 192.168.178.153" },
  { id: "2", text: "connected · VibeTV 5804508" },
  { id: "3", text: "checking firmware version" },
  { id: "4", text: "firmware update available · 1.0.55 → 1.0.61" },
  { id: "5", text: "updating firmware — keep VibeTV powered on" },
];

const FAILED_LINES: SetupLogLine[] = [
  { id: "1", text: "connecting to 192.168.178.153" },
  { id: "2", text: "error: connection could not be completed", tone: "error" },
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
