export const DEVICE_TARGET_PLACEHOLDER = "vibetv.local or 192.168.178.163";

export function deviceTargetHelpText(error?: { code?: string } | null): string {
  if (error?.code === "multiple_devices_found") {
    return "More than one VibeTV answered. Enter the exact VibeTV target, then search again.";
  }
  if (error?.code === "device_not_found") {
    return "The last target did not answer. Check the VibeTV screen for its IP address, then search again.";
  }
  if (error?.code === "invalid_device_target") {
    return "Enter vibetv.local, an IP address, or an http(s) URL with a valid port and without path, username, password, query, or fragment.";
  }
  return "Use vibetv.local for a single device, or enter the exact IP address shown on the VibeTV screen.";
}
