import { describe, expect, it } from "vitest";
import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { buildFrameData, renderTextPrimitive } from "../live-vibetv-preview";
import {
  displayPreviewFor,
  displayPreviewsFor,
  providerSlotsFor,
} from "./setup-display-previews";

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

  it("reads the plain session and weekly figures when there are no windows", () => {
    expect(displayPreviewFor(provider({}))?.frame?.usageWindows).toMatchObject([
      { id: "session", percent: 42 },
      { id: "weekly", percent: 26 },
    ]);
  });

  it("leaves a window the collector could not read out of the frame", () => {
    const windows = displayPreviewFor(provider({ weeklyUnavailable: true }))
      ?.frame?.usageWindows;

    expect(windows).toHaveLength(1);
    expect(windows?.[0].id).toBe("session");
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
