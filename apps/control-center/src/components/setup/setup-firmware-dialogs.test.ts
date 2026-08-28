import { describe, expect, it } from "vitest";
import {
  FIRMWARE_BLOCKED_COPY,
  firmwareBlockedReason,
} from "./setup-firmware-dialogs";

describe("firmwareBlockedReason", () => {
  it("recognises every refusal the companion can answer with", () => {
    expect(firmwareBlockedReason("mac_app_update_required")).toBe(
      "mac_app_update_required",
    );
    expect(firmwareBlockedReason("mac_app_release_check_failed")).toBe(
      "mac_app_release_check_failed",
    );
    expect(firmwareBlockedReason("mac_app_restarting")).toBe(
      "mac_app_restarting",
    );
  });

  it("leaves an ordinary update failure to the failure dialog", () => {
    expect(firmwareBlockedReason("firmware_update_timeout")).toBeNull();
    expect(firmwareBlockedReason("connect_failed")).toBeNull();
    expect(firmwareBlockedReason(undefined)).toBeNull();
  });
});

describe("FIRMWARE_BLOCKED_COPY", () => {
  it("gives every refusal its own dialog rather than one shared text", () => {
    const titles = Object.values(FIRMWARE_BLOCKED_COPY).map(
      (copy) => copy.title,
    );

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("uses the one sanctioned update label for the blocking case", () => {
    expect(FIRMWARE_BLOCKED_COPY.mac_app_update_required.action).toBe("Update");
  });

  it("offers a retry for the two transient refusals", () => {
    expect(FIRMWARE_BLOCKED_COPY.mac_app_release_check_failed.action).toBe(
      "Try again",
    );
    expect(FIRMWARE_BLOCKED_COPY.mac_app_restarting.action).toBe("Try again");
  });

  it("keeps the internal service names out of every text", () => {
    for (const copy of Object.values(FIRMWARE_BLOCKED_COPY)) {
      expect(`${copy.title} ${copy.description}`).not.toMatch(
        /CodexBar|Companion|API|firmware update job/i,
      );
    }
  });
});
