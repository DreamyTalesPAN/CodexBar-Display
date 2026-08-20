import type { ReactNode } from "react";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
export type { ThemeProduct } from "@/lib/themes";

export const VIBETV_COLORS = {
  signal: "#CCFF00",
  signalActive: "#ABD600",
  supportAccent: "#506600",
  darkSurface: "#1B1B1B",
  bodyText: "#444933",
  baseSurface: "#F9F9F9",
  secondarySurface: "#EEEEEE",
  structuralStroke: "#747A60",
  inverseText: "#EDEDED",
} as const;

export type ApiError = {
  code: string;
  message: string;
  nextAction: string;
};

export type CompanionStatus = "unknown" | "online" | "missing";

export type CompanionInfo = {
  status?: string;
  version?: string;
  installationMode?: "legacy" | "dmg";
  app?: {
    version?: string;
    build?: string;
    path?: string;
    installationMode?: "legacy" | "dmg";
    installedInApplications?: boolean;
  };
  runtime?: {
    version?: string;
    commit?: string;
    builtAt?: string;
    executable?: string;
    pid?: number;
    listenerOwner?: string;
  };
  update?: CompanionReleaseInfo;
  features?: {
    themeInstallEnabled?: boolean;
    macAppSelfUpdateEnabled?: boolean;
  };
};

export type ProviderReadinessStatus =
  | "ready"
  | "auth_required"
  | "permission_required"
  | "no_usage_available"
  | "timeout"
  | "config_error"
  | "engine_error"
  | "not_configured"
  | string;

export type ProviderReadinessInfo = {
  id: string;
  label?: string;
  enabled?: boolean;
  status: ProviderReadinessStatus;
  detail?: string;
  errorCode?: string;
  nextAction?: string;
};

export type ProviderSetupInfo = {
  status?: "ready" | "checking" | "setup_required" | string;
  checkedAt?: string;
  currentProvider?: string;
  detail?: string;
  errorCode?: string;
  nextAction?: string;
  engine?: {
    status?: "ready" | "not_configured" | "config_error" | string;
    version?: string;
    path?: string;
    source?: "bundled" | "system" | "override" | string;
    configPath?: string;
    configWritable?: boolean;
    detail?: string;
    errorCode?: string;
    nextAction?: string;
  };
  providers?: ProviderReadinessInfo[];
};

export type SupportDiagnostics = {
  ok?: boolean;
  schemaVersion?: number;
  reportType?: string;
  generatedAt?: string;
  environment?: {
    os?: string;
    arch?: string;
    goVersion?: string;
    pid?: number;
  };
  configuration?: {
    deviceTarget?: string;
    deviceId?: string;
    hasPairingToken?: boolean;
    knownDeviceCount?: number;
  };
  networkDiscovery?: {
    attempted?: boolean;
    complete?: boolean;
    vibeTVFound?: boolean;
    devices?: DeviceCandidate[];
    errorCode?: string;
    detail?: string;
  };
  companion?: CompanionInfo;
  providerSetup?: ProviderSetupInfo;
  device?: DeviceInfo;
  checks?: Array<{
    name: string;
    status: "pass" | "attention" | "fail" | "locked" | string;
    detail?: string;
    errorCode?: string;
    nextAction?: string;
  }>;
  client?: {
    environment: {
      userAgent?: string;
      platform?: string;
      language?: string;
      online?: boolean;
      viewport?: string;
      timezone?: string;
      visibility?: string;
      surface?: "native-mac-app" | "browser";
      appVersion?: string;
      appBuild?: string;
      /** Loopback runtime address. Diagnostic only; not navigable. */
      internalRuntimeAddress?: string;
      page?: string;
    };
    state: SupportReportClientState;
  };
  collectionErrors?: Array<{
    source: string;
    message: string;
  }>;
};

export type SupportReportClientState = {
  runtimeSurface: "unknown" | "hosted-setup" | "local-control-center";
  activeTab: ActiveTab;
  companionStatus: CompanionStatus;
  companion?: CompanionInfo | null;
  deviceState: DeviceState;
  deviceTarget?: string;
  device?: DeviceInfo | null;
  deviceSearchState: DeviceSearchState;
  deviceCandidates: DeviceCandidate[];
  deviceRecovery?: {
    preferredDeviceId?: string;
    failedNormalChecks: number;
    pickerReason?: string | null;
    normalFailureLimit: number;
    operationFailureLimit: number;
  };
  providerSetup?: ProviderSetupInfo | null;
  lastError?: ApiError | null;
  recentEvents: ControlCenterEvent[];
  firmwareUpdate?: unknown;
  firmwareUpdateStatus?: unknown;
  themeInstallStatus?: unknown;
  usage?: UsageSnapshot | null;
};

