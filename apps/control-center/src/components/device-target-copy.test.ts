import { describe, expect, it } from "vitest";
import {
  deviceTargetHelpText,
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
