"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** What the device reported once it was connected. */
export type ConnectedDevice = { board?: string; firmware?: string };

export type SetupConnectSteps = {
  /**
   * Resolves with the newer version when the device has one to install. Takes
   * the device it just connected to rather than reading app state, which at
   * this point still describes whatever came before.
   */
  checkFirmware: (
    device: ConnectedDevice,
  ) => Promise<{ from: string; to: string } | null>;
  connect: (candidate: DeviceCandidate) => Promise<ConnectedDevice>;
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
export function useSetupConnect(
  steps: SetupConnectSteps,
  /** How far the running firmware install has got, for the frozen log line. */
  firmwareProgress = 0,
  /** Called once the sequence finished: the device step's way forward. */
  onDone?: () => void,
) {
  const [state, setState] = useState<ConnectState>(IDLE);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const progressRef = useRef(0);
  // The device this sequence ran against. Retrying cannot look it up again:
  // a successful connect empties the discovered list, and the device the
  // customer is half way through updating would no longer be in it.
  const candidateRef = useRef<DeviceCandidate | null>(null);

  useEffect(() => {
    progressRef.current = firmwareProgress;
  }, [firmwareProgress]);

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
      candidateRef.current = candidate;
      setState(base);

      let connected: ConnectedDevice = {};
      try {
        connected = await steps.connect(candidate);
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
        firmware = await steps.checkFirmware(connected);
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
        onDone?.();
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
      onDone?.();
    },
    [onDone, steps],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);
  const reset = useCallback(() => {
    setFailure(null);
    candidateRef.current = null;
    setState(IDLE);
  }, []);

  /** Runs the sequence again against the device it last ran against. */
  const retry = useCallback(() => {
    const candidate = candidateRef.current;
    if (candidate) {
      void run(candidate);
    }
  }, [run]);

  return { dismissFailure, failure, reset, retry, run, state };
}
