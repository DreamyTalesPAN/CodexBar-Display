import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatResetCountdown,
  remainingResetSecs,
} from "@/lib/reset-countdown";
import type { UsageProviderInfo } from "./control-center-types";
import { buildFrameData, renderTextPrimitive } from "./live-vibetv-preview";
import { displayPreviewFor } from "./setup/setup-display-previews";
import { UsageScreen } from "./usage-screen";

// One reading: at 10:00:00 the session had 26m 12s left. The frame for VibeTV
// left 30 seconds later, re-anchored to that moment as the Mac App does.
const collectedAt = "2026-10-08T10:00:00Z";
const resetSecs = 26 * 60 + 12;
const sentAt = "2026-10-08T10:00:30Z";
const provider: UsageProviderInfo = {
  id: "claude",
  label: "Claude",
  session: 40,
  weekly: 10,
  usageMode: "used",
  resetSecs,
  collectedAt,
  windows: [{ id: "session", label: "Session", usedPercent: 40, resetSecs }],
};

function resetTextOnEverySurface(at: string) {
  const now = new Date(at);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  return {
    overview: renderTextPrimitive(
      { t: "tx", v: "Reset in {reset}" },
      buildFrameData(
        sentAt,
        { v: 2, provider: "claude", label: "Claude", session: 40, resetSecs: resetSecs - 30 },
        now,
      ),
    ),
    usage: renderToStaticMarkup(
      <UsageScreen companionStatus="online" usage={{ providers: [provider] }} />,
    ).match(/Reset in [^<]+/)?.[0],
    settings: displayPreviewFor(provider, now)?.resetLabel,
  };
}

describe("reset countdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the same time left on Overview, Usage and the Settings preview", () => {
    // 2m 30s after the reading 23.7 minutes are left, not the 26 that were read.
    expect(resetTextOnEverySurface("2026-10-08T10:02:30Z")).toEqual({
      overview: "Reset in 23m",
      usage: "Reset in 23m",
      settings: "Reset in 23m",
    });
  });

  it("keeps counting down on every surface without a new reading", () => {
    expect(resetTextOnEverySurface("2026-10-08T10:03:13Z")).toEqual({
      overview: "Reset in 22m",
      usage: "Reset in 22m",
      settings: "Reset in 22m",
    });
    expect(resetTextOnEverySurface("2026-10-08T11:00:00Z")).toEqual({
      overview: "Reset unavailable",
      usage: undefined,
      settings: "Reset unknown",
    });
  });

  it("rounds down to whole minutes, as VibeTV does", () => {
    expect(formatResetCountdown(59)).toBe("0m");
    expect(formatResetCountdown(2 * 3600 + 14 * 60 + 59)).toBe("2h 14m");
    expect(formatResetCountdown(27 * 3600)).toBe("1d 3h");
  });

  it("shows the seconds as read when the reading carries no usable time", () => {
    const now = new Date("2026-10-08T10:02:30Z");
    expect(remainingResetSecs(600, undefined, now)).toBe(600);
    expect(remainingResetSecs(600, "not a time", now)).toBe(600);
    // A reading stamped ahead of this Mac's clock is not counted up.
    expect(remainingResetSecs(600, "2026-10-08T10:05:00Z", now)).toBe(600);
    expect(remainingResetSecs(undefined, collectedAt, now)).toBe(0);
  });
});