export type DeviceState = "unknown" | "online" | "offline" | "paired";

export type DeviceCandidate = {
  target: string;
  deviceId?: string;
  board?: string;
  firmware?: string;
  networkMode?: "station" | "setup" | string;
  known?: boolean;
  active?: boolean;
};

export type DeviceSearchState =
  | "idle"
  | "searching"
  | "waiting"
  | "multiple"
  | "not-found"
  | "repair-failed"
  | "failed";

export type DeviceInfo = {
  target?: string;
  deviceId?: string;
  known?: boolean;
  active?: boolean;
  connected: boolean;
  paired?: boolean;
  ready?: boolean;
  connectionState?:
    | "ready"
    | "reconnecting"
    | "setup_required"
    | "provider_setup_required";
  lastSeenAt?: string;
  board?: string;
  firmware?: string;
  activeTheme?: string;
  stream?: {
    healthy?: boolean;
    running?: boolean;
    lastSentAt?: string;
    target?: string;
    lastTarget?: string;
    detail?: string;
    errorCode?: string;
  };
  health?: {
    ok?: boolean;
    bootId?: string;
    uptimeMs?: number;
    resetCount?: number;
    resetReason?: string;
    lastResetAt?: string;
    error?: string;
  };
  display?: {
    themeSpec?: {
      active?: boolean;
      path?: string;
      hash?: string;
      renderOk?: boolean;
      renderError?: string;
      renderFailures?: number;
    };
  };
  standby?: {
    active?: boolean;
    liveThemePath?: string;
    screensaverPath?: string;
  };
  capabilities?: {
    auth?: {
      paired?: boolean;
      tokenHeader?: string;
      pairingWindowOpen?: boolean;
      pairingWindowSeconds?: number;
    };
    display?: {
      brightness?: {
        supported?: boolean;
        minPercent?: number;
        maxPercent?: number;
      };
      widthPx?: number;
      heightPx?: number;
    };
    standby?: {
      supported?: boolean;
    };
    theme?: {
      supportsThemeSpecV1?: boolean;
      supportsUsageSlotsV1?: boolean;
      supportsUsageWindowsV1?: boolean;
      supportsProviderSlotsV1?: boolean;
      maxUsageWindows?: number;
      supportsStoredThemes?: boolean;
      maxThemeSpecBytes?: number;
      maxStoredThemeSpecBytes?: number;
      maxThemePrimitives?: number;
      maxThemeGifAssets?: number;
      maxThemeGifBytes?: number;
      maxThemeGifWidth?: number;
      maxThemeGifHeight?: number;
      maxThemeGifPixels?: number;
      maxThemeGifLzwBits?: number;
      supportedPrimitiveTypes?: string[];
      builtinThemes?: string[];
    };
    transport?: {
      active?: string;
    };
  };
};

export type StandbySettings = {
  enabled: boolean;
  timeoutMinutes: number;
  brightnessPercent: number;
  screensaverPath?: string | null;
};

export type AppearanceSection = "themes" | "screensavers";

export type ActiveTab =
  "overview" | "usage" | "settings" | "theme-library" | "updates" | "logs";

export type ReadinessTone = "ready" | "attention" | "unknown";

export type ReadinessItem = {
  label: string;
  value: string;
  detail?: string;
  tone: ReadinessTone;
};

export type ControlCenterEvent = {
  id: string;
  label: string;
  detail: string;
  at?: string;
  tone?: ReadinessTone;
};

export type ShellNavItem = {
  id: ActiveTab;
  label: string;
  detail?: string;
  icon?: ReactNode;
};

