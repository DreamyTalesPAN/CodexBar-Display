"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { loadLocalThemeRenderPack } from "@/lib/local-theme-render-pack";
import { normalizeThemeSpecHash } from "../control-center-runtime";
import {
  buildFrameData,
  THEME_PACK_RETRY_MS,
  fetchThemeRenderPackRevision,
  ThemeSpecPreview,
  themeRenderPackMatchesActiveRevision,
  type ThemeRenderPack,
} from "../live-vibetv-preview";
import type { SetupDisplayModePreview } from "./setup-display-mode-screen";
import { withActivityExpiry, withResetTrust } from "./setup-display-previews";

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
  const [retryNonce, setRetryNonce] = useState(0);

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
    let retryTimer: number | undefined;
    // Never a terminal error, as in the Overview's loader: the Companion may
    // still be starting, its pack cache building, or the first answer carry the
    // previous theme revision. The plain tiles stand in meanwhile.
    const scheduleRetry = () => {
      retryTimer = window.setTimeout(
        () => setRetryNonce((nonce) => nonce + 1),
        THEME_PACK_RETRY_MS,
      );
    };
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
        if (!matches) {
          scheduleRetry();
        }
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setState({ key, pack: null, status: "error" });
        scheduleRetry();
      });
    return () => {
      controller.abort();
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [key, retryNonce, specHash, specPath, themeId]);

  if (!themeId) {
    return { pack: null, status: "error" };
  }
  return state?.key === key
    ? { pack: state.pack, status: state.status }
    : { pack: null, status: "loading" };
}

/** How often the tiles read the clock again; countdowns flip on any second. */
const CLOCK_TICK_MS = 1000;

/**
 * The current time, read again every second so the clock and the reset
 * countdowns in a theme keep moving like VibeTV's own. One value is shared by
 * every tile of a card. It holds while the page is hidden, where nobody sees it
 * and the timer would keep a minimised window busy, and catches up when the
 * page is shown again. Reduced motion does not stop it: that setting is about
 * the fade between providers, not about the time.
 */
export function useClockNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const start = () => {
      stop();
      if (document.visibilityState === "hidden") {
        return;
      }
      timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") {
        setNow(new Date());
      }
      start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return now;
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
  const now = useClockNow();
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
            now={now}
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
  now,
  pack,
  reducedMotion,
}: {
  active: boolean;
  frame: SetupDisplayModePreview;
  now: Date;
  pack: ThemeRenderPack;
  reducedMotion: boolean;
}) {
  const data = useMemo(
    () =>
      frame.frame
        ? buildFrameData(
            frame.frameAt,
            // As the device does on every draw: an expired deadline or trust
            // horizon turns the frame stale and clears its countdowns.
            // ... and a coding verdict past its TTL shows idle (#369).
            withActivityExpiry(
              withResetTrust(frame.frame, frame.frameAt, now),
              frame.activityAt,
              now,
            ),
            now,
          )
        : null,
    [frame.frame, frame.frameAt, frame.activityAt, now],
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
      data-state={data ? "live" : "unavailable"}
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
          className="block size-full bg-foreground/15"
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
