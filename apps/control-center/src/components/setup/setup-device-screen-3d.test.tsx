import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceCandidate, DeviceInfo } from "../control-center-types";
import { SetupDeviceScreen } from "./setup-device-screen";

const mounted = vi.hoisted(() => ({
  devices: [] as Array<DeviceInfo | null | undefined>,
  webGL: true,
}));

vi.mock("./setup-3d-preview", () => ({
  useHardware3D: () => mounted.webGL,
  SetupVibeTV3DPreview: ({ device }: { device?: DeviceInfo | null }) => {
    mounted.devices.push(device);
    return null;
  },
}));

const candidate = (n: number): DeviceCandidate => ({
  target: `http://192.168.178.${150 + n}`,
  deviceId: `${n}`,
});

// Renders the rows and returns the device of every 3D model that was drawn,
// and whether the flat photo was drawn. `connected` is the index of the
// VibeTV the app is connected to and selected; `previewId` overrides the
// connected device's id, for an app connected to a VibeTV the list lacks.
function renderChooser(count: number, connected?: number, previewId?: string) {
  mounted.devices = [];
  const candidates = Array.from({ length: count }, (_, n) => candidate(n));
  const previewDevice =
    connected === undefined
      ? null
      : {
          connected: true,
          deviceId: previewId ?? `${connected}`,
          target: candidates[connected].target,
        };
  const html = renderToStaticMarkup(
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
  return { devices: mounted.devices, photo: html.includes("vibetv-device-overview-cutout") };
}

describe("SetupDeviceScreen 3D previews", () => {
  it("keeps the live 3D model for a single VibeTV", () => {
    expect(renderChooser(1)).toEqual({ devices: [null], photo: false });
  });

  it("shows the 3D model, not the photo, for a single VibeTV the app is connected to but the list lacks", () => {
    const { devices, photo } = renderChooser(1, 0, "9");
    expect(devices).toHaveLength(1);
    expect(photo).toBe(false);
  });

  it("shows the photo for a single VibeTV without WebGL2", () => {
    mounted.webGL = false;
    try {
      const { devices, photo } = renderChooser(1);
      expect(devices).toHaveLength(0);
      expect(photo).toBe(true);
    } finally {
      mounted.webGL = true;
    }
  });

  it("draws the live 3D model for the first row only", () => {
    expect(renderChooser(3).devices).toHaveLength(1);
  });

  it("moves the live 3D model to the connected row when it is not the first", () => {
    const { devices } = renderChooser(2, 1);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.deviceId).toBe("1");
  });
});
