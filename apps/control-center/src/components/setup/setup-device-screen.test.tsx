import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceCandidate } from "../control-center-types";
import { SetupDeviceScreen } from "./setup-device-screen";

const known: DeviceCandidate = {
  target: "http://192.168.178.153",
  deviceId: "5804508",
  firmware: "1.0.55",
  known: true,
};
const other: DeviceCandidate = {
  target: "http://192.168.178.159",
  deviceId: "5863327",
  firmware: "1.0.55",
};

function render(props: Partial<Parameters<typeof SetupDeviceScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupDeviceScreen
      candidates={[known, other]}
      logLines={[]}
      onConnect={vi.fn()}
      onEnterAddressManually={vi.fn()}
      onSelect={vi.fn()}
      selectedTarget={known.target}
      {...props}
    />,
  );
}

describe("SetupDeviceScreen", () => {
  it("names the device, its address and its firmware without an API word", () => {
    const html = render();

    expect(html).toContain("VibeTV 5804508");
    expect(html).toContain("192.168.178.153 · Firmware 1.0.55");
    expect(html).toContain("Previously connected");
  });

  it("marks only the previously connected device", () => {
    expect(render().match(/Previously connected/g)).toHaveLength(1);
  });

  it("counts the found devices in singular and plural", () => {
    expect(render({ candidates: [known] })).toContain(
      "1 VibeTV found on your WiFi.",
    );
    expect(render()).toContain("2 VibeTVs found on your WiFi.");
  });

  it("cannot connect before a device is chosen", () => {
    const html = render({ selectedTarget: null });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<span>Connect<\/span>/);
  });

  it("replaces Connect with the running phase while the sequence runs", () => {
    const html = render({ connecting: true, busyLabel: "Updating firmware" });

    expect(html).toContain("Updating firmware");
    expect(html).not.toContain("<span>Connect</span>");
  });
});
