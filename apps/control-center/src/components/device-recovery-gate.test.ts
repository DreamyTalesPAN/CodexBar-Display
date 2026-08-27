import { describe, expect, it } from "vitest";
import {
  applyDeviceRecoveryStatus,
  createDeviceRecoveryGateState,
  DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT,
  DEVICE_RECOVERY_OPERATION_FAILURE_LIMIT,
  deviceRecoveryConfirmedLoss,
  openManualRecoveryPicker,
  selectRecoveryDevice,
} from "./device-recovery-gate";

describe("device recovery gate", () => {
  it("keeps the preferred VibeTV through the first two normal failures", () => {
    let state = selectRecoveryDevice(createDeviceRecoveryGateState(), {
      deviceId: "stable-a",
    });

    const first = applyDeviceRecoveryStatus(state, {
      device: { connected: false, deviceId: "stable-a", target: "192.0.2.10" },
    });
    expect(first.openPicker).toBe(false);
    expect(first.state.failedNormalChecks).toBe(1);

    const second = applyDeviceRecoveryStatus(first.state, { device: null });
    expect(second.openPicker).toBe(false);
    expect(second.state.preferredDeviceId).toBe("stable-a");
    expect(second.state.failedNormalChecks).toBe(2);

    state = second.state;
    expect(state.pickerReason).toBeNull();
  });

  it("opens the recovery picker once on the third normal failure", () => {
    let state = selectRecoveryDevice(createDeviceRecoveryGateState(), {
      deviceId: "stable-a",
    });

    state = applyDeviceRecoveryStatus(state, { device: null }).state;
    state = applyDeviceRecoveryStatus(state, { device: null }).state;
    const third = applyDeviceRecoveryStatus(state, { device: null });
    const fourth = applyDeviceRecoveryStatus(third.state, { device: null });

    expect(third.openPicker).toBe(true);
    expect(third.state.pickerReason).toBe("confirmed-loss");
    expect(fourth.openPicker).toBe(false);
    expect(fourth.state.pickerReason).toBe("confirmed-loss");
  });

  it("does not count initial or diagnostic reads as recovery failures", () => {
    const state = selectRecoveryDevice(createDeviceRecoveryGateState(), {
      deviceId: "stable-a",
    });

    const result = applyDeviceRecoveryStatus(state, {
      device: null,
      countFailure: false,
    });

    expect(result.openPicker).toBe(false);
    expect(result.state.failedNormalChecks).toBe(0);
  });

  it("uses a longer grace while firmware or theme operations are running", () => {
    let state = selectRecoveryDevice(createDeviceRecoveryGateState(), {
      deviceId: "stable-a",
    });

    for (let index = 1; index < DEVICE_RECOVERY_OPERATION_FAILURE_LIMIT; index += 1) {
      const result = applyDeviceRecoveryStatus(state, {
        device: null,
        operationInProgress: true,
      });
      expect(result.openPicker).toBe(false);
      state = result.state;
    }

    const threshold = applyDeviceRecoveryStatus(state, {
      device: null,
      operationInProgress: true,
    });
    expect(threshold.openPicker).toBe(true);
  });

  it("auto-closes a confirmed-loss picker when the preferred VibeTV reappears", () => {
    let state = selectRecoveryDevice(createDeviceRecoveryGateState(), {
      deviceId: "stable-a",
    });
    state = applyDeviceRecoveryStatus(state, { device: null }).state;
    state = applyDeviceRecoveryStatus(state, { device: null }).state;
    state = applyDeviceRecoveryStatus(state, { device: null }).state;

    const result = applyDeviceRecoveryStatus(state, {
      device: { connected: true, deviceId: "stable-a", target: "192.0.2.10" },
    });

    expect(result.acceptDevice).toBe(true);
    expect(result.closePicker).toBe(true);
    expect(result.state.pickerReason).toBeNull();
  });

  it("does not auto-close a manual picker for the old preferred VibeTV", () => {
    const state = openManualRecoveryPicker(
      selectRecoveryDevice(createDeviceRecoveryGateState(), {
        deviceId: "stable-a",
      }),
    );

    const result = applyDeviceRecoveryStatus(state, {
      device: { connected: true, deviceId: "stable-a", target: "192.0.2.10" },
    });

    expect(result.acceptDevice).toBe(true);
    expect(result.closePicker).toBe(false);
    expect(result.state.pickerReason).toBe("manual");
  });

  it("rejects a different device while a preferred ID exists", () => {
    const state = selectRecoveryDevice(createDeviceRecoveryGateState(), {
      deviceId: "stable-a",
    });

    const result = applyDeviceRecoveryStatus(state, {
      device: { connected: true, deviceId: "stable-b", target: "192.0.2.20" },
    });

    expect(result.acceptDevice).toBe(false);
    expect(result.state.preferredDeviceId).toBe("stable-a");
  });
});

describe("deviceRecoveryConfirmedLoss", () => {
  const selected = {
    connected: true,
    deviceId: "device-a",
    target: "http://192.168.178.72",
  };

  it("does not call a missed poll a loss", () => {
    let state = applyDeviceRecoveryStatus(createDeviceRecoveryGateState(), {
      device: selected,
    }).state;

    // Every miss below the limit. A provider incident must survive all of them:
    // the native repair takes the Mac App down on purpose.
    for (let i = 1; i < DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT; i += 1) {
      const miss = applyDeviceRecoveryStatus(state, { device: null });
      expect(deviceRecoveryConfirmedLoss(miss)).toBe(false);
      state = miss.state;
    }

    const limit = applyDeviceRecoveryStatus(state, { device: null });
    expect(limit.openPicker).toBe(true);
    expect(deviceRecoveryConfirmedLoss(limit)).toBe(true);

    // openPicker goes false again once the picker already says confirmed-loss.
    // Reading only that half would call the device present again.
    const after = applyDeviceRecoveryStatus(limit.state, { device: null });
    expect(after.openPicker).toBe(false);
    expect(deviceRecoveryConfirmedLoss(after)).toBe(true);
  });
});
