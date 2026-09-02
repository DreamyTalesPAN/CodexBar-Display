export const COMPANION_URL = "http://127.0.0.1:47832";
export const RESTART_CONTROL_CENTER_URL =
  "vibetv://restart-control-center";
export const REPAIR_CONTROL_CENTER_RUNTIME_URL =
  "vibetv://repair-runtime";
export const REPAIR_CODEXBAR_URL = "vibetv://repair-codexbar";
export const FINISH_CODEXBAR_RECOVERY_URL =
  "vibetv://finish-codexbar-recovery";
export const OPEN_CODEXBAR_URL = "vibetv://open-codexbar";
export const CHECK_FOR_UPDATES_URL = "vibetv://check-for-updates";
export const OPEN_SIGN_IN_URL = "vibetv://open-sign-in";
/** The pane that lets the usage service read Safari's cookie file. */
export const FULL_DISK_ACCESS_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles";
const NATIVE_CONTROL_CENTER_USER_AGENT_PREFIX = "VibeTVControlCenter/";

export function restartLocalControlCenterApp(): void {
  launchNativeControlCenterAction(RESTART_CONTROL_CENTER_URL);
}

export function checkForMacAppUpdate(): void {
  launchNativeControlCenterAction(CHECK_FOR_UPDATES_URL);
}

export function repairLocalControlCenterRuntime(): void {
  launchNativeControlCenterAction(REPAIR_CONTROL_CENTER_RUNTIME_URL);
}

/**
 * Opens a provider's sign-in page, or the macOS pane that unblocks reading it.
 *
 * Through the native side rather than a link: the Control Center has no
 * window-opening delegate, so an ordinary link navigates the app itself away
 * and strands the customer inside a website with no way back. The native side
 * validates the target again before opening it.
 */
export function openProviderSignIn(target: string): void {
  launchNativeControlCenterAction(
    `${OPEN_SIGN_IN_URL}?url=${encodeURIComponent(target)}`,
  );
}

export function isNativeControlCenterUserAgent(userAgent: string): boolean {
  return userAgent.startsWith(NATIVE_CONTROL_CENTER_USER_AGENT_PREFIX);
}

export function nativeControlCenterAppBuild(userAgent: string): {
  version?: string;
  build?: string;
} {
  if (!isNativeControlCenterUserAgent(userAgent)) {
    return {};
  }
  const [version, build] = userAgent
    .slice(NATIVE_CONTROL_CENTER_USER_AGENT_PREFIX.length)
    .trim()
    .split("+");
  return { version: version || undefined, build: build || undefined };
}

export function isNativeControlCenterApp(): boolean {
  return (
    typeof navigator !== "undefined" &&
    isNativeControlCenterUserAgent(navigator.userAgent)
  );
}

export function launchCodexBarRepair(): void {
  launchNativeControlCenterAction(REPAIR_CODEXBAR_URL);
}

export function finishCodexBarRecovery(): void {
  launchNativeControlCenterAction(FINISH_CODEXBAR_RECOVERY_URL);
}

export function openCodexBarApp(): void {
  launchNativeControlCenterAction(OPEN_CODEXBAR_URL);
}

function launchNativeControlCenterAction(url: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const launcher = document.createElement("a");
  launcher.href = url;
  launcher.hidden = true;
  document.body.appendChild(launcher);
  launcher.click();
  launcher.remove();
}

export function isLoopbackHostname(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

export function companionOrigin(): string {
  if (
    typeof window !== "undefined" &&
    isLoopbackHostname(window.location.hostname) &&
    window.location.pathname.startsWith("/control-center")
  ) {
    return window.location.origin;
  }
  return COMPANION_URL;
}

export function isLocalCompanionOrigin(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const companion = new URL(companionOrigin());
  return (
    window.location.protocol === companion.protocol &&
    isLoopbackHostname(window.location.hostname) &&
    window.location.port === companion.port
  );
}

export function shouldUseNextLocalCompanionProxy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return isLoopbackHostname(window.location.hostname) && !isLocalCompanionOrigin();
}

export function localControlCenterUrl(path = "/control-center"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${companionOrigin()}${normalizedPath}`;
}

export function shouldRedirectToLocalControlCenter(): boolean {
  if (typeof window === "undefined" || isLocalCompanionOrigin()) {
    return false;
  }
  return window.location.protocol === "https:";
}

export function shouldUseHostedSetupShell(): boolean {
  return shouldRedirectToLocalControlCenter();
}

export function companionRequestUrl(path: string): string {
  if (isLocalCompanionOrigin()) {
    return path;
  }
  if (shouldUseNextLocalCompanionProxy()) {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    return `/api/local-companion/${normalizedPath}`;
  }
  return `${companionOrigin()}${path}`;
}

export function needsLoopbackTargetAddressSpace(requestUrl: string): boolean {
  if (typeof window === "undefined" || isLocalCompanionOrigin()) {
    return false;
  }
  try {
    return (
      new URL(requestUrl, window.location.origin).origin === companionOrigin()
    );
  } catch {
    return false;
  }
}

export function localizeCompanionAssetUrl(
  rawUrl: string | undefined,
): string | undefined {
  if (!rawUrl) {
    return rawUrl;
  }
  if (typeof window === "undefined" || !isLocalCompanionOrigin()) {
    return rawUrl;
  }
  try {
    const url = new URL(rawUrl);
    if (
      url.origin === COMPANION_URL &&
      url.pathname.startsWith("/theme-packs/")
    ) {
      return `${window.location.origin}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
}

export function localThemeRenderPackUrl(
  themeId: string,
  themeSpecPath?: string,
  themeSpecHash?: string,
): string {
  const encodedThemeId = encodeURIComponent(themeId);
  const specFile = themeSpecFileName(themeSpecPath);
  const path = specFile
    ? `/theme-packs/render/${encodedThemeId}/${encodeURIComponent(specFile)}`
    : `/theme-packs/render/${encodedThemeId}.json`;
  const specHash = normalizeThemeSpecHash(themeSpecHash);
  return specHash ? `${path}?specHash=${specHash}` : path;
}

export function themeRenderPackUrl(
  themeId: string,
  themeSpecPath?: string,
  themeSpecHash?: string,
): string {
  if (isLocalCompanionOrigin()) {
    return localThemeRenderPackUrl(themeId, themeSpecPath, themeSpecHash);
  }
  const url = `/api/theme-pack/${encodeURIComponent(themeId)}`;
  const query = new URLSearchParams();
  if (themeSpecPath) {
    query.set("specPath", themeSpecPath);
  }
  const specHash = normalizeThemeSpecHash(themeSpecHash);
  if (specHash) {
    query.set("specHash", specHash);
  }
  return query.size > 0 ? `${url}?${query}` : url;
}

function themeSpecFileName(themeSpecPath: string | undefined): string {
  const file = (themeSpecPath || "").trim().split("/").pop() || "";
  return /^[a-zA-Z0-9._-]+\.json$/.test(file) ? file : "";
}

function normalizeThemeSpecHash(value: string | undefined): string {
  const hash = (value || "").trim().toLowerCase();
  return /^[a-f0-9]{8}$/.test(hash) ? hash : "";
}
