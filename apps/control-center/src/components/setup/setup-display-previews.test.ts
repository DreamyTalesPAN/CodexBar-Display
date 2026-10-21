import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { buildFrameData, renderTextPrimitive } from "../live-vibetv-preview";
import {
  displayPreviewFor,
  pairDisplayPreview,
  displayPreviewsFor,
  pinnedPreview,
  providerSlotsFor,
  withResetTrust,
  withActivityExpiry,
  withSentActivity,
} from "./setup-display-previews";

// The readings below are stamped 2026-10-20T08:00Z; a frame older than the 5 h
// trust horizon is stale, so the clock must stay near them or these tests fail
// a few hours after they were written.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T08:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function provider(fields: Partial<UsageProviderInfo>): UsageProviderInfo {
  return {
    id: "codex",
    label: "Codex",
    session: 42,
    weekly: 26,
    resetSecs: 3 * 3600,
    usageMode: "used",
    ...fields,
  };
}

describe("displayPreviewFor", () => {
  it("carries the provider's own reading", () => {
    expect(displayPreviewFor(provider({}))).toMatchObject({
      providerLabel: "Codex",
      resetLabel: "Reset in 3h 0m",
      windows: [{ label: "Session", percent: 42 }, { label: "Weekly", percent: 26 }],
    });
  });

  it("leaves a window the collector could not read unavailable", () => {
    const preview = displayPreviewFor(
      provider({ weeklyUnavailable: true }),
    );

    expect(preview?.windows[0].percent).toBe(42);
    expect(preview?.windows[1].percent).toBeNull();
  });

  it("shows nothing measured when the provider itself has no usage", () => {
    const preview = displayPreviewFor(provider({ usageUnavailable: true }));

    expect(preview?.windows[0].percent).toBeNull();
    expect(preview?.windows[1].percent).toBeNull();
    expect(preview?.resetLabel).toBeNull();
  });

  it("never turns a missing reading into a zero", () => {
    const preview = displayPreviewFor(
      provider({ session: 0, sessionUnavailable: true }),
    );

    expect(preview?.windows[0].percent).not.toBe(0);
    expect(preview?.windows[0].percent).toBeNull();
  });

  it("preserves the collector's window labels when the primary window is absent", () => {
    expect(displayPreviewFor(provider({
      session: 28,
      weekly: 0,
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 28 }, { id: "codex-spark", label: "Codex Spark 5-hour", usedPercent: 0 }],
    }))?.windows).toEqual([{ label: "Weekly", percent: 28 }, { label: "Codex Spark 5-hour", percent: 0 }]);
  });

  it("has nothing to draw without a provider", () => {
    expect(displayPreviewFor(undefined)).toBeNull();
  });
});

describe("displayPreviewFor: the frame the theme draws", () => {
  const stamped = "2026-10-20T08:00:00Z";

  it("passes the usage service's values through unchanged", () => {
    const preview = displayPreviewFor(
      provider({
        collectedAt: stamped,
        usageMode: "remaining",
        windows: [
          { id: "session", label: "Session", usedPercent: 64, resetSecs: 3600 },
          { id: "weekly", label: "Weekly", usedPercent: 28, resetSecs: 7200 },
        ],
      }),
    );

    expect(preview?.frameAt).toBe(stamped);
    expect(preview?.frame).toMatchObject({
      provider: "codex",
      label: "Codex",
      usageMode: "remaining",
      usageWindows: [
        { id: "session", label: "Session", percent: 64, resetSecs: 3600 },
        { id: "weekly", label: "Weekly", percent: 28, resetSecs: 7200 },
      ],
    });
  });

  it("keeps a legacy provider's root values but invents no window slots", () => {
    // /v1/usage without windows: the host frame keeps only the root session and
    // weekly, so slot-bound rows must stay unavailable here too (Codex on #821).
    const frame = displayPreviewFor(provider({}))?.frame;

    expect(frame).toMatchObject({ session: 42, weekly: 26 });
    expect(frame?.usageWindows).toEqual([]);
  });

  it("leaves a window the collector could not read out of the frame", () => {
    const windows = displayPreviewFor(
      provider({
        windows: [
          { id: "session", label: "Session", usedPercent: 42, resetSecs: 3600 },
          { id: "weekly", label: "Weekly", usedPercent: Number.NaN, resetSecs: 7200 },
        ],
      }),
    )?.frame?.usageWindows;

    expect(windows).toHaveLength(1);
    expect(windows?.[0].id).toBe("session");
  });

  it("keeps a legacy provider's root reset when only its session is unreadable", () => {
    // No windows, session unreadable, weekly readable: the frame sent to VibeTV
    // keeps the root countdown, so the tile must show it too (Codex on #821).
    const now = new Date("2026-10-20T10:00:00Z");
    const preview = displayPreviewFor(
      provider({
        sessionUnavailable: true,
        weekly: 26,
        resetSecs: 3 * 3600,
        collectedAt: now.toISOString(),
      }),
      now,
    );

    expect(preview?.frame?.resetSecs).toBe(3 * 3600);
    expect(preview?.frame?.resetTrust).toBe("live");
    expect(preview?.resetLabel).toBe("Reset in 3h 0m");
  });

  it("has no frame for a provider without usage, so its tile stays a placeholder", () => {
    expect(displayPreviewFor(provider({ usageUnavailable: true }))?.frame).toBeUndefined();
    expect(displayPreviewFor(provider({ stale: true }))?.frame).toBeUndefined();
    expect(
      displayPreviewFor(provider({ sessionUnavailable: true, weeklyUnavailable: true }))
        ?.frame,
    ).toBeUndefined();
  });
});

