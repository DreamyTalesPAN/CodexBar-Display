export const COMPANION_URL = "http://127.0.0.1:47832";

export function isLoopbackHostname(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

export function isLocalCompanionOrigin(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const companion = new URL(COMPANION_URL);
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

export function localControlCenterUrl(): string {
  return `${COMPANION_URL}/control-center`;
}

export function shouldRedirectToLocalControlCenter(): boolean {
  if (typeof window === "undefined" || isLocalCompanionOrigin()) {
    return false;
  }
  return window.location.protocol === "https:";
}

export function companionRequestUrl(path: string): string {
  if (isLocalCompanionOrigin()) {
    return path;
  }
  if (shouldUseNextLocalCompanionProxy()) {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    return `/api/local-companion/${normalizedPath}`;
  }
  return `${COMPANION_URL}${path}`;
}

export function needsLoopbackTargetAddressSpace(requestUrl: string): boolean {
  if (typeof window === "undefined" || isLocalCompanionOrigin()) {
    return false;
  }
  try {
    return new URL(requestUrl, window.location.origin).origin === COMPANION_URL;
  } catch {
    return false;
  }
}

export function localThemeRenderPackUrl(themeId: string): string {
  return `/theme-packs/render/${encodeURIComponent(themeId)}.json`;
}

export function themeRenderPackUrl(themeId: string): string {
  if (isLocalCompanionOrigin()) {
    return localThemeRenderPackUrl(themeId);
  }
  return `/api/theme-pack/${encodeURIComponent(themeId)}`;
}
