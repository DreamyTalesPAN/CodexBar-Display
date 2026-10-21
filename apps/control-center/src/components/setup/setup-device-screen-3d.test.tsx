import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceCandidate } from "../control-center-types";
import { SetupDeviceScreen } from "./setup-device-screen";

const mounted = vi.hoisted(() => ({ count: 0 }));

vi.mock("./setup-3d-preview", () => ({
  useHardware3D: () => true,
  SetupVibeTV3DPreview: () => {
    mounted.count += 1;
    return null;
  },
}));

const candidate = (n: number): DeviceCandidate => ({
  target: `http://192.168.178.${150 + n}`,
  deviceId: `${n}`,
});

function renderRows(count: number) {
  mounted.count = 0;
  const candidates = Array.from({ length: count }, (_, n) => candidate(n));
  renderToStaticMarkup(
    <SetupDeviceScreen
      candidates={candidates}
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
      selectedTarget={candidates[0].target}
    />,
  );
  return mounted.count;
}

describe("SetupDeviceScreen 3D previews", () => {
  it("keeps the live 3D model for a single VibeTV", () => {
    expect(renderRows(1)).toBe(1);
  });

  it("draws the live 3D model for the first row only", () => {
    expect(renderRows(3)).toBe(1);
  });
});
