"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { themeRenderPackUrl } from "./control-center-runtime";
import {
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "./live-vibetv-preview";

type ThemeRenderPreviewProps = {
  animate?: boolean;
  className?: string;
  /** Supplied for a Theme Studio theme, whose spec only exists locally. */
  pack?: ThemeRenderPack | null;
  themeId: string;
  themeSpecPath?: string;
};

/**
 * Renders a theme the way the device would draw it, by loading its render pack.
 *
 * Shared by the theme library and the setup theme step so both show the same
 * picture from the same source; a stand-in swatch would only ever be a guess at
 * what the theme looks like.
 */
export function ThemeRenderPreview({
  animate = false,
  className,
  pack: providedPack,
  themeId,
  themeSpecPath,
}: ThemeRenderPreviewProps) {
  const requestKey = `${themeId}\n${themeSpecPath || ""}`;
  const [packState, setPackState] = useState<{
    pack: ThemeRenderPack | null;
    requestKey: string;
    status: "idle" | "loading" | "ready" | "error";
  }>({ pack: null, requestKey: "", status: "idle" });

  useEffect(() => {
    if (providedPack || !themeId) {
      return;
    }
    const controller = new AbortController();
    fetch(themeRenderPackUrl(themeId, themeSpecPath), {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("theme preview unavailable");
        }
        return response.json() as Promise<ThemeRenderPack>;
      })
      .then((payload) => {
        setPackState({
          pack: payload,
          requestKey,
          status: payload?.spec ? "ready" : "error",
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setPackState({ pack: null, requestKey, status: "error" });
      });
    return () => controller.abort();
  }, [providedPack, requestKey, themeId, themeSpecPath]);

  const pack =
    providedPack ||
    (packState.requestKey === requestKey && packState.status === "ready"
      ? packState.pack
      : null);
  const status = providedPack
    ? "ready"
    : packState.requestKey === requestKey
      ? packState.status
      : "loading";

  return (
    <span
      className={cn(
        "relative block overflow-hidden border border-border bg-muted",
        className,
      )}
    >
      <ThemeSpecPreview
        animate={animate}
        pack={pack}
        status={status}
        themeId={themeId}
      />
    </span>
  );
}
