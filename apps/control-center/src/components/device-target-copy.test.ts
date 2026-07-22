import { describe, expect, it } from "vitest";
import {
  deviceTargetHelpText,
  formatDeviceTargetInput,
  normalizeManualDeviceTarget,
} from "./device-target-copy";

describe("VibeTV address input", () => {
  it("normalizes a plain IPv4 address to the local HTTP target", () => {
    expect(normalizeManualDeviceTarget(" 172.30.12.34 ")).toBe(
      "http://172.30.12.34",
    );
    expect(normalizeManualDeviceTarget("HTTP://192.168.178.163")).toBe(
      "http://192.168.178.163",
    );
  });

  it("keeps transport details out of the input", () => {
    expect(formatDeviceTargetInput("http://192.168.178.72/hello")).toBe(
      "192.168.178.72",
    );
    expect(formatDeviceTargetInput("https://VibeTV.local/setup")).toBe(
      "vibetv.local",
    );
    expect(formatDeviceTargetInput("vibetv.local")).toBe("vibetv.local");
  });

  it.each([
    "",
    "vibetv.local",
    "172.30.12",
    "172.30.12.999",
    "http://172.30.12.34/hello",
    "172.30.12.34?token=secret",
  ])("rejects invalid or unsafe input %j", (value) => {
    expect(normalizeManualDeviceTarget(value)).toBeNull();
  });

  it("keeps unreachable and invalid input guidance customer-readable", () => {
    expect(deviceTargetHelpText({ code: "device_not_found" })).toContain(
      "did not answer",
    );
    expect(deviceTargetHelpText({ code: "invalid_device_target" })).toContain(
      "only the IP address",
    );
  });
});
