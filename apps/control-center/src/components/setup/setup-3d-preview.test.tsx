// @vitest-environment jsdom
//
// Live-screen regression cases ported from #780; chooser changes are out of scope.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceInfo } from "../control-center-types";
import { SetupLiveScreen } from "./setup-live-screen";

const support = vi.hoisted(() => ({ webgl: true }));
const fake3D = vi.hoisted(() => ({
  instances: [] as { device: unknown; onReady?: () => void; onFailed?: () => void; onPreviewReady?: () => void }[],
}));
vi.mock("../vibetv-3d-support", () => ({
  hardwareWebGLAvailable: () => support.webgl,
}));
vi.mock("../vibetv-3d-preview", async () => {
  const { createElement } = await import("react");
  return {
    VibeTV3DPreview: (props: { device: unknown; onReady?: () => void; onFailed?: () => void; onPreviewReady?: () => void }) => {
      fake3D.instances.push(props);
      return createElement("div", {
        "aria-label": "Interactive VibeTV preview. Drag to rotate.",
        role: "group",
      });
    },
  };
});

const flatPreview = vi.hoisted(() => ({ onPreviewReady: undefined as (() => void) | undefined }));
vi.mock("../live-vibetv-preview", async (importOriginal) => {
  const original = await importOriginal<typeof import("../live-vibetv-preview")>();
  const { createElement } = await import("react");
  return {
    ...original,
    LiveVibeTVPreview: (props: Parameters<typeof original.LiveVibeTVPreview>[0]) => {
      flatPreview.onPreviewReady = props.onPreviewReady;
      return createElement(original.LiveVibeTVPreview, props);
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
beforeEach(() => {
  support.webgl = true;
  fake3D.instances = [];
  flatPreview.onPreviewReady = undefined;
});
afterEach(() => {
  cleanup();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("3D VibeTV on Your VibeTV is live", () => {
  function live(onPreviewReady?: () => void) {
    return (
      <SetupLiveScreen
        device={{ ...device, activeTheme: "claude-creature" }}
        displayFrame={null}
        usage={null}
        onPreviewReady={onPreviewReady}
      />
    );
  }

  it("draws the 3D in the background and reveals it once its model is on screen", async () => {
    const { container } = render(live());
    await settle();
    const stage = screen.getByRole("group", { hidden: true });
    expect(stage.parentElement?.getAttribute("aria-hidden")).toBe("true");
    // No flat picture, only the screen the 3D model draws.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.queryByTestId("vibetv-case")).toBeNull();

    act(() => fake3D.instances.at(-1)?.onReady?.());
    expect(screen.getByRole("group").parentElement?.getAttribute("aria-hidden")).toBeNull();
    // Only the visible 3D screen owns readiness; no hidden duplicate remains.
    expect(container.querySelector(".hidden")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("restores the visible live preview and its handover when the model fails", async () => {
    const onReady = vi.fn();
    render(live(onReady));
    await settle();
    act(() => fake3D.instances.at(-1)?.onFailed?.());
    const preview = screen.getByTestId("vibetv-case");
    expect(preview.closest(".invisible, .hidden")).toBeNull();
    expect(screen.queryByRole("group", { hidden: true })).toBeNull();
    expect(flatPreview.onPreviewReady).toBe(onReady);
  });

  it("does not start the handover while a slow 3D model is still invisible", async () => {
    const onReady = vi.fn();
    render(live(onReady));
    await settle();
    expect(fake3D.instances.at(-1)?.onPreviewReady).toBeUndefined();
    act(() => fake3D.instances.at(-1)?.onReady?.());
    expect(fake3D.instances.at(-1)?.onPreviewReady).toBe(onReady);
    expect(flatPreview.onPreviewReady).toBeUndefined();
  });

  it("shows only the flat VibeTV without hardware WebGL", async () => {
    support.webgl = false;
    render(live());
    await settle();
    expect(screen.queryByRole("group", { hidden: true })).toBeNull();
    expect(screen.getByTestId("vibetv-case").closest(".hidden")).toBeNull();
  });
});
