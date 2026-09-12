import { describe, expect, it } from "vitest";
import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import {
  previewUsageMode,
  displayPreviewFor,
  displayPreviewsFor,
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

describe("usage presentation", () => {
  it("converts the real windows in both directions without changing quota or missing data", () => {
    const frame = displayPreviewFor(provider({ sessionUnavailable: true,
      windows: [{ id: "spark", label: "Codex Spark 5-hour", usedPercent: 90, resetSecs: 120 }],
      totalTokens: 1234,
    }))!.frame!;
    const remaining = previewUsageMode(frame, "remaining");
    expect(remaining.usageSlot1Percent).toBe(10);
    expect(remaining.usageWindows[0]).toMatchObject({ label: "Codex Spark 5-hour", percent: 10, resetSecs: 120 });
    expect(remaining.sessionUnavailable).toBe(true);
    expect(remaining.totalTokens).toBe(1234);
    expect(previewUsageMode(remaining, "used")).toEqual(frame);
    expect(frame.usageWindows[0].percent).toBe(90);
  });
  it("preserves unavailable windows in either mode", () => {
    const frame = displayPreviewFor(provider({ usageUnavailable: true,
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 90 }],
    }))!.frame!;
    const remaining = previewUsageMode(frame, "remaining");
    expect(remaining.usageWindows).toEqual([]);
    expect(remaining.usageSlot1Available).toBe(false);
    expect(remaining.weeklyUnavailable).toBe(true);
  });
});