describe("displayPreviewsFor: token totals the usage service already read", () => {
  it("marks zero token totals as known once the snapshot's token history is ready", () => {
    // /v1/usage leaves all-zero totals out but sets tokenUsageReady (Codex on #821).
    const ready = { tokenUsageReady: true, providers: [provider({ id: "codex", label: "Codex" })] } as UsageSnapshot;
    const notReady = { providers: [provider({ id: "codex", label: "Codex" })] } as UsageSnapshot;
    expect(displayPreviewsFor(ready, [{ id: "codex", label: "Codex" }])[0]?.frame?.tokenTotalsKnown).toBe(true);
    expect(displayPreviewsFor(notReady, [{ id: "codex", label: "Codex" }])[0]?.frame?.tokenTotalsKnown).toBeUndefined();
  });
});

describe("displayPreviewsFor", () => {
  const usage = {
    providers: [
      provider({ id: "codex", label: "Codex" }),
      provider({ id: "cursor", label: "Cursor", session: 18 }),
      provider({ id: "claude", label: "Claude", session: 71 }),
    ],
  } as UsageSnapshot;

  const enabled = (...ids: string[]) =>
    ids.map((id) => ({
      id,
      label: id.slice(0, 1).toUpperCase() + id.slice(1),
    }));

  it("rotates only through the providers that are switched on", () => {
    const previews = displayPreviewsFor(usage, enabled("codex", "claude"));

    expect(previews.map((p) => p.providerLabel)).toEqual(["Codex", "Claude"]);
  });

  it("keeps the order the providers are switched on in", () => {
    const previews = displayPreviewsFor(
      usage,
      enabled("claude", "codex", "cursor"),
    );

    expect(previews.map((p) => p.providerLabel)).toEqual([
      "Claude",
      "Codex",
      "Cursor",
    ]);
  });

  // Dropping a provider the usage service has not reported yet shrank the
  // rotation to whatever had already been read. On a Mac where that was one
  // provider, Automatic held still and looked exactly like Manual.
  it("keeps a provider that has no reading yet, as unavailable", () => {
    const previews = displayPreviewsFor(usage, enabled("codex", "gemini"));

    expect(previews.map((p) => p.providerLabel)).toEqual(["Codex", "Gemini"]);
    expect(previews[1]).toEqual({
      providerLabel: "Gemini",
      resetLabel: null,
      windows: [],
    });
  });

  it("has an empty rotation when nothing is switched on", () => {
    expect(displayPreviewsFor(usage, [])).toEqual([]);
    expect(displayPreviewsFor(null, enabled("codex"))).toEqual([
      {
        providerLabel: "Codex",
        resetLabel: null,
        windows: [],
      },
    ]);
  });
});

