"use client";

import { useCallback, useRef, useState } from "react";
import type { ApiError, DeviceCandidate } from "../control-center-types";
import type { ConnectPhase, ConnectState } from "./setup-connect-log";
import {
  firmwareBlockedReason,
  type FirmwareBlockedReason,
} from "./setup-firmware-dialogs";

/** Which dialog a failed connect should open. */
export type ConnectFailure =
  | { kind: "connect"; description: string; title: string }
  | { kind: "firmware-blocked"; reason: FirmwareBlockedReason }
  | { kind: "firmware-update" };

export type SetupConnectSteps = {
  /** Resolves with the newer version when the device has one to install. */
  checkFirmware: () => Promise<{ from: string; to: string } | null>;
  connect: (candidate: DeviceCandidate) => Promise<void>;
  installFirmware: () => Promise<void>;
};

const IDLE: ConnectState = { address: "", phase: "idle" };

/**
 * Runs the whole connect sequence — pair, check the firmware, and install it
 * when there is one — and records where it got to.
 *
 * The firmware work lives here rather than on a screen of its own because that
 * is what the customer pressed Connect for: VibeTV is not theirs to use until
 * its firmware matches the app driving it.
 */
export function useSetupConnect(steps: SetupConnectSteps) {
  const [state, setState] = useState<ConnectState>(IDLE);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const progressRef = useRef(0);

  const reportProgress = useCallback((percent: number) => {
    progressRef.current = percent;
    setState((current) =>
      current.phase === "updating-firmware"
        ? { ...current, updateProgress: percent }
        : current,
    );
  }, []);

  const run = useCallback(
    async (candidate: DeviceCandidate) => {
      const address = candidate.target.replace(/^https?:\/\//i, "");
      const deviceLabel = candidate.deviceId
        ? `VibeTV ${candidate.deviceId}`
        : undefined;
      const base: ConnectState = { address, deviceLabel, phase: "connecting" };
      let reached: ConnectPhase = "connecting";
      let firmware: { from: string; to: string } | null = null;

      const fail = (next: ConnectFailure, errorText: string) => {
        setState({
          ...base,
          errorText,
          failedAt: reached as ConnectState["failedAt"],
          firmwareFrom: firmware?.from,
          firmwareTo: firmware?.to,
          phase: "failed",
          updateProgress: progressRef.current,
        });
        setFailure(next);
      };

      setFailure(null);
      progressRef.current = 0;
      setState(base);

      try {
        await steps.connect(candidate);
      } catch (error) {
        const api = error as ApiError;
        fail(
          {
            kind: "connect",
            description:
              api?.nextAction ||
              "Keep VibeTV powered on, then search again.",
            title: api?.message || "VibeTV could not connect",
          },
          api?.message || "connection could not be completed",
        );
        return;
      }

      reached = "checking-firmware";
      setState({ ...base, phase: "checking-firmware" });

      try {
        firmware = await steps.checkFirmware();
      } catch (error) {
        const api = error as ApiError;
        const blocked = firmwareBlockedReason(api?.code);
        fail(
          blocked
            ? { kind: "firmware-blocked", reason: blocked }
            : { kind: "firmware-update" },
          api?.message || "firmware version could not be read",
        );
        return;
      }

      if (!firmware) {
        setState({ ...base, phase: "done" });
        return;
      }

      reached = "updating-firmware";
      setState({
        ...base,
        firmwareFrom: firmware.from,
        firmwareTo: firmware.to,
        phase: "updating-firmware",
        updateProgress: 0,
      });

      try {
        await steps.installFirmware();
      } catch (error) {
        const api = error as ApiError;
        const blocked = firmwareBlockedReason(api?.code);
        fail(
          blocked
            ? { kind: "firmware-blocked", reason: blocked }
            : { kind: "firmware-update" },
          api?.message || "update did not finish",
        );
        return;
      }

      setState({
        ...base,
        firmwareFrom: firmware.from,
        firmwareTo: firmware.to,
        phase: "done",
      });
    },
    [steps],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);
  const reset = useCallback(() => {
    setFailure(null);
    setState(IDLE);
  }, []);

  return { dismissFailure, failure, reportProgress, reset, run, state };
}
