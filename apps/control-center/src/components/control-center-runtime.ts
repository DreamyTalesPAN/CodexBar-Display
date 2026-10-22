const COMPANION_URL = "http://127.0.0.1:47832";
export const RESTART_CONTROL_CENTER_URL =
  "vibetv://restart-control-center";
export const REPAIR_CONTROL_CENTER_RUNTIME_URL =
  "vibetv://repair-runtime";
export const REPAIR_CODEXBAR_URL = "vibetv://repair-codexbar";
export const FINISH_CODEXBAR_RECOVERY_URL =
  "vibetv://finish-codexbar-recovery";
export const READ_BROWSER_SIGN_IN_URL = "vibetv://read-browser-sign-in";
// CodexBar reads these from the browser sign-in on the Mac.
const MAC_BROWSER_SIGN_IN_PROVIDERS = new Set(["claude", "cursor"]);
const NATIVE_CONTROL_CENTER_USER_AGENT_PREFIX = "VibeTVControlCenter/";
const PROVIDER_SHORTCUT_UNAVAILABLE_USER_AGENT_SUFFIX =
  " ProviderShortcut/unavailable";
const HOST_LOCALE_USER_AGENT_PATTERN = / Locale\/(\S+)/;

export function restartLocalControlCenterApp(): void {
  launchNativeControlCenterAction(RESTART_CONTROL_CENTER_URL);
}

export function repairLocalControlCenterRuntime(): void {
  launchNativeControlCenterAction(REPAIR_CONTROL_CENTER_RUNTIME_URL);
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
    .split(" ")[0]
    .split("+");
  return { version: version || undefined, build: build || undefined };
}

/**
 * The computer's region and 12/24-hour setting as a BCP 47 locale, such as
 * "en-DE-u-hc-h23" (issue #890). The shells pass it in the user agent. Without
 * it the page keeps de-DE with 24 hours.
 */
export function hostTimeLocale(userAgent: string): string {
  const locale = userAgent.match(HOST_LOCALE_USER_AGENT_PATTERN)?.[1] ?? "de-DE";
  try {
    // Intl throws on a malformed tag; checked here once, not on every render.
    new Intl.DateTimeFormat(locale);
    return locale;
  } catch {
    return "de-DE";
  }
}

/** The one formatter for the times and dates the customer reads (issue #890). */
export function hostDateTimeFormat(
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(hostTimeLocale(navigator.userAgent), options);
}

/**
 * The global shortcut that shows the next provider on VibeTV (issue #424).
 * Only the Mac App and the Windows App have one. Each adds a suffix to its
 * user agent when the system refused the keys, so Settings can say so.
 */
export function nativeProviderShortcut(
  userAgent: string,
): "available" | "unavailable" | null {
  if (!isNativeControlCenterUserAgent(userAgent)) {
    return null;
  }
  return userAgent.endsWith(PROVIDER_SHORTCUT_UNAVAILABLE_USER_AGENT_SUFFIX)
    ? "unavailable"
    : "available";
}

/**
 * The Mac App says how its save dialog for a download ended (issue #582):
 * `saved` is false after Cancel. Only the outcome for `fileName` is passed
 * on. An older Mac App says nothing. Returns the function that stops listening.
 */
export function onNativeDownloadFinished(
  fileName: string,
  listener: (saved: boolean) => void,
): () => void {
  const handle = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (typeof detail !== "object" || detail === null) {
      return;
    }
    const { fileName: finished, saved } = detail as Record<string, unknown>;
    if (finished === fileName && typeof saved === "boolean") {
      listener(saved);
    }
  };
  window.addEventListener("vibetv:download-finished", handle);
  return () => window.removeEventListener("vibetv:download-finished", handle);
}

// Opens the Mac App's update prompt (issue #566). The Mac App runs a background
// Sparkle check for it: a dialog only when Sparkle finds the update, never
// "You're up to date" in the middle of setup (#570). Windows keeps its own check.
export function openMacAppUpdatePrompt(windowsHost: boolean): void {
  window.location.href = windowsHost
    ? "vibetv://check-for-updates"
    : "vibetv://check-for-updates-in-background";
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

// Only the Mac app can have CodexBar read a browser sign-in: the background
// usage service gets no macOS Keychain prompt.
export function canReadBrowserSignIn(providerId: string): boolean {
  return (
    isNativeControlCenterApp() &&
    typeof navigator !== "undefined" &&
    /^Mac/.test(navigator.platform) &&
    MAC_BROWSER_SIGN_IN_PROVIDERS.has(providerId)
  );
}

// Asks the Mac app to read the provider's browser sign-in while the customer
// signs in. This may show the macOS Keychain prompt.
export function readBrowserSignIn(providerId: string): void {
  launchNativeControlCenterAction(
    `${READ_BROWSER_SIGN_IN_URL}?provider=${encodeURIComponent(providerId)}`,
  );
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

function companionOrigin(): string {
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

function shouldUseNextLocalCompanionProxy(): boolean {
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

export function normalizeThemeSpecHash(value: string | undefined): string {
  const hash = (value || "").trim().toLowerCase();
  return /^[a-f0-9]{8}$/.test(hash) ? hash : "";
}
