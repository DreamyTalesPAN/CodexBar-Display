"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { hardwareWebGLAvailable } from "../vibetv-3d-support";

/**
 * The one 3D VibeTV of the app (the Overview's), loaded only when the setup
 * screens ask for it, so the three.js bundle never delays the wizard's first
 * paint.
 */
export const SetupVibeTV3DPreview = dynamic(
  () => import("../vibetv-3d-preview").then((module) => module.VibeTV3DPreview),
  { ssr: false },
);

/**
 * True once the browser is known to have a hardware WebGL context. Read after
 * the first paint, like the Overview does; until then, and on a software
 * renderer, the screen keeps its flat picture.
 */
export function useHardware3D(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setAvailable(hardwareWebGLAvailable()),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  return available;
}
