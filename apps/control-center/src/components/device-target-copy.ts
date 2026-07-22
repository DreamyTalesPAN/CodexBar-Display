export const DEVICE_TARGET_PLACEHOLDER = "192.168.178.163";

export function normalizeManualDeviceTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withoutScheme = trimmed.replace(/^https?:\/\//i, "");
  if (
    withoutScheme.includes("/") ||
    withoutScheme.includes("?") ||
    withoutScheme.includes("#")
  ) {
    return null;
  }
  const host = withoutScheme.toLowerCase();
  const octets = host.split(".");
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) =>
        !/^\d{1,3}$/.test(octet) || Number(octet) < 0 || Number(octet) > 255,
    )
  ) {
    return null;
  }
  return `http://${host}`;
}

export function formatDeviceTargetInput(value: string): string {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return value;
  }
  try {
    return new URL(trimmed).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").split("/")[0];
  }
}

export function deviceTargetHelpText(error?: { code?: string } | null): string {
  if (error?.code === "multiple_devices_found") {
    return "More than one VibeTV answered. Enter the address shown on the VibeTV screen.";
  }
  if (error?.code === "device_not_found") {
    return "That VibeTV did not answer. Check the VibeTV screen for its IP address.";
  }
  if (error?.code === "invalid_device_target") {
    return "Enter only the IP address shown on the VibeTV screen.";
  }
  return "Enter the IP address shown on the VibeTV screen.";
}
