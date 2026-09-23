"use client";

import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { cn } from "@/lib/utils";
import type { DeviceInfo, UsageSnapshot } from "./control-center-types";
import { LiveVibeTVPreview, type DisplayFrameSnapshot } from "./live-vibetv-preview";

type VibeTV3DPreviewProps = {
  className?: string;
  device: DeviceInfo | null;
  displayFrame: DisplayFrameSnapshot | null;
  updateOwnedDisconnect?: boolean;
  usage: UsageSnapshot | null;
};

const MODEL_URL = "/models/vibetv-native.glb";
const SCREEN_PX = 240;
// The GLB is authored in meters. CSS3D text vanishes in Chromium when its
// element is scaled to ~0.00012, so both renderers work in millimeters.
const WORLD_SCALE = 1000;
const PIVOT_Y = 0.02 * WORLD_SCALE;
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
const GLASS_HEIGHT = Math.hypot(
  GLASS.topY - GLASS.bottomY,
  GLASS.topZ - GLASS.bottomZ,
);
const GLASS_TILT = Math.atan2(
  GLASS.topZ - GLASS.bottomZ,
  GLASS.topY - GLASS.bottomY,
);
const MAX_YAW = 0.85;
const MAX_PITCH = 0.19;

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value));
}

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
  updateOwnedDisconnect = false,
  usage,
}: VibeTV3DPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const webglLayerRef = useRef<HTMLDivElement>(null);
  const cssLayerRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const rotationRef = useRef({ yaw: 0, pitch: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [screenHost, setScreenHost] = useState<HTMLDivElement | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);

  useEffect(() => {
    if (modelFailed) return;
    const stage = stageRef.current;
    const webglLayer = webglLayerRef.current;
    const cssLayer = cssLayerRef.current;
    if (!stage || !webglLayer || !cssLayer) return;

    let disposed = false;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      const timer = window.setTimeout(() => setModelFailed(true), 0);
      return () => window.clearTimeout(timer);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    const cssScene = new Scene();
    const modelPivot = new Group();
    const screenPivot = new Group();
    modelPivot.position.y = PIVOT_Y;
    screenPivot.position.y = PIVOT_Y;
    scene.add(modelPivot);
    cssScene.add(screenPivot);

    const camera = new PerspectiveCamera(32, 1, 0.005 * WORLD_SCALE, 2 * WORLD_SCALE);
    camera.position.set(0.0343 * WORLD_SCALE, 0.0447 * WORLD_SCALE, 0.1123 * WORLD_SCALE);
    camera.lookAt(0, 0.02 * WORLD_SCALE, 0.002 * WORLD_SCALE);

    scene.add(new AmbientLight(0xffffff, 1.05));
    const key = new DirectionalLight(0xffffff, 1.35);
    key.position.set(-0.045 * WORLD_SCALE, 0.1 * WORLD_SCALE, 0.09 * WORLD_SCALE);
    scene.add(key);

    const render = () => {
      const { yaw, pitch } = rotationRef.current;
      modelPivot.rotation.set(pitch, yaw, 0);
      screenPivot.rotation.copy(modelPivot.rotation);
      renderer.render(scene, camera);
      cssRenderer.render(cssScene, camera);
    };
    renderRef.current = render;

    const resize = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      cssRenderer.setSize(width, height);
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    const loader = new GLTFLoader();
    loader.load(
      MODEL_URL,
      (gltf) => {
        if (disposed) {
          disposeMeshes(gltf.scene);
          return;
        }
        gltf.scene.scale.setScalar(WORLD_SCALE);
        gltf.scene.position.y = -PIVOT_Y;
        gltf.scene.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          if (node.name === "housing" && node.material instanceof MeshStandardMaterial) {
            node.material.color.set("#fafaf6");
            node.material.roughness = 0.58;
          }
        });
        modelPivot.add(gltf.scene);

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
          ((GLASS.left + GLASS.right) / 2) * WORLD_SCALE,
          ((GLASS.bottomY + GLASS.topY) / 2 + 0.00003) * WORLD_SCALE - PIVOT_Y,
          ((GLASS.bottomZ + GLASS.topZ) / 2 + 0.00012) * WORLD_SCALE,
        );
        screen.rotation.x = GLASS_TILT;
        screen.scale.set(
          GLASS_WIDTH * WORLD_SCALE / SCREEN_PX,
          GLASS_HEIGHT * WORLD_SCALE / SCREEN_PX,
          1,
        );
        screenPivot.add(screen);
        setScreenHost(host);
        setModelReady(true);
        render();
      },
      undefined,
      () => { if (!disposed) setModelFailed(true); },
    );

    return () => {
      disposed = true;
      observer.disconnect();
      renderRef.current = null;
      disposeMeshes(scene);
      renderer.dispose();
      webglLayer.removeChild(renderer.domElement);
      cssLayer.removeChild(cssRenderer.domElement);
    };
  }, [modelFailed]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !modelReady) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: rotationRef.current.yaw,
      pitch: rotationRef.current.pitch,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    rotationRef.current = {
      yaw: clamp(drag.yaw + (event.clientX - drag.x) * 0.008, MAX_YAW),
      pitch: clamp(drag.pitch - (event.clientY - drag.y) * 0.006, MAX_PITCH),
    };
    renderRef.current?.();
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let { yaw, pitch } = rotationRef.current;
    switch (event.key) {
      case "ArrowLeft": yaw -= 0.12; break;
      case "ArrowRight": yaw += 0.12; break;
      case "ArrowUp": pitch += 0.08; break;
      case "ArrowDown": pitch -= 0.08; break;
      case "Home": yaw = 0; pitch = 0; break;
      default: return;
    }
    event.preventDefault();
    rotationRef.current = { yaw: clamp(yaw, MAX_YAW), pitch: clamp(pitch, MAX_PITCH) };
    renderRef.current?.();
  };

  if (modelFailed) {
    return <LiveVibeTVPreview device={device} displayFrame={displayFrame} updateOwnedDisconnect={updateOwnedDisconnect} usage={usage} />;
  }

  return (
    <div
      aria-label="Interactive VibeTV preview. Drag or use the arrow keys to rotate; press Home to reset."
      className={cn("relative aspect-[21/17] w-full max-w-[420px] touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      onKeyDown={onKeyDown}
      onPointerCancel={endDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      ref={stageRef}
      role="group"
      tabIndex={0}
    >
      <div aria-hidden className="pointer-events-none absolute bottom-[11%] left-1/2 h-[13%] w-[55%] -translate-x-1/2 rounded-full bg-black/10 blur-xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0" ref={webglLayerRef} />
      <div className="pointer-events-none absolute inset-0" ref={cssLayerRef} />
      {!modelReady ? (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground" role="status">
          Loading VibeTV preview…
        </div>
      ) : null}
      {screenHost ? createPortal(
        <LiveVibeTVPreview
          device={device}
          displayFrame={displayFrame}
          screenOnly
          updateOwnedDisconnect={updateOwnedDisconnect}
          usage={usage}
        />,
        screenHost,
      ) : null}
    </div>
  );
}