describe("provider slots in the synthesized frames", () => {
  const stamped = "2026-10-20T08:00:00Z";
  const usage = {
    providers: [
      provider({
        id: "claude",
        label: "Claude",
        collectedAt: stamped,
        windows: [
          { id: "session", label: "Session", usedPercent: 30, resetSecs: 7200 },
          { id: "weekly", label: "Weekly", usedPercent: 55, resetSecs: 3600 },
        ],
      }),
      provider({
        id: "codex",
        label: "Codex",
        collectedAt: stamped,
        windows: [{ id: "weekly", label: "Weekly", usedPercent: 12, resetSecs: 10800 }],
      }),
      provider({ id: "cursor", label: "Cursor", collectedAt: stamped, resetSecs: 600 }),
    ],
  } as UsageSnapshot;
  const enabled = [
    { id: "claude", label: "Claude" },
    { id: "codex", label: "Codex" },
    { id: "cursor", label: "Cursor" },
  ];

  it("gives every tile the same two provider rows, so pv1*/pv2* themes draw their reset rows", () => {
    const previews = displayPreviewsFor(usage, enabled);

    for (const preview of previews) {
      expect(preview.frame?.providerSlots).toEqual([
        { id: "claude", label: "Claude", percent: 55, resetSecs: 3600 },
        { id: "codex", label: "Codex", percent: 12, resetSecs: 10800 },
      ]);
    }
    const data = buildFrameData(stamped, previews[2].frame!, new Date("2026-10-20T08:00:00Z"));
    expect(data.providerSlots).toMatchObject([
      { label: "Claude", percent: 55, resetSecs: 3600, available: true },
      { label: "Codex", percent: 12, resetSecs: 10800, available: true },
    ]);
  });

  it("leaves out a provider that is stale, unavailable or has no deadline", () => {
    const rows = providerSlotsFor(
      [
        provider({ id: "a", label: "A", stale: true }),
        provider({ id: "b", label: "B", usageUnavailable: true }),
        provider({ id: "c", label: "C", resetSecs: undefined, session: 5 }),
        provider({
          id: "d",
          label: "D",
          windows: [{ id: "session", label: "Session", usedPercent: 5, resetSecs: 900 }],
        }),
      ],
      undefined,
    );

    expect(rows.map((row) => row.id)).toEqual(["d"]);
  });

  it("gives the Manual tile only the pinned provider's row, as the fixed frame does", () => {
    const previews = displayPreviewsFor(usage, enabled);
    // The rotation frame carries both rows; the pinned frame only its own.
    expect(previews[1].frame?.providerSlots).toHaveLength(2);
    expect(pinnedPreview(previews[1]).frame?.providerSlots).toEqual([
      { id: "codex", label: "Codex", percent: 12, resetSecs: 10800 },
    ]);
    expect(pinnedPreview(previews[0]).frame?.providerSlots).toEqual([
      { id: "claude", label: "Claude", percent: 55, resetSecs: 3600 },
    ]);
  });

  it("gives a legacy provider without windows no row, even with root resetSecs", () => {
    // The host builds rows from Frame.UsageWindows only (providerResetSlots).
    const legacy = provider({ id: "cursor", label: "Cursor", resetSecs: 900 });
    expect(legacy.windows).toBeUndefined();
    expect(providerSlotsFor([legacy], undefined)).toEqual([]);
    expect(
      displayPreviewFor(legacy, new Date(), false, [legacy])?.frame?.providerSlots,
    ).toEqual([]);
  });

  it("states each reset as of the shown frame's reading time", () => {
    const rows = providerSlotsFor(
      [
        provider({ id: "a", label: "A", collectedAt: "2026-10-20T08:00:00Z", windows: [{ id: "session", label: "Session", usedPercent: 10, resetSecs: 3600 }] }),
        provider({ id: "b", label: "B", collectedAt: "2026-10-20T08:10:00Z", windows: [{ id: "session", label: "Session", usedPercent: 10, resetSecs: 3600 }] }),
      ],
      "2026-10-20T08:10:00Z",
    );

    expect(rows.map((row) => row.resetSecs)).toEqual([3000, 3600]);
  });

  it("takes the smallest remaining percentage in remaining mode, as the host does", () => {
    const rows = providerSlotsFor(
      [
        provider({
          usageMode: "remaining",
          windows: [
            { id: "session", label: "Session", usedPercent: 70, resetSecs: 100 },
            { id: "weekly", label: "Weekly", usedPercent: 40, resetSecs: 200 },
          ],
        }),
      ],
      undefined,
    );

    expect(rows[0]).toMatchObject({ percent: 40, resetSecs: 100 });
  });
});

