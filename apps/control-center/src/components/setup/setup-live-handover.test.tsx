// @vitest-environment jsdom
// Exercise the real setup, renderer and both live-preview readiness paths.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Scene } from "three";
import { SetupLiveScreen } from "./setup-live-screen";
import type { DeviceInfo } from "../control-center-types";
import type { DisplayFrameSnapshot } from "../live-vibetv-preview";

const state = vi.hoisted(() => ({
  rendererFails: false, modelFails: false, angles: [] as number[],
  listeners: {} as Record<string, () => void>, scene: null as Scene | null,
  renders: 0, cssRenders: 0, portal: null as HTMLElement | null,
}));
vi.mock("./setup-3d-preview", async () => ({
  SetupVibeTV3DPreview: (await import("../vibetv-3d-preview")).VibeTV3DPreview,
  useHardware3D: () => true,
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
  class FakeCSS3DObject extends Object3D {
    constructor(element: HTMLElement) { super(); state.portal = element; }
  }
  return { CSS3DObject: FakeCSS3DObject, CSS3DRenderer: FakeCSS3DRenderer };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("hands over only after the visible 3D screen loads the current revision", async () => {
  const pending: { revision: string; resolve: (value: Response) => void }[] = [];
  const response = (revision: string) => ({
    ok: true, status: 200, json: async () => ({
      themeId: "codex", spec: { p: [] }, assets: {},
      specPath: `/themes/codex/${revision}.json`, specHash: revision,
    }),
  }) as Response;
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>((resolve) => {
    pending.push({ revision: String(url).includes("rev-b") ? "rev-b" : "rev-a", resolve });
  })));
  const device = (revision: string) => ({
    active: true, connected: true, ready: true, paired: true, activeTheme: "codex",
    display: { themeSpec: { active: true, renderOk: true,
      path: `/themes/codex/${revision}.json`, hash: revision } },
  }) as DeviceInfo;
  const frame = { ok: true, frame: { v: 2, provider: "codex", label: "Codex",
    usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }] } } as DisplayFrameSnapshot;
  const finished = vi.fn();
  const view = (revision: string) => <SetupLiveScreen device={device(revision)}
    displayFrame={frame} usage={null} onPreviewReady={finished} />;
  const { rerender, container } = render(view("rev-a"));
  await act(async () => {
    for (const request of pending.filter((p) => p.revision === "rev-a")) request.resolve(response("rev-a"));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(32); });
  expect(container.querySelector('[aria-hidden="true"][inert]')).toBeNull();
  expect(state.portal?.textContent).not.toContain("Loading preview");
  expect(finished).not.toHaveBeenCalled();

  rerender(view("rev-b"));
  const requests = pending.filter((p) => p.revision === "rev-b");
  // React runs the 3D portal's effect first. On the broken implementation,
  // the second independent request belongs to the hidden flat preview.
  expect(requests.length).toBeGreaterThan(0);
  await act(async () => {
    for (const request of requests.slice(1)) request.resolve(response("rev-b"));
  });
  expect(state.portal?.textContent).toContain("Loading preview");
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
  expect(finished).not.toHaveBeenCalled();

  await act(async () => { requests[0].resolve(response("rev-b")); });
  expect(state.portal?.textContent).not.toContain("Loading preview");
  await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
  expect(finished).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(finished).toHaveBeenCalledTimes(1);
});
