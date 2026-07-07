export const DEFAULT_CONTROL_CENTER_ORIGIN = "https://app.vibetv.shop";
export const INSTALLER_SCRIPT_PATH = "/install-control-center-companion.sh";
const PREVIEW_INSTALL_VERSION =
  process.env.NEXT_PUBLIC_VIBETV_PREVIEW_INSTALL_VERSION?.trim() || "";

export function buildMacAppTerminalCommand(
  origin: string,
  localControlCenterPath = "/control-center",
) {
  const installerUrl = `${origin}${INSTALLER_SCRIPT_PATH}`;
  const args: string[] = [];
  if (origin !== DEFAULT_CONTROL_CENTER_ORIGIN) {
    args.push("--dev-origin", shellQuote(origin));
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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
