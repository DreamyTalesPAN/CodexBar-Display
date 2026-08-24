import type { DeviceInfo } from "./control-center-types";

export const DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT = 3;
export const DEVICE_RECOVERY_OPERATION_FAILURE_LIMIT = 12;

export type DeviceRecoveryPickerReason = "confirmed-loss" | "manual";

export type DeviceRecoveryGateState = {
  preferredDeviceId: string;
  failedNormalChecks: number;
  pickerReason: DeviceRecoveryPickerReason | null;
};

export type DeviceRecoveryGateResult = {
  acceptDevice: boolean;
  closePicker: boolean;
  openPicker: boolean;
  state: DeviceRecoveryGateState;
};

// The device is gone, as opposed to having missed a poll. Only the failure
// limit decides that: openPicker stays false until it is reached, and false
// again on every later poll once the picker already says "confirmed-loss".
// Reading either half alone as loss ends a provider incident on the first
// transient miss, which relaunches the automatic repair instead of leaving the
// customer on the approved Try again.
export function deviceRecoveryConfirmedLoss(
  result: DeviceRecoveryGateResult,
): boolean {
  return result.openPicker || result.state.pickerReason === "confirmed-loss";
}

export function createDeviceRecoveryGateState(): DeviceRecoveryGateState {
  return {
    preferredDeviceId: "",
    failedNormalChecks: 0,
    pickerReason: null,
  };
}

export function resetDeviceRecoveryGate(): DeviceRecoveryGateState {
  return createDeviceRecoveryGateState();
}

export function selectRecoveryDevice(
  state: DeviceRecoveryGateState,
  device: Pick<DeviceInfo, "deviceId"> | null | undefined,
): DeviceRecoveryGateState {
  return {
    ...state,
    preferredDeviceId: stableDeviceId(device) || state.preferredDeviceId,
    failedNormalChecks: 0,
    pickerReason: null,
  };
}

export function openManualRecoveryPicker(
  state: DeviceRecoveryGateState,
): DeviceRecoveryGateState {
  return {
    ...state,
    failedNormalChecks: 0,
    pickerReason: "manual",
  };
}

export function applyDeviceRecoveryStatus(
  state: DeviceRecoveryGateState,
  status: {
    device?: Pick<DeviceInfo, "connected" | "deviceId" | "target"> | null;
    countFailure?: boolean;
    operationInProgress?: boolean;
  },
): DeviceRecoveryGateResult {
  const deviceId = stableDeviceId(status.device);
  const preferredDeviceId = state.preferredDeviceId || deviceId;
  const deviceMatchesPreferred =
    Boolean(deviceId) && (!preferredDeviceId || deviceId === preferredDeviceId);
  const selectedDeviceReachable =
    Boolean(status.device?.target) &&
    status.device?.connected !== false &&
    deviceMatchesPreferred;

  if (selectedDeviceReachable) {
    const closePicker = state.pickerReason === "confirmed-loss";
    return {
      acceptDevice: true,
      closePicker,
      openPicker: false,
      state: {
        preferredDeviceId,
        failedNormalChecks: 0,
        pickerReason: state.pickerReason === "manual" ? "manual" : null,
      },
    };
  }

  if (!preferredDeviceId) {
    return {
      acceptDevice: false,
      closePicker: false,
      openPicker: false,
      state: {
        ...state,
        failedNormalChecks: 0,
      },
    };
  }

  if (status.countFailure === false) {
    return {
      acceptDevice: false,
      closePicker: false,
      openPicker: false,
      state,
    };
  }

  const failedNormalChecks = state.failedNormalChecks + 1;
  const failureLimit = status.operationInProgress
    ? DEVICE_RECOVERY_OPERATION_FAILURE_LIMIT
    : DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT;
  const openPicker =
    failedNormalChecks >= failureLimit && state.pickerReason !== "confirmed-loss";

  return {
    acceptDevice: false,
    closePicker: false,
    openPicker,
    state: {
      preferredDeviceId,
      failedNormalChecks,
      pickerReason: openPicker ? "confirmed-loss" : state.pickerReason,
    },
  };
}

function stableDeviceId(
  device: Pick<DeviceInfo, "deviceId"> | null | undefined,
): string {
  return device?.deviceId?.trim() || "";
}
