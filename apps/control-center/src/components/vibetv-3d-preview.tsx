"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { cn } from "@/lib/utils";
import type { DeviceInfo, UsageSnapshot } from "./control-center-types";
import { LiveVibeTVPreview, type DisplayFrameSnapshot } from "./live-vibetv-preview";

type VibeTV3DPreviewProps = {
  className?: string;
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  /**
   * Called on the first frame with the model on screen and a screen that no
   * longer says "Loading preview", whether or not VibeTV has a live frame to
   * show; the caller then drops its flat preview.
   */
  onReady?: () => void;
  updateOwnedDisconnect?: boolean;
  usage: UsageSnapshot | null;
};

const MODEL_URL = "/models/vibetv-native.glb";
const SCREEN_PX = 240;
// The GLB is authored in meters. CSS3D text vanishes in Chromium at tiny
// element scales, so the scene works in millimeters. Staging numbers come from
// VibeTV3D.js in the Claude Design file, whose unit is 35 mm.
const MM = 1000;
const U = 35;
// Front-face corners measured from display_glass in the bundled GLB. The
// screen is tilted back, so a flat z-facing overlay would float above it.
const GLASS = {
  left: -0.01435,
  right: 0.01435,
  bottomY: 0.008781163,
  bottomZ: 0.027772058,
  topY: 0.035949443,
  topZ: 0.020998245,
};
const GLASS_WIDTH = GLASS.right - GLASS.left;
const GLASS_HEIGHT = Math.hypot(GLASS.topY - GLASS.bottomY, GLASS.topZ - GLASS.bottomZ);
const GLASS_TILT = Math.atan2(GLASS.topZ - GLASS.bottomZ, GLASS.topY - GLASS.bottomY);
// After 2.5 s without a touch the device sways one full cycle, then stands still.
const SWAY_DELAY_MS = 2500;
const SWAY_SPEED = 0.35;
const SWAY_CYCLE_MS = (2 * Math.PI / SWAY_SPEED) * 1000;

function disposeMeshes(root: Object3D) {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    if (Array.isArray(node.material)) {
      node.material.forEach((material) => material.dispose());
    } else {
      node.material.dispose();
    }
  });
}

