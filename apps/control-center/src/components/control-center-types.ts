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
  | "alternate"
  | "multiple"
  | "declined"
  | "not-found"
  | "repair-failed"
  | "failed";

export type DeviceInfo = {
  target?: string;
  deviceId?: string;
  known?: boolean;
  connected: boolean;
  paired?: boolean;
  ready?: boolean;
  connectionState?: "ready" | "reconnecting" | "setup_required";
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
  capabilities?: {
    display?: {
      brightness?: {
        supported?: boolean;
        minPercent?: number;
        maxPercent?: number;
      };
    };
    theme?: {
      supportsThemeSpecV1?: boolean;
      maxThemeGifBytes?: number;
    };
    transport?: {
      active?: string;
    };
  };
};

export type ActiveTab =
  | "overview"
  | "usage"
  | "settings"
  | "theme-library"
  | "updates"
  | "logs";

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
  collectedAt?: string;
  activityObservedAt?: string;
  windows?: UsageWindowInfo[];
  status?: UsageStatusInfo;
  credits?: UsageCreditsInfo;
  resetCredits?: UsageResetCreditsInfo;
  cost?: UsageCostInfo;
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
  currentProvider?: string;
  providers: UsageProviderInfo[];
};

export function deviceImageIsStuck(device: DeviceInfo | null | undefined) {
  const themeSpec = device?.display?.themeSpec;
  return Boolean(themeSpec?.active && themeSpec.renderOk === false);
}

export function deviceStreamIsReady(device: DeviceInfo | null | undefined) {
  return Boolean(device?.paired && device.stream?.healthy);
}

export function deviceSetupIsUsable(device: DeviceInfo | null | undefined) {
  if (device?.connectionState) {
    return (
      device.connectionState === "ready" ||
      device.connectionState === "reconnecting"
    );
  }
  return device?.ready === true;
}

export function deviceStartupConnectionIsReady(
  device: DeviceInfo | null | undefined,
) {
  return Boolean(
    deviceSetupIsUsable(device) &&
      device?.connectionState !== "reconnecting" &&
      device?.connected !== false,
  );
}
