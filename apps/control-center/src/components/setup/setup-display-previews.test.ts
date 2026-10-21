import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import { buildFrameData, type DisplayFrame } from "../live-vibetv-preview";
import {
  displayPreviewFor,
  displayPreviewsFor,
  pinnedPreview,
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
describe("the frames come from the companion", () => {
  const stamped = "2026-10-20T08:00:00Z";
  const usage = {
    providers: [
      provider({ id: "codex", label: "Codex", collectedAt: stamped }),
      provider({ id: "claude", label: "Claude", collectedAt: stamped }),
    ],
  } as UsageSnapshot;
  const enabled = [
    { id: "codex", label: "Codex" },
    { id: "claude", label: "Claude" },
  ];
  const automatic: DisplayFrame = {
    v: 2,
    provider: "codex",
    label: "Codex",
    resetSecs: 3600,
    resetTrust: "live",
    providerSlots: [
      { id: "codex", label: "Codex", percent: 42, resetSecs: 3600 },
      { id: "claude", label: "Claude", percent: 7, resetSecs: 7200 },
    ],
  };
  const pinned: DisplayFrame = { ...automatic, providerSlots: [automatic.providerSlots![0]] };
  const frames = {
    generatedAt: stamped,
    providers: [{ id: "codex", automatic, pinned }, { id: "claude" }],
  };

  it("hands each tile the frame the companion built, unchanged", () => {
    const previews = displayPreviewsFor(usage, enabled, frames);

    expect(previews[0].frame).toBe(automatic);
    expect(previews[0].frameAt).toBe(stamped);
    expect(pinnedPreview(previews[0]).frame).toBe(pinned);
  });

  it("keeps a provider the companion built no frame for a placeholder", () => {
    const previews = displayPreviewsFor(usage, enabled, frames);

    expect(previews[1].frame).toBeUndefined();
    expect(pinnedPreview(previews[1]).frame).toBeUndefined();
  });

  it("draws no frame before the companion has answered", () => {
    expect(displayPreviewsFor(usage, enabled)[0].frame).toBeUndefined();
  });

  it("puts the activity of the frame last sent to VibeTV on that provider's preview only", () => {
    const previews = displayPreviewsFor(usage, enabled, {
      ...frames,
      providers: [
        { id: "codex", automatic, pinned },
        { id: "claude", automatic: { ...automatic, provider: "claude" } },
      ],
    });

    const shown = withSentActivity(previews, { frame: { provider: "codex", activity: "coding" } });

    expect(shown[0].frame?.activity).toBe("coding");
    expect(pinnedPreview(shown[0]).frame?.activity).toBe("coding");
    expect(buildFrameData(stamped, shown[0].frame!, new Date(stamped)).activity).toBe("coding");
    expect(shown[1].frame?.activity).toBeUndefined();
    expect(buildFrameData(stamped, shown[1].frame!, new Date(stamped)).activity).toBe("idle");
    // Nothing sent yet: the previews are untouched.
    expect(withSentActivity(previews, null)).toBe(previews);
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
