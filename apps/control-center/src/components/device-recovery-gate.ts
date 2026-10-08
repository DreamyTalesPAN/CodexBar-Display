import {
  deviceIsCustomerConnected,
  type DeviceInfo,
} from "./control-center-types";

export const DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT = 3;

export type DeviceRecoveryPickerReason = "confirmed-loss";

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

// Closing the lost-VibeTV picker means "not now", not "stop looking". The
// failure count starts over, so the VibeTV still being missing after the next
// three checks searches again and can offer the found VibeTVs once more.
// Keeping "confirmed-loss" here left the customer without any way back to the
// moved VibeTV until the app was restarted.
export function dismissDeviceRecoveryPicker(
  state: DeviceRecoveryGateState,
): DeviceRecoveryGateState {
  return { ...state, failedNormalChecks: 0, pickerReason: null };
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

export function applyDeviceRecoveryStatus(
  state: DeviceRecoveryGateState,
  status: {
    device?: Pick<
      DeviceInfo,
      "active" | "connected" | "deviceId" | "paired" | "target"
    > | null;
    countFailure?: boolean;
    operationInProgress?: boolean;
  },
): DeviceRecoveryGateResult {
  const deviceId = stableDeviceId(status.device);
  // The Companion owns which VibeTV is bound. Once it reports its own VibeTV
  // as connected -- what the Overview calls connected -- that VibeTV is the
  // selected one, even when this window still remembers another. Holding on
  // to the remembered ID counted every such status as a miss: after the
  // connection was changed outside this window, it declared the old VibeTV
  // lost and showed "Not connected" over a working one until a reload.
  // A VibeTV that merely answers at the address (not active) is still foreign.
  const preferredDeviceId =
    (deviceIsCustomerConnected(status.device) && deviceId) ||
    state.preferredDeviceId ||
    deviceId;
  const deviceMatchesPreferred =
    Boolean(deviceId) && (!preferredDeviceId || deviceId === preferredDeviceId);
  const selectedDeviceReachable =
    Boolean(status.device?.target) &&
    status.device?.connected !== false &&
    deviceMatchesPreferred;

  // An offline snapshot still carries the Companion's configured identity and
  // pairing verdict. Accept it without calling it reachable or resetting loss.
  const acceptConfiguredDevice =
    Boolean(status.device?.target) &&
    status.device?.active === true &&
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
        pickerReason: null,
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

  // A running firmware or theme job owns its own outcome. A USB firmware
  // upload takes about five minutes with the VibeTV unreachable throughout,
  // so counting those misses declared it lost mid-update and started a
  // search the Companion refuses while the update runs.
  if (status.countFailure === false || status.operationInProgress) {
    return {
      acceptDevice: acceptConfiguredDevice,
      closePicker: false,
      openPicker: false,
      state: { ...state, preferredDeviceId },
    };
  }

  const failedNormalChecks = state.failedNormalChecks + 1;
  const openPicker =
    failedNormalChecks >= DEVICE_RECOVERY_NORMAL_FAILURE_LIMIT &&
    state.pickerReason !== "confirmed-loss";

  return {
    acceptDevice: acceptConfiguredDevice,
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
