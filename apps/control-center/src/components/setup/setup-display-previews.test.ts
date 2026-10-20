import { describe, expect, it } from "vitest";
import type { UsageProviderInfo, UsageSnapshot } from "../control-center-types";
import {
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