export type UsageProviderInfo = {
  id: string;
  label: string;
  source?: string;
  session: number;
  weekly: number;
  resetSecs?: number;
  usageMode: "used" | "remaining" | string;
  sessionTokens?: number;
  weekTokens?: number;
  totalTokens?: number;
  activity?: string;
  stale?: boolean;
  usageUnavailable?: boolean;
  sessionUnavailable?: boolean;
  weeklyUnavailable?: boolean;
  collectedAt?: string;
  activityObservedAt?: string;
  rateLimited?: boolean;
  blockedUntil?: string;
  windows?: UsageWindowInfo[];
  status?: UsageStatusInfo;
  credits?: UsageCreditsInfo;
  resetCredits?: UsageResetCreditsInfo;
  cost?: UsageCostInfo;
  costSettled?: boolean;
  pace?: UsagePaceInfo[];
  usageOverTime?: UsageOverTimePoint[];
};

export type UsageWindowInfo = {
  id: string;
  label: string;
  usedPercent: number;
  resetSecs?: number;
  windowMinutes?: number;
};

export type UsageStatusInfo = {
  indicator?: string;
  description?: string;
  updatedAt?: string;
  url?: string;
};

export type UsageCreditsInfo = {
  remaining: number;
  updatedAt?: string;
};

export type UsageResetCreditsInfo = {
  availableCount: number;
  nextExpiresAt?: string;
  updatedAt?: string;
};

export type UsageCostInfo = {
  currencyCode?: string;
  updatedAt?: string;
  todayCostUSD?: number;
  last30DaysCostUSD?: number;
  last30DaysTokens?: number;
  latestTokens?: number;
  topModel?: string;
  daily?: UsageCostDay[];
};

export type UsageCostDay = {
  day: string;
  totalCostUSD?: number;
  totalTokens?: number;
  models?: UsageCostModel[];
};

export type UsageCostModel = {
  name: string;
  totalTokens?: number;
  costUSD?: number;
};

export type UsagePaceInfo = {
  window: string;
  stage?: string;
  deltaPercent?: number;
  expectedUsedPercent?: number;
  willLastToReset?: boolean;
  etaSeconds?: number;
  summary?: string;
};

export type UsageOverTimePoint = {
  day: string;
  totalCreditsUsed: number;
  services?: UsageServiceUsage[];
};

export type UsageServiceUsage = {
  service: string;
  creditsUsed: number;
};

export type UsageSnapshot = {
  ok?: boolean;
  generatedAt?: string;
  source?: string;
  usageMode?: "used" | "remaining" | string;
  refresh?: UsageRefreshInfo;
  tokenUsageReady?: boolean;
  tokenUsageUpdating?: boolean;
  currentProvider?: string;
  providers: UsageProviderInfo[];
};

export type UsageRefreshInfo = {
  state: "refreshing" | "rate_limited" | "fresh" | "unavailable" | string;
  requestedAt?: string;
  blockedUntil?: string;
  message?: string;
};

export type PreferenceHealthState =
  | "healthy"
  | "auth_required"
  | "setup_required"
  | "stale"
  | "service_outage"
  | "unavailable"
  | "checking"
  | "disabled"
  | string;

export type PreferenceType =
  "boolean" | "enum" | "integer" | "duration" | "string" | "secret" | "action";

export type PreferenceValue = boolean | number | string | null;

export type PreferenceDescriptor = {
  id: string;
  section: string;
  owner: "codexbar" | "vibetv" | "device";
  type: PreferenceType;
  label: string;
  value: PreferenceValue;
  effectiveValue: PreferenceValue;
  allowsDefault: boolean;
  options?: Array<{ value: string; label: string }>;
  constraints?: {
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
  };
  availability: {
    state: "available" | "unavailable" | "unsupported";
    message?: string;
  };
  requiredCapability?: string;
  writeStrategy:
    "codexbar_command" | "vibetv_override" | "device_api" | "secure_session";
  writable: boolean;
  secretState?: "configured" | "not_configured";
  health?: {
    state: PreferenceHealthState;
    service: "operational" | "degraded" | "outage" | "unknown" | string;
    message: string;
    lastSuccessAt?: string;
  };
};

export function deviceImageIsStuck(device: DeviceInfo | null | undefined) {
  const themeSpec = device?.display?.themeSpec;
  return Boolean(themeSpec?.active && themeSpec.renderOk === false);
}

export function deviceStreamIsReady(device: DeviceInfo | null | undefined) {
  return deviceIsReady(device);
}

export function deviceIsReady(device: DeviceInfo | null | undefined) {
  return device?.ready === true;
}

export function deviceIsCustomerConnected(
  device: DeviceInfo | null | undefined,
): device is DeviceInfo & { active: true; connected: true } {
  return Boolean(
    device?.active === true &&
      device.connected === true &&
      device.paired !== false,
  );
}