describe("reset trust in the synthesized frames", () => {
  const stamped = "2026-10-20T08:00:00Z";
  const at = new Date(stamped);
  const idleWindows = [
    { id: "session", label: "Session", usedPercent: 0 },
    { id: "weekly", label: "Weekly", usedPercent: 0 },
  ];

  it("reads a fresh window with nothing used and no deadline as idle, not unavailable", () => {
    const frame = displayPreviewFor(
      provider({ collectedAt: stamped, resetSecs: undefined, session: 0, weekly: 0, windows: idleWindows }),
    )?.frame;

    expect(frame).toMatchObject({
      resetTrust: "live",
      resetTrustSecs: 5 * 3600,
      resetSource: "codex",
    });
    const data = buildFrameData(stamped, frame!, at);
    expect(data.usageWindows.map((window) => window.idle)).toEqual([true, true]);
    expect(
      renderTextPrimitive({ type: "text", text: "{reset}" }, data),
    ).toBe("No active session");
  });

  it("keeps a window that has a deadline live, counting down from the reading time", () => {
    const frame = displayPreviewFor(
      provider({
        collectedAt: stamped,
        windows: [{ id: "session", label: "Session", usedPercent: 10, resetSecs: 3600 }],
      }),
      at,
    )?.frame;

    expect(frame).toMatchObject({ resetTrust: "live", resetTrustSecs: 5 * 3600 });
    expect(buildFrameData(stamped, frame!, at).usageWindows[0]).toMatchObject({
      resetSecs: 3600,
      idle: false,
    });
  });

  it("marks the frame stale and clears countdowns without a reading time, as the host does", () => {
    const frame = displayPreviewFor(
      provider({
        windows: [{ id: "session", label: "Session", usedPercent: 0, resetSecs: 3600 }],
      }),
    )?.frame;

    expect(frame).toMatchObject({ resetTrust: "stale", resetTrustSecs: 0, resetSecs: 0 });
    expect(frame?.usageWindows?.[0].resetSecs).toBe(0);
  });

  it("marks the frame stale once its only deadline has run out since the reading, as ApplyResetTrust does", () => {
    const later = new Date("2026-10-20T08:01:00Z");
    const preview = displayPreviewFor(
      provider({
        collectedAt: stamped,
        windows: [{ id: "session", label: "Session", usedPercent: 0, resetSecs: 30 }],
      }),
      later,
    );

    expect(preview?.frame).toMatchObject({ resetTrust: "stale", resetTrustSecs: 0, resetSecs: 0 });
    const data = buildFrameData(stamped, preview!.frame!, later);
    expect(renderTextPrimitive({ type: "text", text: "{reset}" }, data)).toBe("Reset unavailable");
  });

  it("marks the frame stale once the reading is older than the 5 h trust horizon, even with a later deadline", () => {
    const later = new Date(new Date(stamped).getTime() + (5 * 3600 + 60) * 1000);
    const preview = displayPreviewFor(
      provider({
        collectedAt: stamped,
        windows: [{ id: "weekly", label: "Weekly", usedPercent: 10, resetSecs: 3 * 24 * 3600 }],
      }),
      later,
    );

    expect(preview?.frame).toMatchObject({ resetTrust: "stale", resetTrustSecs: 0, resetSecs: 0 });
    const data = buildFrameData(stamped, preview!.frame!, later);
    expect(renderTextPrimitive({ type: "text", text: "{reset}" }, data)).toBe("Reset unavailable");
  });

  it("takes the root resetSecs from the first window that has a deadline, as Frame.Normalize does", () => {
    const frame = displayPreviewFor(
      provider({
        collectedAt: stamped,
        resetSecs: undefined,
        windows: [
          { id: "session", label: "Session", usedPercent: 10 },
          { id: "weekly", label: "Weekly", usedPercent: 20, resetSecs: 7200 },
        ],
      }),
    )?.frame;

    expect(frame?.resetSecs).toBe(7200);
    const data = buildFrameData(stamped, frame!, at);
    expect(renderTextPrimitive({ type: "text", text: "{reset}" }, data)).not.toBe("Reset unavailable");
  });
});

describe("the activity verdict", () => {
  it("does not take activity from the usage service, which lacks the daemon's verdict", () => {
    const frame = displayPreviewFor(provider({ collectedAt: "2026-10-20T08:00:00Z", activity: "coding" }))?.frame;

    expect(frame?.activity).toBeUndefined();
  });

  it("puts the activity of the frame last sent to VibeTV on that provider's preview only", () => {
    const stamped = "2026-10-20T08:00:00Z";
    const previews = displayPreviewsFor(
      {
        generatedAt: stamped,
        providers: [
          provider({ id: "codex", label: "Codex", collectedAt: stamped }),
          provider({ id: "claude", label: "Claude", collectedAt: stamped }),
        ],
      } as UsageSnapshot,
      [
        { id: "codex", label: "Codex" },
        { id: "claude", label: "Claude" },
      ],
    );

    const shown = withSentActivity(previews, { frame: { provider: "codex", activity: "coding" } });

    expect(shown[0].frame?.activity).toBe("coding");
    expect(buildFrameData(stamped, shown[0].frame!, new Date(stamped)).activity).toBe("coding");
    expect(shown[1].frame?.activity).toBeUndefined();
    expect(buildFrameData(stamped, shown[1].frame!, new Date(stamped)).activity).toBe("idle");
    // Nothing sent yet: the previews are untouched.
    expect(withSentActivity(previews, null)).toBe(previews);
  });
});

