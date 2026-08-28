import type { SetupLogLine } from "./setup-log";

/**
 * Where the connect sequence stands. Firmware is checked and, if needed,
 * installed inside this sequence rather than on a screen of its own.
 */
export type ConnectPhase =
  | "idle"
  | "connecting"
  | "checking-firmware"
  | "updating-firmware"
  | "done"
  | "failed";

export type ConnectState = {
  address: string;
  deviceLabel?: string;
  /** Set once the firmware check found a newer build. */
  firmwareFrom?: string;
  firmwareTo?: string;
  /** Where a failure struck, so the log can freeze at the right line. */
  failedAt?: Exclude<ConnectPhase, "idle" | "done" | "failed">;
  errorText?: string;
  phase: ConnectPhase;
  updateProgress?: number;
};

const BUSY_LABELS: Record<ConnectPhase, string> = {
  idle: "Connect",
  connecting: "Connecting",
  "checking-firmware": "Checking firmware",
  "updating-firmware": "Updating firmware",
  done: "Connected",
  failed: "Connect",
};

export function connectBusyLabel(phase: ConnectPhase): string {
  return BUSY_LABELS[phase];
}

/**
 * Derives the whole log from the current state instead of appending to it, so
 * a retry or a re-render can never duplicate or drop a line.
 */
export function connectLogLines(state: ConnectState): SetupLogLine[] {
  const { phase } = state;
  if (phase === "idle") {
    return [];
  }
  const reached = phase === "failed" ? (state.failedAt ?? "connecting") : phase;
  const lines: SetupLogLine[] = [
    { id: "connecting", text: `connecting to ${state.address}` },
  ];

  if (reached !== "connecting") {
    lines.push({
      id: "connected",
      text: state.deviceLabel
        ? `connected · ${state.deviceLabel}`
        : "connected",
    });
    lines.push({ id: "firmware-check", text: "checking firmware version" });
  }

  const hasUpdate = Boolean(state.firmwareFrom && state.firmwareTo);
  if (hasUpdate) {
    lines.push({
      id: "firmware-available",
      text: `firmware update available · ${state.firmwareFrom} → ${state.firmwareTo}`,
    });
  }

  if (reached === "updating-firmware") {
    lines.push({
      id: "firmware-updating",
      text:
        phase === "failed"
          ? `updating firmware — stopped at ${state.updateProgress ?? 0}%`
          : "updating firmware — keep VibeTV powered on",
    });
  }

  if (phase === "done") {
    lines.push({
      id: "done",
      text: hasUpdate ? "update complete" : "firmware is up to date",
    });
  }

  if (phase === "failed" && state.errorText) {
    lines.push({ id: "error", text: `error: ${state.errorText}`, tone: "error" });
  }

  return lines;
}
