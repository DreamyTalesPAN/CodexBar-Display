"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
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
      renderer = new WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      const timer = window.setTimeout(() => setModelFailed(true), 0);
      return () => window.clearTimeout(timer);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
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

    const camera = new PerspectiveCamera(28, 1, 0.1 * U, 50 * U);
    camera.position.set(1.55 * U, 1.05 * U, 3.4 * U);

    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(2.5 * U, 4 * U, 3 * U);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    Object.assign(key.shadow.camera, { left: -2 * U, right: 2 * U, top: 2 * U, bottom: -2 * U });
    scene.add(key, new HemisphereLight(0xffffff, 0xdedede, 0.6));

    const ground = new Mesh(new PlaneGeometry(8 * U, 8 * U), new ShadowMaterial({ opacity: 0.14 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5 * U;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(camera, stage);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 1.0;
    controls.maxPolarAngle = 1.55;
    controls.minAzimuthAngle = -1.2;
    controls.maxAzimuthAngle = 1.2;
    controls.rotateSpeed = 0.6;
    let touchedAt = 0;
    let dragging = false;
    controls.addEventListener("start", () => { dragging = true; });
    controls.addEventListener("end", () => {
      dragging = false;
      touchedAt = performance.now();
    });

    // Like the design: after 2.5 s without dragging, the device sways gently.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = performance.now();
    let frameRequest = 0;
    let previousAt = startedAt;
    const loop = () => {
      frameRequest = requestAnimationFrame(loop);
      const now = performance.now();
      const elapsed = Math.min(now - previousAt, 100);
      previousAt = now;
      if (!still && !dragging && now - touchedAt > 2500) {
        const sway = Math.sin(((now - startedAt) / 1000) * 0.35) * 0.18;
        modelPivot.rotation.y += (sway - modelPivot.rotation.y) * (1 - Math.pow(0.98, elapsed / (1000 / 60)));
        screenPivot.rotation.y = modelPivot.rotation.y;
      }
      controls.update();
      renderer.render(scene, camera);
      cssRenderer.render(cssScene, camera);
    };

    const resize = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      cssRenderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    loop();

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
          if (node instanceof Mesh) {
            node.castShadow = true;
            node.receiveShadow = true;
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
        setScreenHost(host);
        setModelReady(true);
      },
      undefined,
      () => { if (!disposed) setModelFailed(true); },
    );

    return () => {
      disposed = true;
      cancelAnimationFrame(frameRequest);
      observer.disconnect();
      controls.dispose();
      scene.environment?.dispose();
      pmrem.dispose();
      disposeMeshes(scene);
      renderer.dispose();
      webglLayer.removeChild(renderer.domElement);
      cssLayer.removeChild(cssRenderer.domElement);
    };
  }, [modelFailed]);

  if (modelFailed) {
    return <LiveVibeTVPreview device={device} displayFrame={displayFrame} updateOwnedDisconnect={updateOwnedDisconnect} usage={usage} />;
  }

  return (
    <div
      aria-label="Interactive VibeTV preview. Drag to rotate."
      className={cn("relative aspect-[21/17] w-full max-w-[520px] cursor-grab touch-none active:cursor-grabbing", className)}
      ref={stageRef}
      role="group"
    >
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
