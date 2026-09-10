/** Native macOS scan: only open VibeTV-Setup networks, never internet status. */
export async function scanSetupWiFiNetworks(): Promise<number> {
  const native = (window as Window & {
    webkit?: { messageHandlers?: {
      vibetvSetupWiFi?: { postMessage: (message: string) => Promise<{ count: number }> };
    } };
  }).webkit?.messageHandlers?.vibetvSetupWiFi;
  if (!native) return 0;
  const result = await native.postMessage("scan");
  if (!Number.isSafeInteger(result.count) || result.count < 0) {
    throw new Error("WiFi discovery returned an invalid result. Search again.");
  }
  return result.count;
}
