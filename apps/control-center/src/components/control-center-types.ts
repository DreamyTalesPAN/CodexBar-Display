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
  update?: CompanionReleaseInfo;
  features?: {
    themeInstallEnabled?: boolean;
    macAppSelfUpdateEnabled?: boolean;
  };
};

export type SupportDiagnostics = {
  generatedAt?: string;
  companion?: CompanionInfo;
  device?: DeviceInfo;
  checks?: Array<{
    name: string;
    status: "pass" | "attention" | "fail" | "locked" | string;
    detail?: string;
    errorCode?: string;
    nextAction?: string;
  }>;
};

export type DeviceState = "unknown" | "online" | "offline" | "paired";

export type DeviceInfo = {
  target?: string;
  connected: boolean;
  paired?: boolean;
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
  };
  health?: {
    ok?: boolean;
    resetReason?: string;
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
  | "setup"
  | "overview"
  | "usage"
  | "settings"
  | "theme-studio"
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
  return Boolean(
    device?.paired && (device.connected || deviceStreamIsReady(device)),
  );
}
