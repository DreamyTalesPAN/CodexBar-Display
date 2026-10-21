// @vitest-environment jsdom
//
// #854: after 2.5 s without a touch the 3D VibeTV sways one full cycle and then
// stands still; it asks for no more animation frames from then on.
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "three";
import { VibeTV3DPreview } from "./vibetv-3d-preview";

const state = vi.hoisted(() => ({
  rendererFails: false,
  modelFails: false,
  angles: [] as number[],
  listeners: {} as Record<string, () => void>,
  now: 0,
  queue: [] as FrameRequestCallback[],
  scene: null as Scene | null,
}));

vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    constructor() {
      if (state.rendererFails) throw new Error("WebGL renderer unavailable");
    }
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    toneMappingExposure = 1;
    setPixelRatio() {}
    setSize() {}
    render(scene: Scene) {
      state.scene = scene;
    }
    forceContextLoss() {}
    dispose() {}
  }
  class FakePMREMGenerator {
    fromScene() {
      return { dispose() {} };
    }
    dispose() {}
  }
  return { ...three, PMREMGenerator: FakePMREMGenerator, WebGLRenderer: FakeRenderer };
});
vi.mock("three/addons/controls/OrbitControls.js", async () => {
  const { Vector3 } = await import("three");
  class FakeOrbitControls {
    target = new Vector3();
    enableZoom = true;
    enablePan = true;
    enableDamping = false;
    minPolarAngle = 0;
    maxPolarAngle = 0;
    minAzimuthAngle = 0;
    maxAzimuthAngle = 0;
    rotateSpeed = 1;
    addEventListener(type: string, listener: () => void) {
      state.listeners[type] = listener;
    }
    update() {
      return false;
    }
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});
vi.mock("three/addons/loaders/GLTFLoader.js", async () => {
  const { Group } = await import("three");
  class FakeGLTFLoader {
    load(_url: string, onLoad: (gltf: { scene: unknown }) => void, _progress: unknown, onError: () => void) {
      if (state.modelFails) {
        onError();
        return;
      }
      onLoad({ scene: new Group() });
    }
  }
  return { GLTFLoader: FakeGLTFLoader };
});
vi.mock("three/addons/renderers/CSS3DRenderer.js", async () => {
  const { Object3D } = await import("three");
  class FakeCSS3DRenderer {
    domElement = document.createElement("div");
    setSize() {}
    render() {}
  }
  class FakeCSS3DObject extends Object3D {}
  return { CSS3DObject: FakeCSS3DObject, CSS3DRenderer: FakeCSS3DRenderer };
});
vi.mock("./live-vibetv-preview", async () => {
  const { useEffect } = await import("react");
  return {
    LiveVibeTVPreview: ({ onScreenSettled }: { onScreenSettled?: () => void }) => {
      useEffect(() => {
        onScreenSettled?.();
      }, [onScreenSettled]);
      return null;
    },
  };
});

const requestFrame = vi.fn((callback: FrameRequestCallback) => {
  state.queue.push(callback);
  return state.queue.length;
});

beforeEach(() => {
  state.rendererFails = false;
  state.modelFails = false;
  state.angles = [];
  state.listeners = {};
  state.now = 0;
  state.queue = [];
  state.scene = null;
  requestFrame.mockClear();
  vi.spyOn(performance, "now").mockImplementation(() => state.now);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Runs the frames the preview asks for, 1/60 s apart, and records the sway
// angle of each. A preview that stops asking for frames just returns.
function runFrames(ms: number) {
  const end = state.now + ms;
  while (state.queue.length && state.now < end) {
    state.now += 1000 / 60;
    state.queue.shift()?.(state.now);
    state.angles.push(state.scene?.children[0].rotation.y ?? 0);
  }
}

function mountPreview() {
  render(<VibeTV3DPreview device={null} displayFrame={null} usage={null} />);
}

describe("3D VibeTV sway", () => {
  it("sways one cycle after the idle delay, then stands still and asks for no more frames", () => {
    mountPreview();
    runFrames(60_000);

    expect(Math.max(...state.angles.map(Math.abs))).toBeGreaterThan(0.1);
    expect(state.angles.at(-1)).toBe(0);
    expect(state.queue).toHaveLength(0);

    const requested = requestFrame.mock.calls.length;
    runFrames(60_000);
    expect(requestFrame.mock.calls.length).toBe(requested);
  });

  it("starts one more cycle after a drag, then stands still again", () => {
    mountPreview();
    runFrames(60_000);

    state.angles = [];
    state.listeners.start();
    state.listeners.end();
    runFrames(60_000);

    expect(Math.max(...state.angles.map(Math.abs))).toBeGreaterThan(0.1);
    expect(state.angles.at(-1)).toBe(0);
    expect(state.queue).toHaveLength(0);
  });
});

describe("3D preview failure", () => {
  it.each(["renderer", "model"])("reports a %s failure so the caller can reveal its fallback", async (failure) => {
    state.rendererFails = failure === "renderer";
    state.modelFails = failure === "model";
    const onFailed = vi.fn();
    const onReady = vi.fn();
    const { container } = render(
      <VibeTV3DPreview device={null} displayFrame={null} usage={null} onFailed={onFailed} onReady={onReady} />,
    );
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(container.childElementCount).toBe(0);
    expect(onReady).not.toHaveBeenCalled();
  });
});
