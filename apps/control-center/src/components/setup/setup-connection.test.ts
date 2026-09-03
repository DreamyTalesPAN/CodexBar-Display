import { describe, expect, it } from "vitest";
import type { DeviceCandidate } from "../control-center-types";
import { decideSetupConnection } from "./setup-connection";

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
  it("connects one Cable device directly when WiFi found none", () => {
    expect(
      decideSetupConnection({ candidates: [cable("1")], choiceRequired: true }),
    ).toMatchObject({
      kind: "direct",
      transport: "cable",
      alternative: "wifi",
    });
  });

  it("shows the mode choice only for one Cable and at least one WiFi device", () => {
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
