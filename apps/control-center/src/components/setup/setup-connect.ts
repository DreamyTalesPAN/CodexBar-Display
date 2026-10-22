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
  | { kind: "connect"; code?: string; description: string; title: string }
  | { kind: "firmware-blocked"; reason: FirmwareBlockedReason }
  | { kind: "firmware-attention"; description: string }
  | { kind: "firmware-update" };

/** What the device reported once it was connected. */
export type ConnectedDevice = {
  board?: string;
  firmware?: string;
  /** Needs the Cable rescue update before it can be connected at all. */
  rescue?: boolean;
};

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
  installFirmware: (device: ConnectedDevice) => Promise<void>;
  /**
   * True once the display stream is sending frames to the VibeTV. Asked after
   * an update that left the firmware current but the stream not yet seen, so
   * setup can carry on by itself when the frames arrive (#826).
   */
  streamRecovered?: () => Promise<boolean>;
};

/** The update error that means only the stream was not seen yet. */
export const FIRMWARE_STREAM_ATTENTION_CODE = "firmware_update_stream_attention";

/** How often, and how many times, setup looks for the stream to come back. */
export const STREAM_RECOVERY_POLL_MS = 3000;
export const STREAM_RECOVERY_ATTEMPTS = 40;

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
  // Bumped whenever the sequence starts again, is reset, or goes away, so a
  // stream watch left over from an earlier run never finishes a newer one.
  const runIdRef = useRef(0);
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);
  useEffect(
    () => () => {
      runIdRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    progressRef.current = firmwareProgress;
  }, [firmwareProgress]);

  const run = useCallback(
    async (candidate: DeviceCandidate) => {
      const runId = ++runIdRef.current;
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
            code: api?.code,
            description:
              api?.nextAction ||
              "VibeTV answered, but the connection did not finish. Check that it is on the same WiFi, then search again.",
            title: api?.message || "We couldn't connect to your VibeTV",
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
        await steps.installFirmware(connected);
      } catch (error) {
        const api = error as ApiError;
        if (
          api?.code === "firmware_update_attention" ||
          api?.code === FIRMWARE_STREAM_ATTENTION_CODE
        ) {
          fail(
            { kind: "firmware-attention", description: api.message },
            api.message,
          );
          if (
            api.code === FIRMWARE_STREAM_ATTENTION_CODE &&
            stepsRef.current.streamRecovered
          ) {
            // The firmware is current and only the first frames were missing
            // when the Companion looked. Frames that arrive afterwards mean
            // the failure was not one, so setup carries on without the customer.
            void (async () => {
              for (let attempt = 0; attempt < STREAM_RECOVERY_ATTEMPTS; attempt += 1) {
                await new Promise((resolve) =>
                  setTimeout(resolve, STREAM_RECOVERY_POLL_MS),
                );
                if (runIdRef.current !== runId) {
                  return;
                }
                let recovered = false;
                try {
                  recovered =
                    (await stepsRef.current.streamRecovered?.()) === true;
                } catch {
                  recovered = false;
                }
                if (runIdRef.current !== runId) {
                  return;
                }
                if (recovered) {
                  setFailure(null);
                  setState({
                    ...base,
                    firmwareFrom: firmware?.from,
                    firmwareTo: firmware?.to,
                    phase: "done",
                  });
                  onDone?.();
                  return;
                }
              }
            })();
          }
          return;
        }
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
    runIdRef.current += 1;
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
