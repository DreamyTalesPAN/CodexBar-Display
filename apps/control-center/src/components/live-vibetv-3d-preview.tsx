"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { LiveVibeTVPreview } from "./live-vibetv-preview";
import { hardwareWebGLAvailable } from "./vibetv-3d-support";

const VibeTV3DPreview = dynamic(
  () => import("./vibetv-3d-preview").then((module) => module.VibeTV3DPreview),
  { ssr: false },
);

type Props = Omit<ComponentProps<typeof VibeTV3DPreview>, "onReady" | "onFailed">;

/** Setup and Overview reveal only the real model, never a substitute photo. */
export function LiveVibeTV3DPreview({ className, onPreviewReady, ...props }: Props) {
  const [hardware3D, setHardware3D] = useState<boolean | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const onReady = useCallback(() => setState("ready"), []);
  const onFailed = useCallback(() => setState("failed"), []);
  useEffect(() => {
    const timer = window.setTimeout(() => setHardware3D(hardwareWebGLAvailable()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const ready = state === "ready";
  const unavailable = hardware3D === false || state === "failed";
  return (
    <div className="relative flex w-full justify-center">
      {hardware3D && !unavailable ? (
        <div
          aria-hidden={ready ? undefined : true}
          inert={ready ? undefined : true}
          className={ready ? "flex w-full justify-center" : "absolute inset-0 flex justify-center opacity-0"}
        >
          <VibeTV3DPreview
            {...props}
            className={className}
            onReady={onReady}
            onFailed={onFailed}
            onPreviewReady={ready ? onPreviewReady : undefined}
          />
        </div>
      ) : null}
      {!ready ? (
        <div className={cn("grid w-full place-items-center text-sm text-muted-foreground", className)}>
          {unavailable ? (
            <LiveVibeTVPreview {...props} onPreviewReady={onPreviewReady} unavailable3D />
          ) : <p role="status">Loading 3D preview…</p>}
        </div>
      ) : null}
    </div>
  );
}
