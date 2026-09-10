// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanSetupWiFiNetworks } from "./setup-wifi-discovery";
afterEach(() => vi.unstubAllGlobals());
function bridge(postMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("webkit", { messageHandlers: { vibetvSetupWiFi: { postMessage } } });
}
describe("native setup WiFi discovery", () => {
  it("uses only the native scan result", async () => {
    const post = vi.fn().mockResolvedValue({ count: 1 });
    bridge(post);
    expect(await scanSetupWiFiNetworks()).toBe(1);
    expect(post).toHaveBeenCalledWith("scan");
  });
  it("does not invent a network outside the native Mac App", async () => {
    expect(await scanSetupWiFiNetworks()).toBe(0);
  });
  it("preserves permission and scan errors instead of reporting zero", async () => {
    bridge(vi.fn().mockRejectedValue(new Error("Location Services denied")));
    await expect(scanSetupWiFiNetworks()).rejects.toThrow("Location Services denied");
  });
  it.each([-1, 0.5, NaN, undefined])("rejects invalid counts: %s", async (count) => {
    bridge(vi.fn().mockResolvedValue({ count }));
    await expect(scanSetupWiFiNetworks()).rejects.toThrow("invalid result");
  });
});
