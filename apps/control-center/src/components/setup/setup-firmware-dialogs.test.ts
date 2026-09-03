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

// A firmware check that could not be made is not a check that found nothing.
// It resolved rather than rejected, so the connect step logged "firmware is up
// to date" and carried on over firmware nobody had looked at.
describe("a firmware check that never answered", () => {
  it("is one of the reasons the connect step can show", () => {
    expect(firmwareBlockedReason("firmware_check_failed")).toBe(
      "firmware_check_failed",
    );
  });

  it("says what happened and offers a retry", () => {
    const copy = FIRMWARE_BLOCKED_COPY.firmware_check_failed;

    expect(copy.title).toBe("Could not check VibeTV's firmware");
    expect(copy.action).toBe("Try again");
    expect(copy.description).toContain("try again");
  });
});
