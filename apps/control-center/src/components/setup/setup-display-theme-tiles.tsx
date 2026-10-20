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

/** Tile sizes and gap of the strip: the one in front, the ones behind it. */
const FRONT_SIZE = 104;
const BEHIND_SIZE = 84;
const TILE_GAP = 10;
const BEHIND_SCALE = BEHIND_SIZE / FRONT_SIZE;

/** Where a tile sits for a given place in line: 0 is the front. */
function slotOffset(slot: number): number {
  return slot === 0 ? 0 : FRONT_SIZE + TILE_GAP + (slot - 1) * (BEHIND_SIZE + TILE_GAP);
}

/**
 * The strip a mode card shows: the active theme once per provider, each with
 * that provider's own readings. The provider at `index` is drawn large in
 * front, the others wait behind it in turn and recede. When `index` moves on,
 * every tile slides one place toward the front; the one that was in front
 * fades in at the back. Only the order and the movement are decided here.
 * Under reduced motion the order changes without any movement.
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
  const width = count ? slotOffset(count - 1) + (count > 1 ? BEHIND_SIZE : FRONT_SIZE) : 0;
  // The back tile only fades in once the strip has moved at all, so the first
  // draw is still.
  const [moved, setMoved] = useState(index !== 0);
  if (!moved && index !== 0) setMoved(true);

  return (
    <span
      className="flex h-[136px] w-full items-center overflow-hidden bg-muted px-1"
      data-slot="display-mode-preview"
    >
      <span
        className="relative mx-auto block shrink-0"
        style={{ height: FRONT_SIZE, width }}
      >
        {frames.map((frame, position) => {
          const slot = (position - index + count) % count;
          return (
            <ThemeTile
              active={slot === 0}
              enters={!reducedMotion && moved && count > 1 && slot === count - 1}
              frame={frame}
              key={`${frame.providerLabel}-${position}`}
              pack={pack}
              reducedMotion={reducedMotion}
              slot={slot}
            />
          );
        })}
      </span>
    </span>
  );
}

function ThemeTile({
  active,
  enters,
  frame,
  pack,
  reducedMotion,
  slot,
}: {
  active: boolean;
  enters: boolean;
  frame: SetupDisplayModePreview;
  pack: ThemeRenderPack;
  reducedMotion: boolean;
  slot: number;
}) {
  const data = useMemo(
    () =>
      frame.frame
        ? buildFrameData(frame.frameAt, frame.frame, new Date())
        : null,
    [frame.frame, frame.frameAt],
  );
  const transform = `translateX(${slotOffset(slot)}px) scale(${active ? 1 : BEHIND_SCALE})`;
  return (
    <span
      className={cn(
        "absolute top-0 left-0 block overflow-hidden rounded-[6px] bg-black",
        active ? "opacity-100" : "opacity-30",
        !reducedMotion &&
          "transition-[transform,opacity] duration-500 ease-out will-change-transform",
      )}
      data-position={slot}
      data-provider={frame.providerLabel}
      data-slot="display-mode-tile"
      data-state={data ? "live" : "skeleton"}
      style={{
        animation: enters
          ? "vibetv-tile-wrap 500ms cubic-bezier(0, 0, 0.2, 1) both"
          : undefined,
        height: FRONT_SIZE,
        // The tile that just left the front fades out where it stood and in at
        // the back (vibetv-tile-wrap) instead of sliding across the others.
        transitionProperty: enters ? "opacity" : undefined,
        transform,
        ["--tile-to" as string]: transform,
        transformOrigin: "left center",
        width: FRONT_SIZE,
              }}
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
