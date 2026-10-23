// @vitest-environment jsdom
//
// #854: after 2.5 s without a touch the 3D VibeTV sways one full cycle and then
// stands still; it asks for no more animation frames from then on.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "three";
import { VibeTV3DPreview } from "./vibetv-3d-preview";

const state = vi.hoisted(() => ({
  rendererFails: false,
  modelFails: false,
  angles: [] as number[],
  listeners: {} as Record<string, () => void>,
  renders: 0,
  cssRenders: 0,
  resize: () => {},
  settle: () => {},
  autoSettle: true,
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
      state.renders += 1;
      state.angles.push(scene.children[0].rotation.y);
    }
    forceContextLoss() {}
    dispose() {}
  }
  class FakePMREMGenerator {
    fromScene() {
      return { texture: { dispose() {} } };
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
      if (state.modelFails) { onError(); return; }
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
    render() { state.cssRenders += 1; }
  }
  class FakeCSS3DObject extends Object3D {}
  return { CSS3DObject: FakeCSS3DObject, CSS3DRenderer: FakeCSS3DRenderer };
});
vi.mock("./live-vibetv-preview", async () => {
  const { useEffect } = await import("react");
  return {
    LiveVibeTVPreview: ({ onScreenSettled }: { onScreenSettled?: () => void }) => {
      state.settle = () => onScreenSettled?.();
      useEffect(() => {
        if (state.autoSettle) onScreenSettled?.();
      }, [onScreenSettled]);
      return null;
    },
  };
});

const requestFrame = vi.fn((callback: FrameRequestCallback) =>
  window.setTimeout(() => callback(performance.now()), 16),
);

let motionQuery: EventTarget & { matches: boolean };

function setReducedMotion(matches: boolean) {
  motionQuery.matches = matches;
  act(() => motionQuery.dispatchEvent(new Event("change")));
}

beforeEach(() => {
  vi.useFakeTimers();
  state.rendererFails = false;
  state.modelFails = false;
  state.angles = [];
  state.listeners = {};
  state.scene = null;
  state.renders = 0;
  state.cssRenders = 0;
  state.autoSettle = true;
  requestFrame.mockClear();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { state.resize = callback; }
    observe() {}
    disconnect() {}
  });
  motionQuery = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => motionQuery);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function runFrames(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function setHidden(hidden: boolean) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  fireEvent(document, new Event("visibilitychange"));
}

function mountPreview() {
  return render(<VibeTV3DPreview device={null} displayFrame={null} usage={null} />);
}

describe("3D VibeTV sway", () => {
  it("sways one cycle after the idle delay, then stands still and asks for no more frames", () => {
    mountPreview();
    runFrames(60_000);

    expect(Math.max(...state.angles)).toBeGreaterThan(0.1);
    expect(Math.min(...state.angles)).toBeLessThan(-0.1);
    expect(state.angles.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const requested = requestFrame.mock.calls.length;
    runFrames(60_000);
    expect(requestFrame.mock.calls.length).toBe(requested);
  });

  it("restarts rendering on a drag and sways once more after release", () => {
    mountPreview();
    runFrames(60_000);

    const renders = state.renders;
    state.angles = [];
    act(() => {
      state.listeners.start();
      state.listeners.change?.();
    });
    runFrames(16);
    expect(state.renders).toBeGreaterThan(renders);
    act(() => state.listeners.end());
    runFrames(60_000);

    expect(Math.max(...state.angles.map(Math.abs))).toBeGreaterThan(0.1);
    expect(state.angles.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels frames while hidden and resumes the interrupted cycle when visible", () => {
    mountPreview();
    runFrames(6_000);
    setHidden(true);
    const requested = requestFrame.mock.calls.length;
    const renders = state.renders;
    expect(vi.getTimerCount()).toBe(0);
    runFrames(60_000);
    expect(requestFrame.mock.calls.length).toBe(requested);
    expect(state.renders).toBe(renders);
    act(() => state.resize());
    expect(requestFrame.mock.calls.length).toBe(requested);
    setHidden(false);
    runFrames(60_000);
    expect(state.renders).toBeGreaterThan(renders);
    expect(Math.min(...state.angles)).toBeLessThan(-0.1);
    expect(state.angles.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not request frames when mounted hidden", () => {
    setHidden(true);
    mountPreview();
    runFrames(60_000);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(state.renders).toBe(0);
    setHidden(false);
    runFrames(60_000);
    expect(state.renders).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("draws a resize after settling, without restarting the sway", () => {
    mountPreview();
    runFrames(60_000);
    const renders = state.renders;
    act(() => state.resize());
    runFrames(60_000);
    expect(state.renders).toBe(renders + 1);
    expect(state.cssRenders).toBe(state.renders);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("draws new frame data after settling, without restarting the sway", () => {
    const view = mountPreview();
    runFrames(60_000);
    const renders = state.renders;
    view.rerender(<VibeTV3DPreview device={null} displayFrame={{}} usage={null} />);
    runFrames(60_000);
    expect(state.renders).toBe(renders + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("announces a late-settled screen even after motion has stopped", () => {
    state.autoSettle = false;
    const onReady = vi.fn();
    render(<VibeTV3DPreview device={null} displayFrame={null} usage={null} onReady={onReady} />);
    runFrames(60_000);
    expect(onReady).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    act(() => state.settle());
    runFrames(16);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("stays still with reduced motion and cancels its work on unmount", () => {
    motionQuery.matches = true;
    const view = mountPreview();
    runFrames(60_000);
    expect(state.angles.every((angle) => angle === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => state.resize());
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1_000, 6_000])("stops automatic motion when Reduce motion changes after %i ms", (elapsed) => {
    mountPreview();
    runFrames(elapsed);
    setReducedMotion(true);
    runFrames(16);
    const angles = state.angles.length;
    runFrames(60_000);
    expect(state.angles).toHaveLength(angles);
    expect(state.angles.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("applies a motion change while hidden before rendering again", () => {
    mountPreview();
    runFrames(6_000);
    setHidden(true);
    setReducedMotion(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    runFrames(16);
    expect(state.angles.at(-1)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows the next drag to restart a sway after Reduce motion is switched off", () => {
    motionQuery.matches = true;
    mountPreview();
    runFrames(60_000);
    setReducedMotion(false);
    act(() => { state.listeners.start(); state.listeners.end(); });
    runFrames(60_000);
    expect(Math.max(...state.angles)).toBeGreaterThan(0.1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the motion listener on unmount", () => {
    const remove = vi.spyOn(motionQuery, "removeEventListener");
    const view = mountPreview();
    view.unmount();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
    setReducedMotion(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});


describe("3D preview failure", () => {
  it.each(["renderer", "model"])("reports a %s failure so the caller reveals its fallback", (failure) => {
    state.rendererFails = failure === "renderer";
    state.modelFails = failure === "model";
    const onFailed = vi.fn();
    const onReady = vi.fn();
    const { container } = render(<VibeTV3DPreview device={null} displayFrame={null} usage={null} onReady={onReady} onFailed={onFailed} />);
    runFrames(0);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});
