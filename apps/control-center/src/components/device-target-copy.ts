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

export function candidateAddress(target: string): string {
  try {
    return new URL(target).hostname || target;
  } catch {
    return target.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}
