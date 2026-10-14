import { deviceCompletedThemeSetup, deviceNeedsThemeSetup, type DeviceCandidate, type DeviceInfo } from "./control-center-types";

export type ThemeSetupDeviceIdentity = {
  deviceId: string;
  target: string;
};

export function mergeDeviceInfo(
  current: DeviceInfo | null,
  next: DeviceInfo,
): DeviceInfo {
  if (!current) {
    return next;
  }

  const currentTarget = normalizeDeviceTarget(current.target || "");
  const nextTarget = normalizeDeviceTarget(next.target || "");
  if (currentTarget && nextTarget && currentTarget !== nextTarget) {
    return next;
  }

  return {
    ...current,
    ...next,
    active: next.active ?? current.active,
    board: next.board ?? current.board,
    firmware: next.firmware ?? current.firmware,
    activeTheme: next.activeTheme ?? current.activeTheme,
    capabilities: mergeDeviceCapabilities(
      current.capabilities,
      next.capabilities,
    ),
    display: mergeDeviceDisplay(current.display, next.display),
    health: next.health ?? current.health,
    stream: mergeDeviceStream(current.stream, next.stream),
  };
}

// A stream that is restarting reports no error for a moment. Reading that quiet
// sample as "the incident is over" ended recovery mid-repair, dropped the
// customer into Overview, and opened a fresh incident three seconds later when
// the error came back. An incident ends on evidence that the device draws
// again — a healthy stream or a different error — never on one sample that
// simply says nothing.
export function mergeDeviceStream(
  current: DeviceInfo["stream"],
  next: DeviceInfo["stream"],
): DeviceInfo["stream"] {
  if (!next) {
    return current;
  }
  if (
    current?.errorCode === "provider_setup_required" &&
    !next.errorCode &&
    !next.healthy
  ) {
    return { ...next, errorCode: current.errorCode };
  }
  return next;
}

export function deviceIsConfigured(device: DeviceInfo | null | undefined): boolean {
  return Boolean(device?.deviceId || (device?.target && device.paired));
}

export function readThemeSetupIdentity(
  device: DeviceInfo | null | undefined,
): ThemeSetupDeviceIdentity {
  return {
    deviceId: device?.deviceId?.trim() || "",
    target: normalizeDeviceTarget(device?.target || ""),
  };
}

export function deviceMatchesThemeSetupIdentity(
  identity: ThemeSetupDeviceIdentity | null,
  device: DeviceInfo | null | undefined,
): boolean {
  if (!identity || !device) {
    return false;
  }
  const candidate = readThemeSetupIdentity(device);
  if (identity.deviceId && candidate.deviceId) {
    return identity.deviceId === candidate.deviceId;
  }
  return Boolean(
    identity.target && candidate.target && identity.target === candidate.target,
  );
}

export function reconcileThemeSetupIdentity(
  current: ThemeSetupDeviceIdentity | null,
  device: DeviceInfo,
): ThemeSetupDeviceIdentity | null {
  const candidate = readThemeSetupIdentity(device);
  const hasIdentity = Boolean(candidate.deviceId || candidate.target);
  if (current && deviceMatchesThemeSetupIdentity(current, device)) {
    if (deviceCompletedThemeSetup(device)) {
      return null;
    }
    return {
      deviceId: candidate.deviceId || current.deviceId,
      target: candidate.target || current.target,
    };
  }
  if (hasIdentity && deviceNeedsThemeSetup(device)) {
    return candidate;
  }
  return null;
}

export function markDeviceDisconnected(
  current: DeviceInfo | null,
  target = "",
): DeviceInfo | null {
  if (!current) {
    return target ? { target, connected: false, ready: false } : null;
  }
  return {
    ...current,
    ...(target ? { target } : {}),
    connected: false,
    ready: false,
    connectionState: deviceIsConfigured(current)
      ? "reconnecting"
      : current.connectionState,
  };
}

export function mergeDeviceDisplay(
  current: DeviceInfo["display"],
  next: DeviceInfo["display"],
): DeviceInfo["display"] {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return {
    ...current,
    ...next,
    themeSpec: next.themeSpec
      ? { ...current.themeSpec, ...next.themeSpec }
      : current.themeSpec,
  };
}

export function mergeDeviceCapabilities(
  current: DeviceInfo["capabilities"],
  next: DeviceInfo["capabilities"],
): DeviceInfo["capabilities"] {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return {
    ...current,
    ...next,
    auth: next.auth ? { ...current.auth, ...next.auth } : current.auth,
    display: next.display
      ? {
          ...current.display,
          ...next.display,
          brightness: next.display.brightness
            ? { ...current.display?.brightness, ...next.display.brightness }
            : current.display?.brightness,
        }
      : current.display,
    theme: next.theme ? { ...current.theme, ...next.theme } : current.theme,
    transport: next.transport
      ? { ...current.transport, ...next.transport }
      : current.transport,
  };
}

// A lost VibeTV that the WiFi reconnect (`/v1/device/select`) can reach.
export function canReconnectLostDevice(candidate: DeviceCandidate): boolean {
  return candidate.transport !== "cable" && Boolean(candidate.deviceId);
}

export function normalizeDeviceTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export function deviceMatchesExpectedConnection(
  device: DeviceInfo | null | undefined,
  expectedTarget?: string,
  expectedDeviceId?: string,
): device is DeviceInfo {
  if (!device?.connected || !device.paired) {
    return false;
  }
  const targetMatches =
    !expectedTarget ||
    (Boolean(device.target) &&
      normalizeDeviceTarget(device.target || "") ===
        normalizeDeviceTarget(expectedTarget));
  const identityMatches =
    !expectedDeviceId || device.deviceId === expectedDeviceId;
  return targetMatches && identityMatches;
}
