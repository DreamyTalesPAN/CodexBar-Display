"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { loadLocalThemeRenderPack } from "@/lib/local-theme-render-pack";
import { normalizeThemeSpecHash } from "../control-center-runtime";
import {
  buildFrameData,
  fetchThemeRenderPackRevision,
  ThemeSpecPreview,
  themeRenderPackMatchesActiveRevision,
  type ThemeRenderPack,
} from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";

/** The theme VibeTV is showing, which the tiles draw. */
export type SetupDisplayModeTheme = {
  id: string;
  specHash?: string;
  specPath?: string;
};

export type ThemePackLoad = {
  pack: ThemeRenderPack | null;
  status: "loading" | "ready" | "error";
};

/**
 * Loads the active theme's render pack once for every tile of the step. The
 * pack is the same one the Appearance cards and the Overview draw from, so the
 * tiles show the real theme and nothing of their own.
 */
export function useThemeRenderPack(
  theme: SetupDisplayModeTheme | null | undefined,
): ThemePackLoad {
  const themeId = theme?.id || "";
  const specPath = theme?.specPath || "";
  const specHash = normalizeThemeSpecHash(theme?.specHash);
  const key = `${themeId}\n${specPath}\n${specHash}`;
  const [state, setState] = useState<{
    key: string;
    pack: ThemeRenderPack | null;
    status: "ready" | "error";
  } | null>(null);

  useEffect(() => {
    if (!themeId) {
      return;
    }
    const local = loadLocalThemeRenderPack(themeId, specPath);
    if (local && (!specHash || local.specHash === specHash)) {
      const timer = window.setTimeout(
        () => setState({ key, pack: local, status: "ready" }),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    fetchThemeRenderPackRevision(themeId, specPath, specHash, controller.signal)
      .then((payload) => {
        const matches = themeRenderPackMatchesActiveRevision(
          payload,
          specPath,
          specHash,
        );
        setState({
          key,
          pack: matches ? payload : null,
          status: matches ? "ready" : "error",
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({ key, pack: null, status: "error" });
      });
    return () => controller.abort();
  }, [key, specHash, specPath, themeId]);

  if (!themeId) {
    return { pack: null, status: "error" };
  }
  return state?.key === key
    ? { pack: state.pack, status: state.status }
    : { pack: null, status: "loading" };
}

/**
 * The strip a mode card shows: the active theme once per provider, each with
 * that provider's own readings. The one VibeTV is on is drawn large, the rest
 * recede. A provider with no readings yet gets a quiet placeholder where the
 * numbers would be; nothing is filled in for it.
 */
export function ThemeTileStrip({
  frames,
  index,
  pack,
}: {
  frames: SetupDisplayModePreview[];
  index: number;
  pack: ThemeRenderPack;
}) {
  return (
    <span
      className="flex h-[136px] w-full items-center justify-center gap-2.5 bg-muted px-1"
      data-slot="display-mode-preview"
    >
      {frames.map((frame, position) => (
        <ThemeTile
          active={position === index}
          frame={frame}
          key={`${frame.providerLabel}-${position}`}
          pack={pack}
        />
      ))}
    </span>
  );
}

function ThemeTile({
  active,
  frame,
  pack,
}: {
  active: boolean;
  frame: SetupDisplayModePreview;
  pack: ThemeRenderPack;
}) {
  const data = useMemo(
    () =>
      frame.frame
        ? buildFrameData(frame.frameAt, frame.frame, new Date())
        : null,
    [frame.frame, frame.frameAt],
  );
  return (
    <span
      className={cn(
        "block aspect-square min-w-0 shrink overflow-hidden rounded-[6px] bg-black transition-[width,opacity] duration-300",
        active ? "w-[104px] opacity-100" : "w-[84px] opacity-30",
      )}
      data-provider={frame.providerLabel}
      data-slot="display-mode-tile"
      data-state={data ? "live" : "skeleton"}
    >
      {data ? (
        <ThemeSpecPreview
          animate={active}
          frame={data}
          pack={pack}
          status="ready"
          themeId={pack.themeId || ""}
        />
      ) : (
        <span
          aria-label={`${frame.providerLabel}: no usage yet`}
          className="block size-full animate-pulse bg-foreground/15"
          role="img"
        />
      )}
    </span>
  );
}

/** What a card shows while the theme is still being read: the tile frames, empty. */
export function ThemeTileSkeleton({ count }: { count: number }) {
  return (
    <span
      className="flex h-[136px] w-full items-center justify-center gap-2.5 bg-muted px-1"
      data-slot="display-mode-preview"
    >
      {Array.from({ length: Math.max(1, count) }, (_, position) => (
        <span
          aria-hidden
          className={cn(
            "block aspect-square min-w-0 shrink animate-pulse rounded-[6px] bg-foreground/15",
            position === 0 ? "w-[104px]" : "w-[84px] opacity-30",
          )}
          data-slot="display-mode-tile"
          data-state="skeleton"
          key={position}
        />
      ))}
    </span>
  );
}