export function deviceIsWaitingForUsage(
  device: DeviceInfo | null | undefined,
) {
  return Boolean(
    deviceIsCustomerConnected(device) &&
      device.ready !== true &&
      device.stream?.running === true &&
      device.stream.healthy !== true &&
      !device.stream.errorCode,
  );
}

export function deviceIsActive(device: DeviceInfo | null | undefined) {
  return device?.active === true;
}

// A reachable VibeTV whose display stream is running for this exact device but
// has no AI usage to draw. Mirrors providerSetupStreamForTarget on the
// Companion side without letting an old stream error prove connectivity.
export function deviceAwaitsProviderSetup(
  device: DeviceInfo | null | undefined,
) {
  const deviceTarget = comparableDeviceTarget(device?.target);
  const streamTarget = comparableDeviceTarget(device?.stream?.target);
  return (
    deviceIsCustomerConnected(device) &&
    device.paired === true &&
    device.health?.ok === true &&
    device.stream?.running === true &&
    device.stream.errorCode === "provider_setup_required" &&
    deviceTarget !== "" &&
    deviceTarget === streamTarget
  );
}

// The Companion owns provider readiness. It reports status "ready" as soon as
// one provider delivers usage and deliberately keeps the remaining providers in
// the list with their own failing status, so a per-provider rule here would
// declare a working Mac broken. Only the reconciled status decides.
export function providerSetupRequiresRecovery(
  providerSetup: ProviderSetupInfo | null | undefined,
) {
  const status = normalizedProviderStatus(providerSetup?.status);
  return status !== "" && status !== "ready" && status !== "checking";
}

export function normalizedProviderStatus(value?: string) {
  return value?.trim().toLowerCase().replace(/^provider_/, "") || "";
}

// A usable engine with every provider switched off is not a missing install:
// the customer has CodexBar and turned the switches off. Telling them to
// download it sends them after software they already have. CodexBar still owns
// the switches -- this only reads what it reports.
export function providerSetupHasEngineButNoEnabledProvider(
  providerSetup: ProviderSetupInfo | null | undefined,
) {
  const providers = providerSetup?.providers ?? [];
  return (
    normalizedProviderStatus(providerSetup?.engine?.status) === "ready" &&
    providers.length > 0 &&
    // `codexbar` is not a provider. CodexBar reports the usage service itself
    // under that id when its own probe timed out or failed, and the enablement
    // flag on that stand-in is a zero value, not an answer. Reading it as
    // "every provider is off" hides a failure behind the wrong screen.
    !providers.some((provider) => provider.id === "codexbar") &&
    // Every real provider must say it is off. A missing flag is not evidence.
    providers.every((provider) => provider.enabled === false)
  );
}

function comparableDeviceTarget(value: string | undefined) {
  return value?.trim().replace(/\/+$/, "") || "";
}

export function deviceNeedsExplicitConnect(
  device: DeviceInfo | null | undefined,
) {
  if (device?.connected !== true) {
    return false;
  }
  return (
    device.paired === false ||
    device.stream?.errorCode === "device_pairing_required"
  );
}

export function deviceNeedsThemeSetup(device: DeviceInfo | null | undefined) {
  if (!deviceCanContinueThemeSetup(device) || device?.ready === true) {
    return false;
  }

  return (
    device?.activeTheme === "theme-missing" ||
    device?.display?.themeSpec?.active === false
  );
}

export function deviceCanContinueThemeSetup(
  device: DeviceInfo | null | undefined,
) {
  if (
    device?.active !== true ||
    device.connected !== true ||
    device.paired !== true ||
    device.health?.ok !== true ||
    device.display?.themeSpec?.renderOk === false
  ) {
    return false;
  }

  // A device without a ready AI provider draws the error frame, which carries
  // no ThemeSpec, so it reports theme-missing forever. Theme setup can never
  // complete in that state, and this screen replaces the whole Control Center —
  // including the surfaces that connect a provider. Missing usage is not a
  // missing theme, so it must not claim this state.
  return !deviceAwaitsProviderSetup(device);
}

export function deviceCompletedThemeSetup(
  device: DeviceInfo | null | undefined,
) {
  return (
    deviceCanContinueThemeSetup(device) &&
    device?.display?.themeSpec?.active === true &&
    device.display.themeSpec.renderOk === true
  );
}