describe("withResetTrust on a later clock reading", () => {
  const stamped = "2026-10-20T08:00:00Z";

  it("turns a live frame stale once its deadline has run out", () => {
    const frame = displayPreviewFor(
      provider({ collectedAt: stamped, windows: [{ id: "session", label: "Session", usedPercent: 0, resetSecs: 30 }] }),
      new Date(stamped),
    )!.frame!;
    expect(frame.resetTrust).toBe("live");

    const later = withResetTrust(frame, stamped, new Date("2026-10-20T08:01:00Z"));

    expect(later).toMatchObject({ resetTrust: "stale", resetSecs: 0 });
    expect(later.usageWindows?.[0].resetSecs).toBe(0);
  });

  it("keeps a stale frame stale instead of reading it as an idle account", () => {
    const stale = displayPreviewFor(
      provider({ collectedAt: stamped, windows: [{ id: "session", label: "Session", usedPercent: 0, resetSecs: 30 }] }),
      new Date("2026-10-20T08:01:00Z"),
    )!.frame!;

    expect(withResetTrust(stale, stamped, new Date("2026-10-20T08:02:00Z")).resetTrust).toBe("stale");
  });
});

describe("withActivityExpiry", () => {
  const sentAt = "2026-10-20T08:00:00Z";
  const at = (secs: number) => new Date(new Date(sentAt).getTime() + secs * 1000);

  it("lets a coding verdict run out after its TTL, as VibeTV does (#369)", () => {
    const [shown] = withSentActivity(
      [{ providerLabel: "Codex", frame: { provider: "codex" }, resetLabel: null, windows: [] }],
      { frame: { provider: "codex", activity: "coding", activityTtlSecs: 90 }, savedAt: sentAt },
    );
    expect(shown.activityAt).toBe(sentAt);
    expect(withActivityExpiry(shown.frame!, shown.activityAt, at(89)).activity).toBe("coding");
    expect(withActivityExpiry(shown.frame!, shown.activityAt, at(90)).activity).toBe("idle");
  });

  it("keeps a verdict without a TTL or without a receipt time", () => {
    expect(withActivityExpiry({ activity: "coding" }, sentAt, at(9999)).activity).toBe("coding");
    expect(
      withActivityExpiry({ activity: "coding", activityTtlSecs: 90 }, undefined, at(9999)).activity,
    ).toBe("coding");
  });
});

describe("pairDisplayPreview", () => {
  const preview = (providerLabel: string, resetLabel: string | null) => ({
    providerLabel,
    resetLabel,
    windows: [{ label: "Weekly", percent: 40 }],
  });

  it("counts down with the first of the two that has a reset time", () => {
    expect(
      pairDisplayPreview(preview("Claude", "Reset unknown"), preview("Codex", "Reset in 2h 0m"))?.resetLabel,
    ).toBe("Reset in 2h 0m");
    expect(
      pairDisplayPreview(preview("Claude", "Reset in 4d 4h"), preview("Codex", "Reset in 2h 0m"))?.resetLabel,
    ).toBe("Reset in 4d 4h");
    expect(
      pairDisplayPreview(preview("Claude", "Reset unknown"), preview("Codex", null))?.resetLabel,
    ).toBe("Reset unknown");
  });
});

// Build 7 integration: both the plain and live-theme tiles obey the same limits.
describe("hidden limits in live theme previews", () => {
  it("filters the frame and provider rows while preserving the no-blank fallback", () => {
    const reading = provider({
      id: "codex", label: "Codex", collectedAt: "2026-10-20T08:00:00Z",
      windows: [
        { id: "session", label: "Session", usedPercent: 80, resetSecs: 600 },
        { id: "weekly", label: "Weekly", usedPercent: 20, resetSecs: 3600 },
      ],
    });
    const usage = { providers: [reading] } as UsageSnapshot;
    const enabled = [{ id: "codex", label: "Codex" }];
    const [hidden] = displayPreviewsFor(usage, enabled, { codex: ["session"] });
    expect(hidden.windows).toEqual([{ label: "Weekly", percent: 20 }]);
    expect(hidden.frame?.usageWindows?.map((window) => window.id)).toEqual(["weekly"]);
    expect(hidden.frame?.providerSlots).toEqual([
      { id: "codex", label: "Codex", percent: 20, resetSecs: 3600 },
    ]);
    const [allHidden] = displayPreviewsFor(usage, enabled, { codex: ["session", "weekly"] });
    expect(allHidden.frame?.usageWindows?.map((window) => window.id)).toEqual(["session", "weekly"]);
  });
});
