import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UsageSnapshot, UsageWindowInfo } from "./control-center-types";
import {
  UsageScreen,
  usagePaceHint,
  usagePaceWord,
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
    expect(html).not.toContain("Total tokens in the last 30 days");
    expect(html).toContain("Weekly: 34% used");
    expect(html).toContain("Weekly: 10% used");
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

  it("explains that a manual refresh is still waiting for a new snapshot", () => {
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

    expect(html).toContain("Refreshing usage");
    expect(html).toContain("Current values stay visible");
    expect(html).toContain("Codex");
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
  });

  // Issue #210, first slice: under a window's bar the page says in one word
  // pair whether the usage engine sees it under, on or over pace, with a mark
  // on the bar where on pace would be, and nothing when the engine said nothing.
  describe("pace of a usage window", () => {
    const session: UsageWindowInfo = {
      id: "session",
      label: "Session",
      usedPercent: 8,
      resetSecs: 9000,
      pace: { state: "reserve", lasts: true, expectedPercent: 33 },
    };
    const weekly: UsageWindowInfo = {
      id: "weekly",
      label: "Weekly",
      usedPercent: 73,
      resetSecs: 400000,
      pace: { state: "deficit", lasts: false, etaSeconds: 115200, expectedPercent: 43 },
    };
    const withWindows = (
      windows: UsageWindowInfo[],
      provider: Partial<UsageSnapshot["providers"][number]> = {},
    ) =>
      renderUsage(null, {
        ...usage,
        providers: [{ ...usage.providers[0], windows, ...provider }],
      });
    const paceWords = /(Under|On|Over) pace|At this pace|usage-pace-mark/;
    const marks = (html: string) => [...html.matchAll(/usage-pace-mark" style="left:(\d+)%"/g)].map((m) => m[1]);

    it("has one word pair for each state and one hint for each projection", () => {
      expect(usagePaceWord({ state: "reserve" })).toBe("Under pace");
      expect(usagePaceWord({ state: "on pace" })).toBe("On pace");
      expect(usagePaceWord({ state: "deficit" })).toBe("Over pace");
      // A state this app does not know says nothing.
      expect(usagePaceWord({ state: "sideways", lasts: true })).toBe("");
      expect(usagePaceHint({ state: "reserve", lasts: true }, 0)).toBe(
        "At this pace your limit lasts until the reset.",
      );
      // The engine's ETA, in the countdown's own format.
      expect(usagePaceHint({ state: "deficit", lasts: false }, 115200)).toBe(
        "At this pace your limit runs out in 1d 8h, before the reset.",
      );
      // "Runs out now", or an ETA that has passed since the reading: no "0m".
      expect(usagePaceHint({ state: "deficit", lasts: false }, 0)).toBe(
        "At this pace your limit runs out before the reset.",
      );
      // The engine projected neither outcome: the page promises none.
      expect(usagePaceHint({ state: "on pace" }, 0)).toBe("");
    });

    it("shows word, mark and hint of each window at that window's bar", () => {
      const html = withWindows([session, weekly]);
      expect(marks(html)).toEqual(["33", "43"]);
      expect(html).toContain("At this pace your limit lasts until the reset.");
      expect(html).toContain("At this pace your limit runs out in 1d 8h, before the reset.");
      expect(html.indexOf("Session: 8% used")).toBeLessThan(html.indexOf("Under pace"));
      expect(html.indexOf("Under pace")).toBeLessThan(html.indexOf("Weekly: 73% used"));
      expect(html.indexOf("Weekly: 73% used")).toBeLessThan(html.indexOf("Over pace"));
      // Our words, not the engine's summary.
      expect(html).not.toMatch(/in reserve|in deficit|Expected \d+%/);
    });

    it("shows the word without a hint when the engine projected nothing, and no mark without a position", () => {
      const html = withWindows([{ ...session, pace: { state: "on pace" } }]);
      expect(html).toContain("On pace");
      expect(html).not.toMatch(/At this pace|usage-pace-mark/);
    });

    it("shows nothing for a window without a pace", () => {
      const html = withWindows([{ ...session, pace: undefined }, weekly]);
      expect(html).toContain("Session: 8% used");
      expect(html).not.toContain("Under pace");
      expect(marks(html)).toEqual(["43"]);
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
    });

    it("says the same under Remaining, where percentage and mark are turned round", () => {
      const html = withWindows(
        [
          { ...session, usedPercent: 92, pace: { ...session.pace!, expectedPercent: 67 } },
          { ...weekly, usedPercent: 27, pace: { ...weekly.pace!, expectedPercent: 57 } },
        ],
        { usageMode: "remaining" },
      );
      expect(html).toContain("Session: 92% remaining");
      expect(html).toContain("Under pace");
      expect(html).toContain("Weekly: 27% remaining");
      expect(html).toContain("Over pace");
      expect(marks(html)).toEqual(["67", "57"]);
    });
  });
});
