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

/** The one tile's size, as in template frame 22. */
const FRONT_SIZE = 104;

/**
 * What a mode card shows: ONE tile with the active theme (Paul, 20.10.2026).
 * In Automatic the tile changes provider every rotation step: the provider at
 * `index` fades in over the one before it, with that provider's own readings.
 * Manual passes one frame and nothing changes. Under reduced motion the
 * provider changes without the fade.
 *
 * A provider with no readings yet gets a quiet placeholder where the numbers
 * would be; nothing is filled in for it.
 */
export function ThemeTileStrip({
  frames,
  index,
  pack,
  reducedMotion = false,
}: {
  frames: SetupDisplayModePreview[];
  index: number;
  pack: ThemeRenderPack;
  reducedMotion?: boolean;
}) {
  const count = frames.length;
  const current = count ? ((index % count) + count) % count : 0;
  return (
    <span
      className="flex h-[136px] w-full items-center overflow-hidden bg-muted px-1"
      data-slot="display-mode-preview"
    >
      <span
        className="relative mx-auto block shrink-0"
        style={{ height: FRONT_SIZE, width: FRONT_SIZE }}
      >
        {frames.map((frame, position) => (
          <ThemeTile
            active={position === current}
            frame={frame}
            key={`${frame.providerLabel}-${position}`}
            pack={pack}
            reducedMotion={reducedMotion}
          />
        ))}
      </span>
    </span>
  );
}

function ThemeTile({
  active,
  frame,
  pack,
  reducedMotion,
}: {
  active: boolean;
  frame: SetupDisplayModePreview;
  pack: ThemeRenderPack;
  reducedMotion: boolean;
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
      aria-hidden={active ? undefined : true}
      className={cn(
        "absolute inset-0 block overflow-hidden rounded-[6px] bg-black",
        active ? "opacity-100" : "opacity-0",
        !reducedMotion && "transition-opacity duration-500 ease-out",
      )}
      data-provider={frame.providerLabel}
      data-slot="display-mode-tile"
      data-state={data ? "live" : "skeleton"}
      data-visible={active ? "true" : "false"}
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
export function ThemeTileSkeleton({ count: _count }: { count: number }) {
  return (
    <span
      className="flex h-[136px] w-full items-center justify-center bg-muted px-1"
      data-slot="display-mode-preview"
    >
      <span
        aria-hidden
        className="block aspect-square w-[104px] animate-pulse rounded-[6px] bg-foreground/15"
        data-slot="display-mode-tile"
        data-state="skeleton"
      />
    </span>
  );
}
