// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { OverviewScreen } from "./overview-screen";

// The 3D case is switched on per test; the fake 3D preview hands back its
// onReady so a test decides when the model is on screen.
const support = vi.hoisted(() => ({ webgl: false }));
const fake3D = vi.hoisted(() => ({ onReady: null as (() => void) | null, onFailed: null as (() => void) | null }));
vi.mock("./vibetv-3d-support", () => ({
  hardwareWebGLAvailable: () => support.webgl,
}));
vi.mock("./vibetv-3d-preview", async () => {
  const { createElement } = await import("react");
  return {
    VibeTV3DPreview: (props: { onReady?: () => void; onFailed?: () => void }) => {
      fake3D.onReady = props.onReady ?? null;
      fake3D.onFailed = props.onFailed ?? null;
      return createElement("div", {
        "aria-label": "Interactive VibeTV preview. Drag to rotate.",
        role: "group",
      });
    },
  };
});

// jsdom has no WebGL: unavailable rendering must be reported honestly.
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class NoWebGLRenderer {
    constructor() {
      throw new Error("WebGL is not available");
    }
  }
  return { ...actual, WebGLRenderer: NoWebGLRenderer };
});

afterEach(() => {
  cleanup();
});

const connectedDevice = {
  active: true,
  connected: true,
  deviceId: "14799300",
  paired: true,
  ready: true,
};

describe("OverviewScreen", () => {
  it("shows the status line, the VibeTV and four quiet figures", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        companionVersion="1.0.64"
        device={{
          ...connectedDevice,
          firmware: "1.0.48",
          target: "cable://vibetv",
        }}
        firmwareUpdate="current"
        macAppUpdate="current"
      />,
    );

    expect(html).toContain("VibeTV is connected");
    // The figures: label, value, line (calm master).
    for (const shown of [
      "Mac App",
      "1.0.64",
      "VibeTV</dt>",
      "14799300",
      "USB-C cable · connected",
      "Display",
      "Active theme",
      "Firmware",
      "1.0.48",
    ]) {
      expect(html).toContain(shown);
    }
    expect(html.match(/Up to date/g)).toHaveLength(2);
    // The old badge words stay gone.
    for (const removed of ["Online", "Connected by Cable"]) {
      expect(html).not.toContain(removed);
    }
  });

  it("says nothing about updates until a check has confirmed a result", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        companionVersion="1.0.64"
        device={{ ...connectedDevice, firmware: "1.0.48" }}
      />,
    );

    expect(html).not.toContain("Up to date");
    expect(html).not.toContain("Update available");
  });

  it("says an update is waiting and uses App on Windows", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        companionVersion="1.0.64"
        device={{ ...connectedDevice, firmware: "1.0.48" }}
        firmwareUpdate="available"
        macAppUpdate="available"
        windowsHost
      />,
    );

    expect(html.match(/Update available/g)).toHaveLength(2);
    expect(html).not.toContain("Up to date");
    expect(html).toContain(">App</dt>");
    expect(html).not.toContain("Mac App");
  });

  it("uses the status line for each VibeTV state", () => {
    const disconnected = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, deviceId: "14799300", paired: true, ready: false }}
      />,
    );
    expect(disconnected).toContain("VibeTV status");
    expect(disconnected).not.toContain("VibeTV is connected");

    const restarting = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, paired: true, ready: false }}
        firmwareUpdateStatus={{ phase: "installing", stage: "rebooting" }}
      />,
    );
    expect(restarting).toContain("VibeTV is restarting");
    expect(restarting).not.toContain("VibeTV is connected");
  });

  it("does not show reconnect instructions inside an available Overview", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          active: true,
          connected: false,
          deviceId: "14799300",
          paired: true,
          ready: false,
          connectionState: "setup_required",
        }}
      />,
    );

    expect(html).not.toContain("Reconnecting to VibeTV");
    expect(html).not.toContain("VibeTV-Setup");
    expect(html).not.toContain("Pair VibeTV again");
  });

  it("does not add a connection-mode banner to the overview", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen companionStatus="online" device={connectedDevice} />,
    );

    expect(html).not.toContain("Change connection");
  });

  it("shows a neutral error without the old photo when WebGL is unavailable", async () => {
    render(
      <OverviewScreen
        companionStatus="online"
        device={{ active: true, connected: false, paired: true, ready: false }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("3D preview is unavailable.");
      expect(screen.queryByTestId("vibetv-case")).toBeNull();
    });
    expect(screen.queryByRole("group", { name: /Interactive VibeTV preview/ })).toBeNull();
  });

  it.each([true, false])("has no accessibility violations (connected=%s)", async (connected) => {
    await expectNoAxeViolations(
      renderToStaticMarkup(
        <OverviewScreen
          companionStatus="online"
          device={{ active: true, connected, deviceId: "14799300", paired: true, ready: connected }}
        />,
      ),
    );
  });
});

describe("OverviewScreen 3D handover", () => {
  const disconnected = { active: true, connected: false, paired: true, ready: false };
  const threeDGroup = () =>
    document.querySelector('[aria-label="Interactive VibeTV preview. Drag to rotate."]');

  beforeEach(() => {
    support.webgl = true;
    fake3D.onReady = null;
  });

  afterEach(() => {
    support.webgl = false;
  });

  it("reveals the 3D once the model is on screen, without a live frame", async () => {
    render(<OverviewScreen companionStatus="online" device={disconnected} />);

    await waitFor(() => expect(threeDGroup()).not.toBeNull());
    const wrapper = threeDGroup()?.parentElement;
    expect(wrapper?.className).toContain("opacity-0");

    act(() => fake3D.onReady?.());

    expect(wrapper?.className).not.toContain("opacity-0");
    // The neutral loading state is dropped; the glass owns its live screen.
    expect(screen.queryByLabelText("VibeTV live preview is offline")).toBeNull();
  });

  it("hides the 3D from assistive technology until it is revealed", async () => {
    render(<OverviewScreen companionStatus="online" device={disconnected} />);

    await waitFor(() => expect(threeDGroup()).not.toBeNull());
    const wrapper = threeDGroup()?.parentElement;
    expect(wrapper?.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper?.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("group", { name: /Interactive VibeTV preview/ })).toBeNull();

    act(() => fake3D.onReady?.());

    expect(wrapper?.hasAttribute("aria-hidden")).toBe(false);
    expect(wrapper?.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("group", { name: /Interactive VibeTV preview/ })).toBeTruthy();
  });
  it("never mounts the old photo during initial load, navigation remount, ready or failure", async () => {
    for (const tab of ["initial", "after Updates", "after Support"]) {
      const view = render(<OverviewScreen key={tab} companionStatus="online" device={disconnected} />);
      const noPhoto = () => {
        expect(view.container.querySelector("img")).toBeNull();
        expect(screen.queryByTestId("vibetv-case")).toBeNull();
      };
      expect(screen.getByRole("status").textContent).toBe("Loading 3D preview…");
      noPhoto();
      await waitFor(() => expect(threeDGroup()).not.toBeNull());
      noPhoto();
      act(() => fake3D.onReady?.());
      expect(screen.getByRole("group", { name: /Interactive VibeTV preview/ })).toBeTruthy();
      expect(screen.queryByRole("status")).toBeNull();
      noPhoto();
      act(() => fake3D.onFailed?.());
      expect(screen.getByRole("status").textContent).toBe("3D preview is unavailable.");
      noPhoto();
      view.unmount();
    }
  });

});
