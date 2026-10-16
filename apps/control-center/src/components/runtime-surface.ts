import { shouldUseHostedSetupShell } from "./control-center-runtime";
import { type CustomerPlatform } from "@/lib/customer-platform";

export type RuntimeSurface = "unknown" | "hosted-setup" | "local-control-center";

export function getRuntimeSurfaceSnapshot(): RuntimeSurface {
  return shouldUseHostedSetupShell() ? "hosted-setup" : "local-control-center";
}

export function getRuntimeSurfaceServerSnapshot(): RuntimeSurface {
  return "unknown";
}

export function getCustomerPlatformServerSnapshot(): CustomerPlatform {
  return "unknown";
}

export function isWindowsWebView(): boolean {
  return typeof navigator !== "undefined" && /^win/i.test(navigator.platform);
}

export function getWindowsWebViewServerSnapshot(): boolean {
  return false;
}

export function subscribeRuntimeSurface(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const timer = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timer);
}

export function localControlCenterPathForTheme(themeId: string | undefined): string {
  const cleanThemeId = themeId?.trim();
  if (!cleanThemeId) {
    return "/control-center";
  }
  return `/control-center/install/${encodeURIComponent(cleanThemeId)}`;
}
