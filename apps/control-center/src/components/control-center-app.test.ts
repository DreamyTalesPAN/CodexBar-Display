import { describe, expect, it } from "vitest";
import { mergeDeviceInfo, nextProviderIncident } from "./control-center-app";
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

describe("provider incident latch", () => {
  const incident = withStream({
    running: true,
    healthy: false,
    errorCode: "provider_setup_required",
  });

  // Recorded on hardware: pressing Try again unregisters the runtime, every
  // companion request fails, and the app marks the device disconnected. No
  // snapshot arrives at all in that window, so the incident must simply hold.
  // Ending it there dropped the customer onto Overview until the next poll.
  it("holds while the repair has the Mac App down", () => {
    expect(nextProviderIncident(false, incident)).toBe(true);
    expect(nextProviderIncident(true, null)).toBe(true);
    expect(nextProviderIncident(true, incident)).toBe(true);
  });

  it("closes on a snapshot that shows the device is fine again", () => {
    const healthy = withStream({
      running: true,
      healthy: true,
      lastTarget: TARGET,
    });
    expect(nextProviderIncident(true, healthy)).toBe(false);
  });

  it("closes when the device reports a different problem", () => {
    const broken = withStream({
      running: true,
      healthy: false,
      errorCode: "display_send_failed",
    });
    expect(nextProviderIncident(true, broken)).toBe(false);
  });

  it("closes when the VibeTV is genuinely gone, so the connect screen wins", () => {
    const gone = { ...base, connected: false, stream: undefined } as never;
    expect(nextProviderIncident(true, gone)).toBe(false);
  });
});
