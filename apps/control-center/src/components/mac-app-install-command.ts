export const DEFAULT_CONTROL_CENTER_ORIGIN = "https://app.vibetv.shop";
export const COMPANION_RELEASE_API_PATH = "/api/companion/latest";
const LOCAL_COMPANION_PORT = "47832";

export function currentControlCenterOrigin() {
  return typeof window === "undefined"
    ? DEFAULT_CONTROL_CENTER_ORIGIN
    : window.location.origin;
}

export function companionReleaseApiUrl(
  origin: string,
  nativeRuntime = false,
) {
  return nativeRuntime || isLocalCompanionOrigin(origin)
    ? `${DEFAULT_CONTROL_CENTER_ORIGIN}${COMPANION_RELEASE_API_PATH}`
    : COMPANION_RELEASE_API_PATH;
}

function isLocalCompanionOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      url.port === LOCAL_COMPANION_PORT &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