/** The bundled product model with the exact current VibeTV display output. */
export function VibeTV3DPreview({
  className,
  device,
  displayFrame,
  onReady,
  updateOwnedDisconnect = false,
  usage,
}: VibeTV3DPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const webglLayerRef = useRef<HTMLDivElement>(null);
  const cssLayerRef = useRef<HTMLDivElement>(null);
  const [screenHost, setScreenHost] = useState<HTMLDivElement | null>(null);
  const [modelFailed, setModelFailed] = useState(false);
  const onReadyRef = useRef(onReady);
  const invalidateRef = useRef<(() => void) | null>(null);
  const screenSettledRef = useRef(false);
  const onScreenSettled = useCallback(() => {
    screenSettledRef.current = true;
    invalidateRef.current?.();
  }, []);
  // A settled screen (e.g. no VibeTV yet) can still switch to "Loading
  // preview" when a VibeTV and its frame arrive: then it is not ready again.
  const onScreenLoading = useCallback(() => {
    screenSettledRef.current = false;
  }, []);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (modelFailed) return;
    const stage = stageRef.current;
    const webglLayer = webglLayerRef.current;
    const cssLayer = cssLayerRef.current;
    if (!stage || !webglLayer || !cssLayer) return;

    let disposed = false;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      const timer = window.setTimeout(() => setModelFailed(true), 0);
      return () => window.clearTimeout(timer);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    // Slightly lower exposure and a stronger ground shadow than the first 3D
    // build; the values are the ones in the approved Overview picture.
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    webglLayer.appendChild(renderer.domElement);

    const cssRenderer = new CSS3DRenderer();
    cssRenderer.domElement.style.position = "absolute";
    cssRenderer.domElement.style.inset = "0";
    cssRenderer.domElement.style.pointerEvents = "none";
    cssLayer.appendChild(cssRenderer.domElement);

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const cssScene = new Scene();
    const modelPivot = new Group();
    const screenPivot = new Group();
    scene.add(modelPivot);
    cssScene.add(screenPivot);

    // The picture of the approved calm Overview (Calm Redesign frame 1): seen
    // from a little lower, turned about 25 degrees off the front, and framed
    // tight so the device is 237 px wide on the 1200 px frame. The numbers were
    // fitted against that frame, with the stage 640 x 371 px plus 20 px of air
    // above and below.
    const camera = new PerspectiveCamera(24.4, 1, 0.1 * U, 50 * U);
    camera.position.set(1.55 * U, 0.3 * U, 3.4 * U);

    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(2.5 * U, 4 * U, 3 * U);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    Object.assign(key.shadow.camera, { left: -2 * U, right: 2 * U, top: 2 * U, bottom: -2 * U });
    scene.add(key, new HemisphereLight(0xffffff, 0xdedede, 0.6));

    const ground = new Mesh(new PlaneGeometry(8 * U, 8 * U), new ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5 * U;
    ground.receiveShadow = true;
    scene.add(ground);

    // Only a moving scene is drawn again. The screen inside is live DOM and
    // animates on its own, so a still device needs no WebGL frames at all.
    let dirty = true;
    const controls = new OrbitControls(camera, stage);
    controls.target.set(-2.3, 1.0, 0);
    camera.lookAt(controls.target);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 1.0;
    controls.maxPolarAngle = 1.55;
    controls.minAzimuthAngle = -1.2;
    controls.maxAzimuthAngle = 1.2;
    controls.rotateSpeed = 0.6;
    // Counted from mount: the first frame of a new Overview must not sway.
    let touchedAt = performance.now();
    // Set once the model and its screen are in the scene; announced after the
    // first frame that draws them and once the screen has its theme.
    let modelShown = false;
    let drawn = false;
    let announced = false;
    let dragging = false;
    controls.addEventListener("start", () => {
      dragging = true;
      window.clearTimeout(swayTimer);
      wake();
    });
    controls.addEventListener("change", () => invalidate());
    controls.addEventListener("end", () => {
      dragging = false;
      touchedAt = performance.now();
      wake();
    });

    // Like the design: 2.5 s after the last touch the device sways once, a full
    // cycle, and then stands still. A drag starts the count again.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frameRequest: number | null = null;
    let swayTimer = 0;
    let hiddenAt = document.hidden ? performance.now() : null;
    let previousAt = performance.now();
    const loop = () => {
      frameRequest = null;
      if (disposed || document.hidden) return;
      const now = performance.now();
      const elapsed = Math.min(now - previousAt, 100);
      previousAt = now;
      const swayAt = now - touchedAt - SWAY_DELAY_MS;
      const swaying = !still && !dragging && swayAt > 0 && swayAt < SWAY_CYCLE_MS;
      const before = modelPivot.rotation.y;
      if (!dragging) {
        const target = swaying ? Math.sin((swayAt / 1000) * SWAY_SPEED) * 0.18 : 0;
        const eased = before + (target - before) * (1 - Math.pow(0.98, elapsed / (1000 / 60)));
        // Snapping onto the rest angle lets the frames stop.
        modelPivot.rotation.y = Math.abs(target - eased) < 1e-4 ? target : eased;
        screenPivot.rotation.y = modelPivot.rotation.y;
      }
      const spun = modelPivot.rotation.y !== before;
      const turned = controls.update();
      if (turned || spun || dirty) {
        dirty = false;
        renderer.render(scene, camera);
        cssRenderer.render(cssScene, camera);
        drawn = modelShown;
      }
      // The flat preview goes only when the 3D screen shows no loading text.
      if (drawn && screenSettledRef.current && !announced) {
        announced = true;
        onReadyRef.current?.();
      }
      if (swaying || spun || turned) wake();
      // No frames during the idle delay or while waiting for the model/screen.
      // Those wake this loop themselves when they are ready.
      window.clearTimeout(swayTimer);
      if (!still && !dragging && swayAt <= 0) {
        swayTimer = window.setTimeout(wake, -swayAt + 1);
      }
    };
    // Restarts the frames after they stopped, e.g. for a drag or a resize.
    const wake = () => {
      if (!disposed && !document.hidden && frameRequest === null) {
        frameRequest = requestAnimationFrame(loop);
      }
    };
    const invalidate = () => {
      dirty = true;
      wake();
    };
    invalidateRef.current = invalidate;

    const visibilityChanged = () => {
      const now = performance.now();
      if (document.hidden) {
        hiddenAt ??= now;
        if (frameRequest !== null) cancelAnimationFrame(frameRequest);
        frameRequest = null;
        window.clearTimeout(swayTimer);
      } else {
        // Resume the same cycle, excluding time the window spent hidden.
        if (hiddenAt !== null) touchedAt += now - hiddenAt;
        hiddenAt = null;
        previousAt = now;
        wake();
      }
    };
    document.addEventListener("visibilitychange", visibilityChanged);

    const resize = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      cssRenderer.setSize(width, height);
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) {
          disposeMeshes(gltf.scene);
          return;
        }
        const model = gltf.scene;
        model.scale.setScalar(MM);
        model.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
          // The CAD housing white is short on blue (0.732 vs 0.764). The key
          // light blows the front face up to a neutral white, and the side
          // keeps the warmth, so the body reads as two colors.
          if (node.name === "housing") {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
              if (!("color" in material) || material.color == null) continue;
              const level = Math.max(material.color.r, material.color.g, material.color.b);
              material.color.setRGB(level, level, level);
            }
          }
          // The glass fillet above the live screen faces the key light, so the
          // top edge of the opening reads as a gray bar. The preview already
          // covers the glass face; keep the rim black.
          if (node.name !== "display_glass") return;
          const previous = node.material;
          node.material = new MeshBasicMaterial({ color: 0x000000 });
          node.castShadow = false;
          node.receiveShadow = false;
          for (const material of Array.isArray(previous) ? previous : [previous]) {
            material.dispose();
          }
        });
        model.updateMatrixWorld(true);
        const box = new Box3().setFromObject(model);
        const center = box.getCenter(new Vector3());
        model.position.set(-center.x, -box.min.y - 0.5 * U, -center.z);
        modelPivot.add(model);

        const host = document.createElement("div");
        host.style.width = `${SCREEN_PX}px`;
        host.style.height = `${SCREEN_PX}px`;
        host.style.overflow = "hidden";
        host.style.borderRadius = "7px";
        host.style.background = "#050505";
        host.style.backfaceVisibility = "hidden";
        host.style.pointerEvents = "none";
        const screen = new CSS3DObject(host);
        screen.position.set(
          ((GLASS.left + GLASS.right) / 2) * MM,
          ((GLASS.bottomY + GLASS.topY) / 2 + 0.00003) * MM,
          ((GLASS.bottomZ + GLASS.topZ) / 2 + 0.00012) * MM,
        ).add(model.position);
        screen.rotation.x = GLASS_TILT;
        screen.scale.set(GLASS_WIDTH * MM / SCREEN_PX, GLASS_HEIGHT * MM / SCREEN_PX, 1);
        screenPivot.add(screen);
        modelShown = true;
        invalidate();
        setScreenHost(host);
      },
      undefined,
      () => { if (!disposed) setModelFailed(true); },
    );

    return () => {
      disposed = true;
      invalidateRef.current = null;
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      window.clearTimeout(swayTimer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      observer.disconnect();
      controls.dispose();
      scene.environment?.dispose();
      pmrem.dispose();
      disposeMeshes(scene);
      // Every Overview visit mounts a new scene; release this context now
      // instead of waiting for the browser's per-page context limit.
      renderer.forceContextLoss();
      renderer.dispose();
      webglLayer.removeChild(renderer.domElement);
      cssLayer.removeChild(cssRenderer.domElement);
    };
  }, [modelFailed]);

  useEffect(() => {
    invalidateRef.current?.();
  }, [displayFrame]);

  // Without WebGL the caller keeps its flat live preview on screen.
  if (modelFailed) {
    return null;
  }

  return (
    <div
      aria-label="Interactive VibeTV preview. Drag to rotate."
      className={cn("relative aspect-[63/34] w-full max-w-[780px] cursor-grab touch-none active:cursor-grabbing", className)}
      ref={stageRef}
      role="group"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0" ref={webglLayerRef} />
      <div className="pointer-events-none absolute inset-0" ref={cssLayerRef} />
      {!screenHost ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground" role="status">
          Loading VibeTV preview…
        </div>
      ) : null}
      {screenHost ? createPortal(
        <LiveVibeTVPreview
          device={device}
          displayFrame={displayFrame}
          onScreenSettled={onScreenSettled}
          onScreenLoading={onScreenLoading}
          screenOnly
          updateOwnedDisconnect={updateOwnedDisconnect}
          usage={usage}
        />,
        screenHost,
      ) : null}
    </div>
  );
}
