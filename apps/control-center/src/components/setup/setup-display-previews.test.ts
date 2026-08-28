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
    expect(displayPreviewFor(provider({}))).toEqual({
      providerLabel: "Codex",
      resetLabel: "Reset in 3h 0m",
      sessionPercent: 42,
      weeklyPercent: 26,
    });
  });

  it("leaves a window the collector could not read unavailable", () => {
    const preview = displayPreviewFor(
      provider({ weeklyUnavailable: true }),
    );

    expect(preview?.sessionPercent).toBe(42);
    expect(preview?.weeklyPercent).toBeNull();
  });

  it("shows nothing measured when the provider itself has no usage", () => {
    const preview = displayPreviewFor(provider({ usageUnavailable: true }));

    expect(preview?.sessionPercent).toBeNull();
    expect(preview?.weeklyPercent).toBeNull();
    expect(preview?.resetLabel).toBeNull();
  });

  it("never turns a missing reading into a zero", () => {
    const preview = displayPreviewFor(
      provider({ session: 0, sessionUnavailable: true }),
    );

    expect(preview?.sessionPercent).not.toBe(0);
    expect(preview?.sessionPercent).toBeNull();
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

  it("rotates only through the providers that are switched on", () => {
    const previews = displayPreviewsFor(usage, ["codex", "claude"]);

    expect(previews.map((p) => p.providerLabel)).toEqual(["Codex", "Claude"]);
  });

  it("keeps the order the usage service reported", () => {
    const previews = displayPreviewsFor(usage, ["claude", "codex", "cursor"]);

    expect(previews.map((p) => p.providerLabel)).toEqual([
      "Codex",
      "Cursor",
      "Claude",
    ]);
  });

  it("has an empty rotation when nothing is switched on", () => {
    expect(displayPreviewsFor(usage, [])).toEqual([]);
    expect(displayPreviewsFor(null, ["codex"])).toEqual([]);
  });
});
