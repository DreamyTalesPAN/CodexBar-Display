// @vitest-environment jsdom
//
// #780: the setup screens show the one 3D VibeTV of the Overview (a small one
// per row of "Choose your VibeTV", a big one on "Your VibeTV is live") instead
// of the photo and the flat case. The flat versions stay for a browser
// without hardware WebGL and until the model is on screen.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceCandidate, DeviceInfo } from "../control-center-types";
import { SetupDeviceScreen } from "./setup-device-screen";
import { SetupLiveScreen } from "./setup-live-screen";

const support = vi.hoisted(() => ({ webgl: true }));
const fake3D = vi.hoisted(() => ({
  instances: [] as { device: unknown; onReady?: () => void }[],
}));
vi.mock("../vibetv-3d-support", () => ({
  hardwareWebGLAvailable: () => support.webgl,
}));
vi.mock("../vibetv-3d-preview", async () => {
  const { createElement } = await import("react");
  return {
    VibeTV3DPreview: (props: { device: unknown; onReady?: () => void }) => {
      fake3D.instances.push(props);
      return createElement("div", {
        "aria-label": "Interactive VibeTV preview. Drag to rotate.",
        role: "group",
      });
    },
  };
});

const device = {
  active: true,
  connected: true,
  deviceId: "5804508",
  ready: true,
  paired: true,
} as DeviceInfo;
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

beforeEach(() => {
  support.webgl = true;
  fake3D.instances = [];
});
afterEach(() => {
  cleanup();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function deviceScreen() {
  return (
    <SetupDeviceScreen
      candidates={[known, other]}
      logLines={[]}
      onChooseTransport={() => {}}
      onConfigureWiFi={async () => {}}
      onConnect={() => {}}
      onEnterAddressManually={() => {}}
      onScanWiFiNetworks={() => {}}
      onSearchAgain={() => {}}
      onSelect={() => {}}
      onWiFiError={() => {}}
      previewDevice={device}
      selectedTarget={known.target}
      transport="wifi"
    />
  );
}

describe("3D VibeTV in the device list", () => {
  it("keeps the photo until the model is on screen, then drops it", async () => {
    const { container } = render(deviceScreen());
    await settle();
    // Only the first row renders the live model; the second row keeps its photo.
    expect(fake3D.instances).toHaveLength(1);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    act(() => fake3D.instances.forEach((instance) => instance.onReady?.()));
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("gives the live screen only to the VibeTV the app is connected to", async () => {
    render(deviceScreen());
    await settle();
    expect(fake3D.instances.map((instance) => instance.device)).toEqual([
      device,
    ]);
  });

  it("stays on the photo without hardware WebGL", async () => {
    support.webgl = false;
    const { container } = render(deviceScreen());
    await settle();
    expect(fake3D.instances).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });
});

describe("3D VibeTV on Your VibeTV is live", () => {
  function live() {
    return (
      <SetupLiveScreen
        device={{ ...device, activeTheme: "claude-creature" }}
        displayFrame={null}
        usage={null}
      />
    );
  }

  it("draws the 3D in the background and reveals it once its model is on screen", async () => {
    render(live());
    await settle();
    const stage = screen.getByRole("group", { hidden: true });
    expect(stage.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("vibetv-case")).toBeTruthy();

    act(() => fake3D.instances.at(-1)?.onReady?.());
    expect(screen.getByRole("group").parentElement?.getAttribute("aria-hidden")).toBeNull();
    // The flat preview stays mounted (it tells the wizard when to leave).
    expect(screen.getByTestId("vibetv-case").closest(".hidden")).toBeTruthy();
  });

  it("shows only the flat VibeTV without hardware WebGL", async () => {
    support.webgl = false;
    render(live());
    await settle();
    expect(screen.queryByRole("group", { hidden: true })).toBeNull();
    expect(screen.getByTestId("vibetv-case").closest(".hidden")).toBeNull();
  });
});
