import { describe, expect, it } from "vitest";
import {
  deviceStartupConnectionIsReady,
  normalizeDeviceConnection,
} from "./control-center-types";

describe("deviceStartupConnectionIsReady", () => {
  it("keeps a connected VibeTV visible while its healthy stream reconnects", () => {
    const device = {
      connected: true,
      ready: false,
      connectionState: "reconnecting" as const,
      stream: { healthy: true, running: true },
    };

    expect(normalizeDeviceConnection(device)).toMatchObject({
      paired: true,
      ready: true,
      connectionState: "ready",
    });
    expect(deviceStartupConnectionIsReady(device)).toBe(true);
  });
});
