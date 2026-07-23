import { describe, expect, it } from "vitest";
import {
  deviceIsActive,
  deviceIsReady,
  deviceNeedsExplicitConnect,
} from "./control-center-types";

describe("device connection contract", () => {
  it("only treats an explicit ready=true as connected", () => {
    expect(
      deviceIsReady({
        connected: true,
        paired: true,
        ready: false,
        connectionState: "ready",
        stream: { healthy: true, running: true },
      }),
    ).toBe(false);
    expect(deviceIsReady({ connected: true, ready: true })).toBe(true);
  });

  it("only treats an explicit active=true as a completed relationship", () => {
    expect(
      deviceIsActive({
        connected: true,
        deviceId: "14799300",
        known: true,
        ready: false,
      }),
    ).toBe(false);
    expect(deviceIsActive({ active: true, connected: false, ready: false })).toBe(
      true,
    );
  });

  it("never flashes Connected during fast reachable-before-ready updates", () => {
    const updates = [
      { connected: false, ready: false },
      { connected: true, paired: undefined, ready: false },
      { connected: true, paired: true, ready: false },
      { connected: true, paired: true, ready: true },
    ];

    expect(updates.map(deviceIsReady)).toEqual([false, false, false, true]);
  });

  it("returns a reachable device with a missing key to the Connect screen", () => {
    expect(
      deviceNeedsExplicitConnect({
        active: true,
        connected: true,
        paired: false,
        ready: false,
        stream: {
          running: true,
          healthy: false,
          errorCode: "device_pairing_required",
        },
      }),
    ).toBe(true);
  });

  it("does not replace normal reconnecting or offline screens with Connect", () => {
    expect(
      deviceNeedsExplicitConnect({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        connectionState: "reconnecting",
      }),
    ).toBe(false);
    expect(
      deviceNeedsExplicitConnect({
        active: true,
        connected: false,
        paired: false,
        ready: false,
      }),
    ).toBe(false);
  });
});
