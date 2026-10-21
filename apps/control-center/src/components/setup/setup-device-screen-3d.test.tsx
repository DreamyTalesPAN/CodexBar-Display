import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceCandidate, DeviceInfo } from "../control-center-types";
import { SetupDeviceScreen } from "./setup-device-screen";

const mounted = vi.hoisted(() => ({ devices: [] as Array<DeviceInfo | null | undefined> }));

vi.mock("./setup-3d-preview", () => ({
  useHardware3D: () => true,
  SetupVibeTV3DPreview: ({ device }: { device?: DeviceInfo | null }) => {
    mounted.devices.push(device);
    return null;
  },
}));

const candidate = (n: number): DeviceCandidate => ({
  target: `http://192.168.178.${150 + n}`,
  deviceId: `${n}`,
});

// Renders the rows and returns the device of every 3D model that was drawn.
// `connected` is the index of the VibeTV the app is connected to and selected.
function render3DDevices(count: number, connected?: number) {
  mounted.devices = [];
  const candidates = Array.from({ length: count }, (_, n) => candidate(n));
  const previewDevice =
    connected === undefined
      ? null
      : { connected: true, deviceId: `${connected}`, target: candidates[connected].target };
  renderToStaticMarkup(
    <SetupDeviceScreen
      candidates={candidates}
      previewDevice={previewDevice}
      transport="wifi"
      logLines={[]}
      onConnect={vi.fn()}
      onChooseTransport={vi.fn()}
      onConfigureWiFi={vi.fn()}
      onWiFiError={vi.fn()}
      onEnterAddressManually={vi.fn()}
      onSearchAgain={vi.fn()}
      onScanWiFiNetworks={vi.fn()}
      onSelect={vi.fn()}
      selectedTarget={candidates[connected ?? 0].target}
    />,
  );
  return mounted.devices;
}

describe("SetupDeviceScreen 3D previews", () => {
  it("keeps the live 3D model for a single VibeTV", () => {
    expect(render3DDevices(1)).toHaveLength(1);
  });

  it("draws the live 3D model for the first row only", () => {
    expect(render3DDevices(3)).toHaveLength(1);
  });

  it("moves the live 3D model to the connected row when it is not the first", () => {
    const devices = render3DDevices(2, 1);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceId).toBe("1");
  });
});
