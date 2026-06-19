export const DEVICE_TARGET_PLACEHOLDER = "vibetv.local or 192.168.178.163";

export function deviceTargetHelpText(error?: { code?: string } | null): string {
  if (error?.code === "multiple_devices_found") {
    return "More than one VibeTV answered. Enter the address shown on the VibeTV screen.";
  }
  if (error?.code === "device_not_found") {
    return "That VibeTV did not answer. Check the VibeTV screen for its IP address.";
  }
  if (error?.code === "invalid_device_target") {
    return "Enter only vibetv.local or the IP address shown on the VibeTV screen.";
  }
  return "Use vibetv.local, or enter the IP address shown on the VibeTV screen.";
}
