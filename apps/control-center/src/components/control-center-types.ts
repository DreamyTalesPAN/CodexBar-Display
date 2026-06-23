import type { ReactNode } from "react";
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
  features?: {
    themeInstallEnabled?: boolean;
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
