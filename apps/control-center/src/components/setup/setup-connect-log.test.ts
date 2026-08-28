import { describe, expect, it } from "vitest";
import {
  connectBusyLabel,
  connectLogLines,
  type ConnectState,
} from "./setup-connect-log";

const base: ConnectState = {
  address: "192.168.178.153",
  deviceLabel: "VibeTV 5804508",
  phase: "connecting",
};

const texts = (state: ConnectState) =>
  connectLogLines(state).map((line) => line.text);

describe("connectLogLines", () => {
  it("is silent until a connection is attempted", () => {
    expect(connectLogLines({ ...base, phase: "idle" })).toEqual([]);
  });

  it("does not claim a connection while one is still being made", () => {
    expect(texts(base)).toEqual(["connecting to 192.168.178.153"]);
  });

  it("names the device once it answered, then checks its firmware", () => {
    expect(texts({ ...base, phase: "checking-firmware" })).toEqual([
      "connecting to 192.168.178.153",
      "connected · VibeTV 5804508",
      "checking firmware version",
    ]);
  });

  it("says the firmware is current when no update was found", () => {
    expect(texts({ ...base, phase: "done" })).toContain(
      "firmware is up to date",
    );
  });

  it("reports the version step and the completed update", () => {
    const state: ConnectState = {
      ...base,
      firmwareFrom: "1.0.55",
      firmwareTo: "1.0.61",
      phase: "done",
    };

    expect(texts(state)).toEqual([
      "connecting to 192.168.178.153",
      "connected · VibeTV 5804508",
      "checking firmware version",
      "firmware update available · 1.0.55 → 1.0.61",
      "update complete",
    ]);
  });

  it("freezes the update line at the percent it stopped on", () => {
    const state: ConnectState = {
      ...base,
      firmwareFrom: "1.0.55",
      firmwareTo: "1.0.61",
      failedAt: "updating-firmware",
      updateProgress: 55,
      errorText: "update did not finish",
      phase: "failed",
    };
    const lines = connectLogLines(state);

    expect(lines.map((line) => line.text)).toContain(
      "updating firmware — stopped at 55%",
    );
    expect(lines.at(-1)).toEqual({
      id: "error",
      text: "error: update did not finish",
      tone: "error",
    });
    expect(lines.filter((line) => line.tone === "error")).toHaveLength(1);
  });

  it("keeps a failed connection from claiming the device answered", () => {
    const state: ConnectState = {
      ...base,
      failedAt: "connecting",
      errorText: "connection could not be completed",
      phase: "failed",
    };

    expect(texts(state)).toEqual([
      "connecting to 192.168.178.153",
      "error: connection could not be completed",
    ]);
  });

  it("never repeats a line when the same state is derived twice", () => {
    const state: ConnectState = { ...base, phase: "updating-firmware", firmwareFrom: "1.0.55", firmwareTo: "1.0.61" };
    const ids = connectLogLines(state).map((line) => line.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(connectLogLines(state)).toEqual(connectLogLines(state));
  });

  it("labels the running button with the phase the customer is waiting on", () => {
    expect(connectBusyLabel("connecting")).toBe("Connecting");
    expect(connectBusyLabel("checking-firmware")).toBe("Checking firmware");
    expect(connectBusyLabel("updating-firmware")).toBe("Updating firmware");
  });
});
