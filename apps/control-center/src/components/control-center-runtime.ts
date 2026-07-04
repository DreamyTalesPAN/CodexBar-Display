export const COMPANION_URL = "http://127.0.0.1:47832";

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

export function localControlCenterUrl(themeId?: string): string {
  const base = `${companionOrigin()}/control-center`;
  const normalizedThemeId = themeId?.trim();
  if (!normalizedThemeId) {
    return base;
  }
  return `${base}/install/${encodeURIComponent(normalizedThemeId)}`;
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

export function localThemeRenderPackUrl(themeId: string): string {
  return `/theme-packs/render/${encodeURIComponent(themeId)}.json`;
}

export function themeRenderPackUrl(themeId: string): string {
  if (isLocalCompanionOrigin()) {
    return localThemeRenderPackUrl(themeId);
  }
  return `/api/theme-pack/${encodeURIComponent(themeId)}`;
}
