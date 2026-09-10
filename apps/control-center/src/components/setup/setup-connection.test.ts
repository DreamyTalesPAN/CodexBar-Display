import { describe, expect, it } from "vitest";
import type { DeviceCandidate } from "../control-center-types";
import { canConnectSetupCandidate, decideSetupConnection } from "./setup-connection";

const cable = (id: string): DeviceCandidate => ({
  target: "cable://vibetv",
  deviceId: id,
  transport: "cable",
});
const wifi = (id: string): DeviceCandidate => ({
  target: `http://192.168.1.${id}`,
  deviceId: id,
  transport: "wifi",
});

describe("setup connection skip matrix", () => {
  it("counts an open setup network as the second connection option", () => {
    expect(decideSetupConnection({ candidates: [cable("1")], setupWiFiCount: 1, choiceRequired: true }).kind).toBe("mode");
  });
  it("keeps the saved Cable path even when an open setup network is found", () => {
    expect(decideSetupConnection({ candidates: [cable("1")], setupWiFiCount: 1, savedMode: "cable", choiceRequired: false })).toMatchObject({ kind: "direct", transport: "cable" });
  });
  it.each([undefined, ""])("asks for the connection when no mode has been saved (%s)", (savedMode) => {
    expect(decideSetupConnection({ candidates: [cable("1")], setupWiFiCount: 1, choiceRequired: false, savedMode }))
      .toMatchObject({ kind: "mode" });
  });

  it("uses Cable directly when neither a WLAN device nor setup network was found", () => {
    expect(
      decideSetupConnection({ candidates: [cable("1")], choiceRequired: true }),
    ).toMatchObject({
      kind: "direct", transport: "cable",
    });
  });

  it.each([undefined, "wifi" as const])("requires a choice before replacing a known Cable device with another WiFi device (%s)", (preferredTransport) => {
    expect(decideSetupConnection({
      candidates: [wifi("2")], choiceRequired: true, activeDeviceId: "1", preferredTransport,
    }).kind).toBe("list");
    expect(decideSetupConnection({
      candidates: [wifi("1")], choiceRequired: true, activeDeviceId: "1", preferredTransport,
    }).kind).toBe("direct");
  });

  it("shows the mode choice when both transports are discovered", () => {
    expect(
      decideSetupConnection({
        candidates: [cable("1"), wifi("2")],
        choiceRequired: true,
      }).kind,
    ).toBe("mode");
  });

  it("connects one WiFi device directly when Cable found none", () => {
    expect(
      decideSetupConnection({ candidates: [wifi("2")], choiceRequired: true }),
    ).toMatchObject({
      kind: "direct",
      transport: "wifi",
      alternative: "cable",
    });
  });

  it("lists two WiFi devices when Cable found none", () => {
    expect(
      decideSetupConnection({
        candidates: [wifi("2"), wifi("3")],
        choiceRequired: true,
      }),
    ).toMatchObject({
      kind: "list",
      transport: "wifi",
    });
  });

  it("shows not found when neither transport found a device", () => {
    expect(
      decideSetupConnection({ candidates: [], choiceRequired: true }).kind,
    ).toBe("not-found");
  });

  it("lists two Cable devices instead of returning an error", () => {
    expect(
      decideSetupConnection({
        candidates: [cable("1"), cable("2")],
        choiceRequired: true,
      }),
    ).toMatchObject({
      kind: "list",
      transport: "cable",
    });
  });

  it("uses the saved mode on reconnect without showing the chooser", () => {
    expect(
      decideSetupConnection({
        candidates: [cable("1"), wifi("1")],
        choiceRequired: false,
        savedMode: "wifi",
      }),
    ).toMatchObject({ kind: "direct", transport: "wifi" });
  });
});

describe("setup discovery availability", () => {
  it("keeps a Cable device selectable while its WiFi AP is active", () => {
    expect(canConnectSetupCandidate({ ...cable("1"), networkMode: "setup" })).toBe(true);
    expect(canConnectSetupCandidate({ ...wifi("1"), networkMode: "setup" })).toBe(false);
    expect(canConnectSetupCandidate({ ...wifi("1"), networkMode: "station" })).toBe(true);
    expect(canConnectSetupCandidate({ ...cable("1"), target: "" })).toBe(false);
  });
});
