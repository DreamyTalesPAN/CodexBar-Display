import { describe, expect, it } from "vitest";
import {
  connectionModeChoiceStatus,
  statusConfirmsSubmittedWiFiChoice,
  mergeDeviceInfo,
} from "./control-center-app";
import { deviceAwaitsProviderSetup } from "./control-center-types";

const TARGET = "http://192.168.178.153";

const base = {
  target: TARGET,
  deviceId: "5804508",
  active: true,
  connected: true,
  paired: true,
  ready: false,
  health: { ok: true },
};

const withStream = (stream: Record<string, unknown>) =>
  ({ ...base, stream: { target: TARGET, ...stream } }) as never;

describe("device snapshot funnel", () => {
  // Recorded on hardware while a repair ran: the stream error blinks away for a
  // single poll while the stream restarts. Ending the incident there dropped the
  // customer into Overview and back onto "CodexBar is needed" three seconds
  // later.
  it("keeps a provider incident across a quiet sample", () => {
    const incident = withStream({
      running: true,
      healthy: false,
      errorCode: "provider_setup_required",
      detail: "VibeTV is connected, but AI usage is not ready yet.",
    });
    const blink = withStream({ running: true, healthy: false });

    const merged = mergeDeviceInfo(incident, blink);

    expect(merged.stream?.errorCode).toBe("provider_setup_required");
    expect(deviceAwaitsProviderSetup(merged)).toBe(true);
  });

  it("ends the incident on evidence that the device draws again", () => {
    const incident = withStream({
      running: true,
      healthy: false,
      errorCode: "provider_setup_required",
    });
    const healthy = withStream({
      running: true,
      healthy: true,
      lastTarget: TARGET,
    });

    const merged = mergeDeviceInfo(incident, healthy);

    expect(merged.stream?.errorCode).toBeUndefined();
    expect(deviceAwaitsProviderSetup(merged)).toBe(false);
  });

  it("never masks a different failure with the provider incident", () => {
    const incident = withStream({
      running: true,
      healthy: false,
      errorCode: "provider_setup_required",
    });
    const broken = withStream({
      running: true,
      healthy: false,
      errorCode: "display_send_failed",
    });

    expect(mergeDeviceInfo(incident, broken).stream?.errorCode).toBe(
      "display_send_failed",
    );
  });

  it("does not invent an incident that never existed", () => {
    const quiet = withStream({ running: true, healthy: false });
    expect(mergeDeviceInfo(quiet, quiet).stream?.errorCode).toBeUndefined();
  });
});

describe("connection mode choice status", () => {
  it("keeps observing an empty early startup snapshot", () => {
    expect(
      connectionModeChoiceStatus({
        connectionModeChoiceRequired: false,
        device: { connected: false },
      }),
    ).toEqual({ required: true, resolved: false });
  });

  it("resumes Cable-free WiFi discovery after a reload", () => {
    expect(
      connectionModeChoiceStatus({
        connectionMode: "wifi",
        connectionModeChoiceRequired: false,
        device: { connected: false },
      }),
    ).toEqual({ required: false, resolved: true });
  });

  it("keeps the chooser once Cable auto-binding requires it", () => {
    expect(
      connectionModeChoiceStatus({
        connectionModeChoiceRequired: true,
        device: { ...base, target: "Cable" },
      }),
    ).toEqual({ required: true, resolved: true });
  });

  it("accepts an existing saved device as a completed choice", () => {
    expect(
      connectionModeChoiceStatus({
        connectionModeChoiceRequired: false,
        device: base,
      }),
    ).toEqual({ required: false, resolved: true });
  });

  it("finishes a submitted WiFi choice only after active WiFi confirmation", () => {
    expect(
      statusConfirmsSubmittedWiFiChoice({
        connectionModeChoiceRequired: false,
        device: {
          ...base,
          active: true,
          target: "http://192.168.1.42",
        },
      }),
    ).toBe(true);
    expect(
      statusConfirmsSubmittedWiFiChoice({
        connectionModeChoiceRequired: false,
        device: {
          ...base,
          active: true,
          target: "cable://vibetv",
        },
      }),
    ).toBe(false);
  });
});

describe("provider incident", () => {
  // The incident is open exactly when the merged device says so. It holds
  // across a repair because no snapshot arrives at all while the Mac App is
  // down — the disconnect paths write through setDevice, which never
  // recomputes it.
  it("is open for a device that awaits provider setup", () => {
    expect(
      deviceAwaitsProviderSetup(
        withStream({
          running: true,
          healthy: false,
          errorCode: "provider_setup_required",
        }),
      ),
    ).toBe(true);
  });

  it("is closed once the device draws again", () => {
    expect(
      deviceAwaitsProviderSetup(
        withStream({ running: true, healthy: true, lastTarget: TARGET }),
      ),
    ).toBe(false);
  });
});
