import { ownThemePaths } from "@/lib/active-theme-upgrade";
import { sentOwnThemePaths } from "@/lib/sent-own-theme-paths";
import { loadUserThemes } from "@/lib/theme-studio-storage";
import { normalizeDeviceTarget } from "./device-merge";

export const DEVICE_TARGET_STORAGE_KEY = "vibetv.controlCenter.deviceTarget";

// The paths of the themes and screensavers the customer saved in this browser,
// and of those sent to VibeTV from it: a theme that was edited and saved since
// it was sent has another path now, but VibeTV still holds the file that was
// sent. Theme Studio changes them without the app hearing of it, so they are
// read where they are needed.
export function savedThemePaths(): string[] {
  const saved = loadUserThemes();
  return [
    ...ownThemePaths(saved.ok ? saved.value.themes : saved.data?.themes || []),
    ...sentOwnThemePaths(),
  ];
}

export function readInitialDeviceTarget(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeDeviceTarget(
      params.get("target") ||
        window.localStorage.getItem(DEVICE_TARGET_STORAGE_KEY) ||
        "",
    );
  } catch {
    return "";
  }
}

export function readLocalSetupPreviewStep(): "mac-app" | null {
  if (typeof window === "undefined") {
    return null;
  }
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHostnames.has(window.location.hostname)) {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("setupStep") === "mac-app" ? "mac-app" : null;
  } catch {
    return null;
  }
}

export function rememberDeviceTarget(target: string) {
  if (typeof window === "undefined") {
    return;
  }
  const normalized = normalizeDeviceTarget(target);
  if (!normalized) {
    return;
  }
  try {
    window.localStorage.setItem(DEVICE_TARGET_STORAGE_KEY, normalized);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}

export function forgetDeviceTarget() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(DEVICE_TARGET_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
}
