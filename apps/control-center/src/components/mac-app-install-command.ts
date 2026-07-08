export const DEFAULT_CONTROL_CENTER_ORIGIN = "https://app.vibetv.shop";
export const INSTALLER_SCRIPT_PATH = "/install-control-center-companion.sh";
const LOCAL_COMPANION_PORT = "47832";
const PREVIEW_INSTALL_VERSION =
  process.env.NEXT_PUBLIC_VIBETV_PREVIEW_INSTALL_VERSION?.trim() || "";

export function buildMacAppTerminalCommand(
  origin: string,
  localControlCenterPath = "/control-center",
) {
  const installerOrigin = installCommandOrigin(origin);
  const installerUrl = `${installerOrigin}${INSTALLER_SCRIPT_PATH}`;
  const args: string[] = [];
  if (installerOrigin !== DEFAULT_CONTROL_CENTER_ORIGIN) {
    args.push("--dev-origin", shellQuote(installerOrigin));
    if (PREVIEW_INSTALL_VERSION) {
      args.push("--version", shellQuote(PREVIEW_INSTALL_VERSION));
    }
  }
  if (localControlCenterPath !== "/control-center") {
    args.push("--control-center-path", shellQuote(localControlCenterPath));
  }
  const suffix = args.length > 0 ? ` -s -- ${args.join(" ")}` : "";
  return `curl -fsSL ${installerUrl} | bash${suffix}`;
}

export function currentControlCenterOrigin() {
  return typeof window === "undefined"
    ? DEFAULT_CONTROL_CENTER_ORIGIN
    : window.location.origin;
}

function installCommandOrigin(origin: string) {
  return isLocalCompanionOrigin(origin) ? DEFAULT_CONTROL_CENTER_ORIGIN : origin;
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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
