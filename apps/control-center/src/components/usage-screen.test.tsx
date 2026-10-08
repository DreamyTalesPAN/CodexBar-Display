import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import type { UsageSnapshot, UsageWindowInfo } from "./control-center-types";
import {
  UsageScreen,
  usagePaceLine,
  usageTokenHistoryUnavailable,
  usageTokenHistoryUnavailableOnVibeTV,
} from "./usage-screen";

const usage: UsageSnapshot = {
  ok: true,
  tokenUsageReady: true,
  currentProvider: "codex",
  providers: [
    {
      id: "codex",
      label: "Codex",
      source: "oauth",
      session: 12,
      weekly: 34,
      usageMode: "used",
      cost: {
        daily: [
          {
            day: "2026-07-22",
            totalTokens: 1234,
          },
        ],
      },
    },
  ],
};

function renderUsage(
  busyAction: string | null = null,
  snapshot: UsageSnapshot = usage,
) {
  return renderToStaticMarkup(
    <UsageScreen
      busyAction={busyAction}
      companionStatus="online"
      onRefresh={vi.fn()}
      usage={snapshot}
    />,
  );
}

describe("UsageScreen", () => {
  it("does not present a partial provider sum as complete token history", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [...usage.providers, { id: "claude", label: "Claude", session: 0, weekly: 10, usageMode: "used" }],
    });
    expect(html).toContain("Token history is unavailable");
    expect(html).toContain("not available for every selected provider");
    expect(html).not.toContain("Total tokens in the last 30 days");
    expect(html).toContain("Weekly: 34% used");
    expect(html).toContain("Weekly: 10% used");
  });

  it("says when the Usage notice stands", () => {
    expect(usageTokenHistoryUnavailable(usage)).toBe(false);
    expect(usageTokenHistoryUnavailable(null)).toBe(false);
    expect(
      usageTokenHistoryUnavailable({
        ...usage,
        tokenUsageReady: true,
        providers: usage.providers.map((provider) => ({ ...provider, cost: undefined })),
      }),
    ).toBe(true);
  });

  // VibeTV draws the token numbers of one provider. The hint on Themes says
  // "Shows --" only when that provider has none, whatever the others have.
  it("answers for Themes by the provider on VibeTV", () => {
    const cursor = { id: "cursor", label: "Cursor", session: 0, weekly: 10, usageMode: "used" as const };
    const mixed = { ...usage, providers: [...usage.providers, cursor] };
    expect(usageTokenHistoryUnavailable(mixed)).toBe(true);
    expect(usageTokenHistoryUnavailableOnVibeTV(mixed)).toBe(false);
    expect(usageTokenHistoryUnavailableOnVibeTV({ ...mixed, currentProvider: "cursor" })).toBe(true);
    // No provider on VibeTV: only when none of the shown ones has a history.
    expect(usageTokenHistoryUnavailableOnVibeTV({ ...mixed, currentProvider: undefined })).toBe(false);
    expect(
      usageTokenHistoryUnavailableOnVibeTV({ ...usage, currentProvider: undefined, providers: [cursor] }),
    ).toBe(true);
    expect(usageTokenHistoryUnavailableOnVibeTV(null)).toBe(false);
    // Token history not read yet: no claim.
    expect(
      usageTokenHistoryUnavailableOnVibeTV({ ...usage, tokenUsageReady: false, providers: [cursor] }),
    ).toBe(false);
  });

  // Issue #558: with one provider on, "not available for every selected
  // provider" read like an error about providers the customer does not have.
  it("names the one provider that has no token history", () => {
    const one = (windowsHost: boolean) =>
      renderToStaticMarkup(
        <UsageScreen
          busyAction={null}
          companionStatus="online"
          usage={{ ...usage, providers: usage.providers.map((provider) => ({ ...provider, cost: undefined })) }}
          windowsHost={windowsHost}
        />,
      );

    expect(one(false)).toContain(
      "No token history was found for Codex on this Mac. Your usage limits are shown below.",
    );
    expect(one(false)).not.toContain("every selected provider");
    expect(one(true)).toContain("No token history was found for Codex on this computer.");
  });

  it("shows unavailable rather than zero or a spinner after a scan without history", () => {
    const html = renderUsage(null, {
      ...usage,
      tokenUsageReady: true,
      providers: usage.providers.map((provider) => ({ ...provider, cost: undefined })),
    });
    expect(html).toContain("Token history is unavailable");
    expect(html).toContain('aria-label="Refresh token usage"');
    expect(html).toContain("Weekly: 34% used");
    expect(html).not.toContain("Token history is loading");
    expect(html).not.toContain("zero tokens");
    expect(html).not.toContain("Total tokens in the last 30 days");
  });

  it("shows a simple loading state while the first usage snapshot is pending", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={null}
      />,
    );

    expect(html).toContain("Loading usage");
    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("CodexBar");
    expect(html).not.toContain("No provider usage is available yet.");
  });

  it("offers a generic retry for a real usage error", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={null}
        usageError={{
          code: "COMPANION_TIMEOUT",
          message: "Usage needs attention.",
          nextAction: "Check the Mac App, then try again.",
        }}
      />,
    );

    expect(html).toContain("Usage needs attention.");
    expect(html).toContain("Try again</button>");
    expect(html).not.toContain("Loading usage");
    expect(html).not.toContain("CodexBar");
  });

  it("keeps provider windows visible while token usage is pending", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          tokenUsageReady: false,
          providers: usage.providers.map((provider) => ({
            ...provider,
            cost: undefined,
            totalTokens: 9000,
          })),
        }}
      />,
    );

    expect(html).toContain("Token history is loading");
    expect(html).toContain('data-testid="token-history-loading"');
    expect(html).toContain('data-slot="card"');
    expect(html).toContain("min-h-[294px]");
    expect(html).toContain("items-center justify-center");
    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain("Codex");
    expect(html).toContain("Session: 12% used");
    expect(html).toContain("Weekly: 34% used");
    expect(html).not.toContain("AI providers");
    expect(html).not.toContain('aria-label="Disable Codex"');
    expect(html).not.toContain("Loading usage");
    expect(html).not.toContain("Total tokens in the last 30 days");
    expect(html).not.toContain("Tokens used over time");
  });

  it("shows a growing token total immediately and marks it as still counting", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          tokenUsageUpdating: true,
        }}
      />,
    );

    expect(html).toContain("Total tokens in the last 30 days");
    expect(html).toContain('data-testid="token-history-updating"');
    expect(html).toContain("Still counting");
    expect(html.indexOf('data-testid="token-history-updating"')).toBeLessThan(
      html.indexOf("Total tokens in the last 30 days"),
    );
    expect(html).not.toContain('data-testid="token-history-loading"');
  });

  it("drops the still counting badge once the token history settled", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          tokenUsageUpdating: false,
        }}
      />,
    );

    expect(html).toContain("Total tokens in the last 30 days");
    expect(html).not.toContain('data-testid="token-history-updating"');
    expect(html).not.toContain("Still counting");
  });

  it("renders a successful zero token result instead of staying in loading", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          tokenUsageReady: true,
          providers: usage.providers.map((provider) => ({
            ...provider,
            session: 0,
            weekly: 0,
            cost: {
              daily: [],
            },
          })),
        }}
      />,
    );

    expect(html).toContain("zero tokens");
    expect(html).toContain("No data");
    expect(html).not.toContain("Loading usage");
  });

  it("points an empty usage result to provider settings", () => {
    const html = renderUsage(null, { ...usage, providers: [] });

    expect(html).toContain("No provider usage is available yet.");
    expect(html).toContain("Manage providers in Settings, then refresh usage.");
    expect(html).not.toContain("Enable a provider below");
  });

  it("shows a dedicated token usage refresh action", () => {
    const html = renderUsage();

    expect(html).toContain('aria-label="Refresh token usage"');
    expect(html).toContain("Refresh</button>");
    expect(html).not.toContain('aria-label="Refresh token usage" aria-busy="true"');
  });

  it("disables the token usage refresh action while usage reloads", () => {
    const html = renderUsage("usage");

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain("Refreshing</button>");
  });

  it("shows a small Refreshing mark by the token total while a manual refresh waits, and no notice", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          refresh: {
            state: "refreshing",
          },
        }}
      />,
    );

    expect(html).toContain('data-testid="usage-refresh-pending"');
    expect(html).not.toContain("Refreshing usage");
    expect(html).not.toContain("Current values stay visible");
    expect(html).toContain("Codex");
    // No mark without a pending refresh.
    expect(
      renderToStaticMarkup(
        <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
      ),
    ).not.toContain('data-testid="usage-refresh-pending"');
  });

  it("does not show the global loading banner when unavailable refresh has token history", () => {
    const html = renderUsage(null, {
      ...usage,
      refresh: {
        state: "unavailable",
      },
    });

    expect(html).toContain("Total tokens in the last 30 days");
    expect(html).toContain("Tokens used over time");
    expect(html).toContain("Codex");
    expect(html).not.toContain("Usage is still loading");
  });

  it("does not show the global loading banner for stale provider tokens", () => {
    const html = renderUsage(null, {
      ...usage,
      refresh: {
        state: "unavailable",
      },
      providers: usage.providers.map((provider) => ({
        ...provider,
        session: 0,
        weekly: 0,
        stale: true,
        usageUnavailable: true,
        sessionUnavailable: true,
        weeklyUnavailable: true,
        sessionTokens: 1200,
        weekTokens: 3400,
        totalTokens: 5600,
      })),
    });

    expect(html).toContain("Usage limits are stale.");
    expect(html).toContain("Session: ??");
    expect(html).toContain("Token usage");
    expect(html).not.toContain("Usage is still loading");
  });

  it("keeps the global loading banner for an empty unavailable usage snapshot", () => {
    const html = renderUsage(null, {
      ok: true,
      refresh: {
        state: "unavailable",
      },
      tokenUsageReady: false,
      providers: [],
    });

    expect(html).toContain("Usage is still loading");
    expect(html).toContain("No provider usage is available yet.");
    expect(html).not.toContain("Total tokens in the last 30 days");
  });

  it("clears the global loading banner when usable data arrives later", () => {
    const pending = renderUsage(null, {
      ok: true,
      refresh: {
        state: "unavailable",
      },
      tokenUsageReady: false,
      providers: [],
    });
    const recovered = renderUsage(null, {
      ...usage,
      refresh: {
        state: "unavailable",
      },
    });

    expect(pending).toContain("Usage is still loading");
    expect(recovered).toContain("Total tokens in the last 30 days");
    expect(recovered).toContain("Codex");
    expect(recovered).not.toContain("Usage is still loading");
  });

  it("renders unavailable percentages as unknown without reset claims", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 0,
          weekly: 0,
          resetSecs: 3600,
          usageUnavailable: true,
        },
      ],
    });

    expect(html).toContain("Session: ??");
    expect(html).toContain("Weekly: ??");
    expect(html).toContain("Usage limits unavailable.");
    expect(html).not.toContain("Session: 0%");
    expect(html).not.toContain("Weekly: 0%");
    expect(html).not.toContain("Reset in");
  });

  it("keeps token history visible when quota limits are stale", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          providers: [
            {
              ...usage.providers[0],
              stale: true,
              usageUnavailable: true,
              sessionUnavailable: true,
              weeklyUnavailable: true,
              sessionTokens: 12,
              weekTokens: 34,
              totalTokens: 56,
              cost: {
                daily: [
                  {
                    day: "2026-07-29",
                    totalTokens: 56,
                  },
                ],
                last30DaysTokens: 56,
                latestTokens: 12,
              },
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Total tokens in the last 30 days");
    expect(html).toContain("Token usage");
    expect(html).toContain("Session: ??");
    expect(html).toContain("Weekly: ??");
    expect(html).toContain("Usage limits are stale.");
    expect(html).not.toContain("Provider is not responding right now.");
    expect(html).not.toContain(">Unavailable<");
  });

  it("renders only normalized windows reported by CodexBar", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 0,
          weekly: 57,
          sessionUnavailable: true,
          windows: [
            {
              id: "secondary",
              label: "7-day quota",
              usedPercent: 57,
            },
            {
              id: "codex-spark-weekly",
              label: "Codex Spark Weekly",
              usedPercent: 12,
            },
          ],
        },
      ],
    });

    expect(html).toContain("7-day quota: 57% used");
    expect(html).toContain("Codex Spark Weekly: 12% used");
    expect(html.indexOf("7-day quota: 57% used")).toBeLessThan(
      html.indexOf("Codex Spark Weekly: 12% used"),
    );
    expect(html).not.toContain("Session:");
    expect(html).not.toContain("Session: 0%");
  });

  it("does not invent normalized lanes for legacy custom windows", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          sessionUnavailable: true,
          weeklyUnavailable: true,
          windows: [
            {
              id: "custom",
              label: "Custom quota",
              usedPercent: 23,
            },
          ],
        },
      ],
    });

    expect(html).toContain("Custom quota: 23% used");
    expect(html).not.toContain("Session:");
    expect(html).not.toContain("Weekly:");
  });

  it("uses per-lane availability without normalized windows", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 0,
          weekly: 57,
          sessionUnavailable: true,
        },
      ],
    });

    expect(html).toContain("Session: ??");
    expect(html).toContain("Weekly: 57% used");
    expect(html).not.toContain("Weekly: ??");
    expect(html).not.toContain("Session: 0%");
    // A screen reader hears the same: a percentage only for the lane that has one.
    expect(html.match(/aria-valuenow="\d+"/g)).toEqual(['aria-valuenow="57"']);
  });

  it("has no accessibility violations with usage, unavailable limits, no provider and while refreshing", async () => {
    await expectNoAxeViolations(renderUsage());
    await expectNoAxeViolations(renderUsage("usage", { ...usage, tokenUsageReady: false }));
    await expectNoAxeViolations(
      renderUsage(null, {
        ...usage,
        providers: [{ ...usage.providers[0], sessionUnavailable: true, stale: true }],
      }),
    );
    await expectNoAxeViolations(renderUsage(null, { ...usage, providers: [] }));
  });

  // Issue #210, first slice: under a window's bar the page says what the usage
  // engine says about its pace, and nothing when the engine said nothing.
  describe("pace of a usage window", () => {
    const session: UsageWindowInfo = {
      id: "session",
      label: "Session",
      usedPercent: 8,
      resetSecs: 9000,
      pace: { state: "reserve", lasts: true },
    };
    const weekly: UsageWindowInfo = {
      id: "weekly",
      label: "Weekly",
      usedPercent: 73,
      resetSecs: 400000,
      pace: { state: "deficit", lasts: false, etaSeconds: 115200 },
    };
    const withWindows = (
      windows: UsageWindowInfo[],
      provider: Partial<UsageSnapshot["providers"][number]> = {},
    ) =>
      renderUsage(null, {
        ...usage,
        providers: [{ ...usage.providers[0], windows, ...provider }],
      });
    const paceWords = /On pace|expected pace|At this pace|runs out|lasts until/;

    it("has one sentence for each thing the engine can say", () => {
      expect(usagePaceLine({ state: "on pace", lasts: true }, 0)).toBe("On pace to last until the reset.");
      expect(usagePaceLine({ state: "reserve", lasts: true }, 0)).toBe(
        "Below the expected pace: lasts until the reset.",
      );
      expect(usagePaceLine({ state: "deficit", lasts: true }, 0)).toBe(
        "Above the expected pace, but it lasts until the reset.",
      );
      // The engine projected neither outcome: the page promises none.
      expect(usagePaceLine({ state: "on pace" }, 0)).toBe("On pace.");
      expect(usagePaceLine({ state: "reserve" }, 0)).toBe("Below the expected pace.");
      expect(usagePaceLine({ state: "deficit" }, 0)).toBe("Above the expected pace.");
      // The engine's ETA wins over the stage, in the countdown's own format.
      for (const state of ["deficit", "on pace", "reserve"]) {
        expect(usagePaceLine({ state, lasts: false }, 115200)).toBe(
          "At this pace it runs out in 1d 8h, before the reset.",
        );
      }
      expect(usagePaceLine({ state: "deficit", lasts: false }, 9000)).toBe(
        "At this pace it runs out in 2h 30m, before the reset.",
      );
      // "Runs out now", or an ETA that has passed since the reading: no "0m".
      expect(usagePaceLine({ state: "deficit", lasts: false }, 0)).toBe(
        "At this pace it runs out before the reset.",
      );
      // A state this app does not know says nothing.
      expect(usagePaceLine({ state: "sideways", lasts: true }, 0)).toBe("");
    });

    it("shows the sentence of each window under that window's bar", () => {
      const html = withWindows([session, weekly]);
      expect(html).toContain("Below the expected pace: lasts until the reset.");
      expect(html).toContain("At this pace it runs out in 1d 8h, before the reset.");
      expect(html.indexOf("Session: 8% used")).toBeLessThan(html.indexOf("Below the expected pace"));
      expect(html.indexOf("Below the expected pace")).toBeLessThan(html.indexOf("Weekly: 73% used"));
      expect(html.indexOf("Weekly: 73% used")).toBeLessThan(html.indexOf("At this pace it runs out"));
      // Our words, not the engine's summary.
      expect(html).not.toMatch(/in reserve|in deficit|Expected \d+%/);
    });

    it("shows nothing for a window without a pace", () => {
      const html = withWindows([{ ...session, pace: undefined }, weekly]);
      expect(html).toContain("Session: 8% used");
      expect(html.match(paceWords)).toHaveLength(1);
      expect(withWindows([{ ...session, pace: undefined }])).not.toMatch(paceWords);
      // The two-bar fallback without a window list has no pace either.
      expect(renderUsage()).not.toMatch(paceWords);
    });

    it("shows no pace on a stale card", () => {
      const html = withWindows([session, weekly], { stale: true, usageUnavailable: true });
      expect(html).toContain("Session: ??");
      expect(html).not.toMatch(paceWords);
    });

    it("shows no pace for a window whose reset has passed or is unknown", () => {
      expect(withWindows([{ ...session, resetSecs: 0 }])).not.toMatch(paceWords);
      expect(withWindows([{ ...session, resetSecs: undefined }])).not.toMatch(paceWords);
      expect(
        withWindows([session], { collectedAt: new Date(Date.now() - 10000 * 1000).toISOString() }),
      ).not.toMatch(paceWords);
    });

    it("counts the engine's ETA down from the reading, like the reset", () => {
      const html = withWindows([weekly], {
        collectedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      });
      expect(html).toContain("At this pace it runs out in 1d 7h, before the reset.");
    });

    it("says the same under Remaining, where the percentage is turned round", () => {
      const html = withWindows(
        [
          { ...session, usedPercent: 92 },
          { ...weekly, usedPercent: 27 },
        ],
        { usageMode: "remaining" },
      );
      expect(html).toContain("Session: 92% remaining");
      expect(html).toContain("Below the expected pace: lasts until the reset.");
      expect(html).toContain("Weekly: 27% remaining");
      expect(html).toContain("At this pace it runs out in 1d 8h, before the reset.");
    });

    it("has no accessibility violations with a pace line", async () => {
      await expectNoAxeViolations(withWindows([session, weekly]));
    });
  });
});
