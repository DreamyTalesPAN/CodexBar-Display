// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import type { PreferenceDescriptor, UsageSnapshot } from "./control-center-types";
import {
  UsageScreen,
  usageProviderActionsFor,
  usageTokenHistoryUnavailable,
  usageTokenHistoryUnavailableOnVibeTV,
  buildProviderTokenChart,
  weeklyDayTicks,
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

function refreshButtonTag(html: string): string {
  return html.match(/<button[^>]*aria-label="Refresh"[^>]*>/)?.[0] ?? "";
}

describe("UsageScreen", () => {
  afterEach(cleanup);

  it("does not present a partial provider sum as complete token history", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [...usage.providers, { id: "claude", label: "Claude", session: 0, weekly: 10, usageMode: "used" }],
    });
    // The notice is a dialog over the page (usage-screen.warning-overlay.test.tsx).
    expect(html).not.toContain("Last 30 days");
    expect(html).toContain('aria-label="34% weekly used"');
    expect(html).toContain('aria-label="10% weekly used"');
  });

  // 7197 review, point 3: the cards are 428 px wide, at most three in a row, left-aligned; the page is not centred.
  it("lays the provider cards out as a grid of 428 px columns, not stretched", () => {
    const html = renderUsage();
    // 428 px at most; a window narrower than one card lets the card shrink (Codex on #783).
    expect(html).toContain("repeat(auto-fill, minmax(min(100%, 428px), 428px))");
    expect(html).toContain("max-w-[1316px] justify-start");
    expect(html).not.toContain("max-w-[1180px]");
    expect(html).not.toContain("2xl:grid-cols-3");
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

  // The notice's sentences (issue #558: one provider names it, "every selected
  // provider" only with several) are checked in usage-screen.warning-overlay.test.tsx.
  it("shows unavailable rather than zero or a spinner after a scan without history", () => {
    const html = renderUsage(null, {
      ...usage,
      tokenUsageReady: true,
      providers: usage.providers.map((provider) => ({ ...provider, cost: undefined })),
    });
    expect(html).toContain('aria-label="34% weekly used"');
    expect(html).not.toContain("Token history is loading");
    expect(html).not.toContain("zero tokens");
    expect(html).not.toContain("Last 30 days");
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

  it("does not show a real usage error as a box on the page", () => {
    // The error is a dialog over the page (usage-screen.error-overlay.test.tsx).
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

    expect(html).not.toContain("Usage needs attention.");
    expect(html).not.toContain("Try again</button>");
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
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("min-h-[294px]");
    expect(html).not.toContain('data-slot="spinner"');
    expect(html).toContain("Codex");
    expect(html).toContain('aria-label="12% session used"');
    expect(html).toContain('aria-label="34% weekly used"');
    expect(html).not.toContain("AI providers");
    expect(html).not.toContain('aria-label="Disable Codex"');
    expect(html).not.toContain("Loading usage");
    expect(html).not.toContain("Last 30 days");
    expect(html).not.toContain("Tokens used over time");
  });

  it("draws the finished head and chart as grey blocks while token history loads, without a spinner", async () => {
    const loadingSnapshot: UsageSnapshot = {
      ...usage,
      tokenUsageReady: false,
      providers: usage.providers.map((provider) => ({ ...provider, cost: undefined })),
    };
    const html = renderUsage(null, loadingSnapshot);

    // The loading block sits above the provider list (<ol>).
    const loading = html.slice(
      html.lastIndexOf("<div", html.indexOf('data-testid="token-history-loading"')),
      html.indexOf("<ol"),
    );
    expect(loading).toContain("Token history is loading");
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    // Head label, number, words line, chart and one legend chip (below the chart) for the one provider.
    expect(loading.match(/data-slot="skeleton"/g)).toHaveLength(5);
    expect(loading).not.toContain('data-slot="spinner"');
    // Same chart wrapper and legend row as the finished panel, so the tiles below do not move.
    expect(loading).toContain("relative mt-12 min-h-56");
    expect(renderUsage()).toContain("relative mt-12 min-h-56");
    expect(loading.indexOf("relative mt-12 min-h-56")).toBeLessThan(loading.lastIndexOf("gap-x-[18px]"));
    // Template spacing (7197 review, point 2): 48 px from the number to the chart, 56 px from the legend to the cards.
    expect(loading).toContain("mt-1.5 mb-14");
    expect(renderUsage()).toContain("mb-14");
    // The skeleton shows no figures and no finished headings.
    expect(loading).not.toContain("Last 30 days");
    expect(loading).not.toContain("Tokens used over time");
    expect(loading).not.toContain("1,234");
    await expectNoAxeViolations(html);
  });

  it("draws every loading block with the shared skeleton shimmer", () => {
    const html = renderUsage(null, {
      ...usage,
      tokenUsageReady: false,
      providers: usage.providers.map((provider) => ({ ...provider, cost: undefined })),
    });

    const blocks = html.match(/<div[^>]*data-slot="skeleton"[^>]*>/g) ?? [];
    expect(blocks).toHaveLength(5);
    for (const block of blocks) {
      expect(block).toContain("vibetv-skeleton");
      expect(block).not.toContain("animate-pulse");
    }
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

    expect(html).toContain("Last 30 days");
    expect(html).toContain('data-testid="token-history-updating"');
    expect(html).toContain("Still counting");
    expect(html.indexOf('data-testid="token-history-updating"')).toBeLessThan(
      html.indexOf("1,234"),
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

    expect(html).toContain("Last 30 days");
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

    expect(html).toContain("zero</p>");
    expect(html).toContain("No data");
    expect(html).not.toContain("Loading usage");
  });

  it("points an empty usage result to provider settings", () => {
    const html = renderUsage(null, { ...usage, providers: [] });

    expect(html).toContain("No provider usage is available yet.");
    expect(html).toContain("Manage providers in Settings, then refresh usage.");
    expect(html).not.toContain("Enable a provider below");
  });

  it("shows a dedicated token usage refresh action as an icon button", () => {
    const html = renderUsage();
    const refresh = refreshButtonTag(html);

    expect(refresh).toContain('aria-label="Refresh"');
    expect(refresh).not.toContain('aria-busy="true"');
    expect(refresh).not.toContain(' disabled=""');
    expect(html).not.toContain("Refresh token usage");
  });

  it("keeps the Refresh icon button in its pending state while usage reloads", () => {
    const html = renderUsage("usage");
    const refresh = refreshButtonTag(html);

    expect(refresh).toContain('aria-busy="true"');
    expect(refresh).toContain("disabled");
    expect(html).toContain('data-slot="spinner"');
  });

  it("shows the 30-day head: label, total with its unit, and the words line", () => {
    const html = renderUsage();

    expect(html).toContain(">Last 30 days</h2>");
    expect(html).toContain("<span>1,234</span>");
    expect(html).toContain(">tokens</span>");
    expect(html).toContain(">one thousand two hundred thirty-four</p>");
  });

  it("draws the lane bars 12 px high with a 4 px corner (master 19.10.)", () => {
    const html = renderUsage();

    expect(html).toContain("h-3 rounded-[4px] [&amp;_[data-slot=progress-indicator]]:rounded-[4px]");
    expect(html).not.toContain("h-1.5");
  });

  it("sets the 30-day total in the hero size and nothing else in the head", () => {
    const html = renderUsage();

    expect(html).toMatch(/<p class="text-hero [^"]*font-semibold[^"]*">/);
    expect(html.match(/text-hero/g)).toHaveLength(1);
  });

  it("puts the provider legend below the chart, left-aligned, and keeps the Refresh icon in the head", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        { ...usage.providers[0], id: "claude", label: "Claude" },
        usage.providers[0],
      ],
    });
    const chart = html.indexOf('aria-label="Daily tokens used over time');
    const legend = html.indexOf('data-testid="usage-legend"');
    const head = html.indexOf(">Last 30 days</h2>");

    expect(legend).toBeGreaterThan(chart);
    expect(html.slice(legend, html.indexOf("</div>", legend))).toContain(">Claude</span>");
    expect(html.slice(head, chart)).not.toContain("usage-legend");
    expect(html.slice(head, chart)).toContain('aria-label="Refresh"');
    expect(html.slice(legend, html.indexOf("</div>", legend))).not.toContain("Refresh");
  });

  it("draws the chart without a card title and gives each provider its own colour", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        { ...usage.providers[0], id: "claude", label: "Claude" },
        usage.providers[0],
      ],
    });

    expect(html).not.toContain("Tokens used over time");
    expect(html).toContain("background:var(--chart-1)");
    expect(html).toContain("background:var(--chart-2)");
  });

  it("gives Claude and Codex different chart colours in the chart config", () => {
    const { series } = buildProviderTokenChart([
      { provider: { ...usage.providers[0], id: "claude", label: "Claude" }, days: [{ day: "2026-10-01", totalTokens: 5 }] },
      { provider: usage.providers[0], days: [{ day: "2026-10-01", totalTokens: 7 }] },
    ] as Parameters<typeof buildProviderTokenChart>[0]);

    expect(series.map((item) => item.color)).toEqual(["var(--chart-1)", "var(--chart-2)"]);
  });

  it("keeps Claude in ink and Codex in olive when the response lists Codex first", () => {
    const codex = { ...usage.providers[0], id: "codex", label: "Codex" };
    const { series } = buildProviderTokenChart([
      { provider: codex, days: [{ day: "2026-10-01", totalTokens: 7 }] },
      { provider: { ...codex, id: "claude", label: "Claude" }, days: [{ day: "2026-10-01", totalTokens: 5 }] },
    ] as Parameters<typeof buildProviderTokenChart>[0]);

    expect(series.map((item) => [item.label, item.color])).toEqual([
      ["Codex", "var(--chart-2)"],
      ["Claude", "var(--chart-1)"],
    ]);
  });

  it("never gives another provider the colour of Claude or Codex", () => {
    const codex = { ...usage.providers[0], id: "codex", label: "Codex" };
    const gemini = { ...codex, id: "gemini", label: "Gemini" };
    const claude = { ...codex, id: "claude", label: "Claude" };
    const { series } = buildProviderTokenChart([
      { provider: codex, days: [{ day: "2026-10-01", totalTokens: 7 }] },
      { provider: gemini, days: [{ day: "2026-10-01", totalTokens: 3 }] },
    ] as Parameters<typeof buildProviderTokenChart>[0]);
    const reversed = buildProviderTokenChart([
      { provider: gemini, days: [{ day: "2026-10-01", totalTokens: 3 }] },
      { provider: claude, days: [{ day: "2026-10-01", totalTokens: 5 }] },
    ] as Parameters<typeof buildProviderTokenChart>[0]);

    expect(series.map((item) => item.color)).toEqual(["var(--chart-2)", "var(--chart-3)"]);
    expect(reversed.series.map((item) => item.color)).toEqual(["var(--chart-3)", "var(--chart-1)"]);
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

    expect(html).toContain("Last 30 days");
    expect(html).toContain('aria-label="Daily tokens used over time for Codex"');
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

    expect(html).toContain('aria-label="Updating"');
    expect(html).toContain("Tokens: 5,600 total · 3,400 this week");
    expect(html).not.toContain("??");
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
    expect(html).not.toContain("Last 30 days");
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
    expect(recovered).toContain("Last 30 days");
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

    expect(html).toContain('aria-label="Updating"');
    expect(html).not.toContain("??");
    expect(html).not.toContain("session used");
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

    expect(html).toContain("Last 30 days");
    expect(html).toContain("Tokens: 56 total · 34 this week");
    expect(html).toContain('aria-label="Updating"');
    expect(html).not.toContain("??");
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

    expect(html).toContain('aria-label="57% 7-day quota used"');
    expect(html).toContain('aria-label="12% Codex Spark Weekly used"');
    expect(html.indexOf('aria-label="57% 7-day quota used"')).toBeLessThan(
      html.indexOf('aria-label="12% Codex Spark Weekly used"'),
    );
    expect(html).not.toContain("Session:");
    expect(html).not.toContain("Session: 0%");
  });

  // CodexBar's own window label stays as delivered; only the generic lanes are lowercase.
  it("keeps a named CodexBar window label as delivered and lowercases only session and weekly", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 94,
          weekly: 91,
          usageMode: "remaining",
          windows: [
            { id: "session", label: "Session", usedPercent: 94 },
            { id: "weekly", label: "Weekly", usedPercent: 91 },
            { id: "fable", label: "Fable only", usedPercent: 100 },
          ],
        },
      ],
    });

    expect(html).toContain('aria-label="94% session remaining"');
    expect(html).toContain('aria-label="91% weekly remaining"');
    expect(html).toContain('aria-label="100% Fable only remaining"');
    expect(html).not.toContain("fable only remaining");
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

    expect(html).toContain('aria-label="23% Custom quota used"');
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

    expect(html).not.toContain("??");
    expect(html).toContain('aria-label="57% weekly used"');
    expect(html).not.toContain("Session: 0%");
    expect(html).not.toContain("session used");
    expect(html).toContain("session usage unavailable");
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
  it("shows the number the response delivered, used or remaining, number first", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [{ ...usage.providers[0], session: 45, weekly: 26, usageMode: "remaining" }],
    });
    expect(html).toContain('aria-label="45% session remaining"');
    expect(html).toContain('aria-label="26% weekly remaining"');
    expect(html).toContain(">45%</span>");
    expect(html).not.toContain("55% session");
    expect(html).not.toContain("74% weekly");
  });

  it("keeps Stale pills, retry buttons and status pills off the Usage tiles", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [{ ...usage.providers[0], stale: true, status: { description: "Degraded" } }],
    });
    expect(html).not.toContain("Stale");
    expect(html).not.toContain("Check again");
    expect(html).toContain('aria-label="Updating"');
  });

  it("swaps the reset time for the Updating spinner in a quiet tile and keeps its numbers", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          stale: true,
          resetSecs: 3600,
          sessionRetained: true,
          weeklyRetained: true,
        },
      ],
    });
    expect(html).toContain('aria-label="Updating"');
    expect(html).not.toContain("Reset in");
    expect(html).toContain('aria-label="34% weekly used"');
  });

  it("keeps a stale provider's last good numbers visible with the Updating spinner", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 45,
          weekly: 26,
          resetSecs: 3600,
          stale: true,
          usageUnavailable: true,
          sessionUnavailable: true,
          weeklyUnavailable: true,
          sessionRetained: true,
          weeklyRetained: true,
        },
      ],
    });
    expect(html).toContain('aria-label="45% session used"');
    expect(html).toContain('aria-label="26% weekly used"');
    expect(html).toContain('aria-label="Updating"');
    expect(html).not.toContain("??");
    expect(html).not.toContain("Reset in");
  });

  it("shows a stale retained 0% lane as a number with the Updating spinner", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 0,
          weekly: 26,
          stale: true,
          usageUnavailable: true,
          sessionUnavailable: true,
          weeklyUnavailable: true,
          sessionRetained: true,
          weeklyRetained: true,
        },
      ],
    });
    expect(html).toContain('aria-label="0% session used"');
    expect(html).toContain('aria-label="26% weekly used"');
    expect(html).toContain('aria-label="Updating"');
  });

  it("keeps a non-current stale provider whose retained lanes are all 0% visible", () => {
    const html = renderUsage(null, {
      ...usage,
      currentProvider: "codex",
      providers: [
        usage.providers[0],
        {
          id: "claude",
          label: "Claude",
          session: 0,
          weekly: 0,
          usageMode: "used",
          stale: true,
          usageUnavailable: true,
          sessionUnavailable: true,
          weeklyUnavailable: true,
          sessionRetained: true,
          weeklyRetained: true,
        },
      ],
    });
    expect(html).toContain("Claude");
    expect(html).toContain('aria-label="0% session used"');
  });

  it("shows a stale retained 0% window as a number", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          stale: true,
          usageUnavailable: true,
          windowsRetained: true,
          windows: [{ id: "weekly", label: "Weekly", usedPercent: 0 }],
        },
      ],
    });
    expect(html).toContain('aria-label="0% weekly used"');
    expect(html).toContain('aria-label="Updating"');
  });

  it("shows no 0% for a cleared stale provider with nothing retained", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 0,
          weekly: 0,
          stale: true,
          usageUnavailable: true,
          sessionUnavailable: true,
          weeklyUnavailable: true,
        },
      ],
    });
    expect(html).not.toContain("0% session used");
    expect(html).not.toContain("0% weekly used");
    expect(html).toContain('aria-label="Updating"');
  });

  it("keeps a stale reading's retained lane and shows a lane it does not retain as unavailable", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [
        {
          ...usage.providers[0],
          session: 0,
          weekly: 58,
          stale: true,
          usageUnavailable: true,
          sessionUnavailable: true,
          weeklyUnavailable: true,
          weeklyRetained: true,
        },
      ],
    });
    expect(html).toContain('aria-label="58% weekly used"');
    expect(html).not.toContain("0% session");
    expect(html.match(/aria-valuenow="\d+"/g)).toEqual(['aria-valuenow="58"']);
  });

  it("shows a normal tile's reset time", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [{ ...usage.providers[0], resetSecs: 3600 }],
    });
    expect(html).toContain("Reset in");
    expect(html).not.toContain('aria-label="Updating"');
  });

  // Calm type on the provider tiles (master 19.10.: title 15 / 600, main number
  // 32 / 600, body 14.5 / 400 as in the master). The big total above is not part of this.
  it("sets a tile title in 15 px / 600 and its main number in 32 px / 600", () => {
    render(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          providers: [
            {
              id: "claude",
              label: "Claude",
              session: 40,
              weekly: 20,
              usageMode: "used",
              stale: false,
              windows: [{ id: "session", label: "Session", usedPercent: 40 }],
            },
          ],
        }}
      />,
    );

    const title = screen.getByRole("heading", { name: "Claude" });
    expect(title.className).toContain("text-[15px]");
    expect(title.className).toContain("font-semibold");
    expect(title.className).not.toMatch(/\b(text-base|text-xl|font-medium|font-black|font-bold)\b/);

    const mainNumber = screen.getByText("40%");
    expect(mainNumber.className).toContain("text-[32px]");
    expect(mainNumber.className).toContain("font-semibold");
  });

  it("sets the tile's body text in 14.5 px / 400 and muted, without an Activity row", () => {
    render(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          providers: [
            {
              id: "claude",
              label: "Claude",
              session: 40,
              weekly: 20,
              totalTokens: 1234567,
              usageMode: "used",
              stale: false,
              activity: "Coding",
              status: { description: "All systems operational" },
              windows: [{ id: "session", label: "Session", usedPercent: 40 }],
            },
          ],
        }}
      />,
    );

    // The master draws no Activity row.
    expect(screen.queryByText("Activity")).toBeNull();
    expect(screen.queryByText("Coding")).toBeNull();
    // The token line sits in the token row, which carries the type (the plan
    // and extra-usage lines share it).
    for (const element of [
      screen.getByText("All systems operational"),
      screen.getByText(/^Tokens:/).parentElement as HTMLElement,
    ]) {
      expect(element.className).toContain("text-[14.5px]");
      expect(element.className).not.toMatch(/\bfont-(semibold|bold|black|medium)\b/);
      expect(element.className).toContain("text-muted-foreground");
    }
  });

  it("keeps a lane label on one line, so 'SESSION (5H)' does not wrap in a tile", () => {
    render(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          providers: [
            {
              id: "claude",
              label: "Claude",
              session: 40,
              weekly: 20,
              usageMode: "used",
              stale: false,
              windows: [
                { id: "session", label: "Session (5h)", usedPercent: 40 },
                { id: "weekly", label: "Weekly", usedPercent: 20, resetSecs: 3600 },
              ],
            },
          ],
        }}
      />,
    );

    // The number in ink, its words muted (master 19.10.).
    const weeklyLabel = screen.getByText("weekly used").parentElement as HTMLElement;
    expect(weeklyLabel.textContent).toBe("20% weekly used");
    expect(weeklyLabel.className).toContain("whitespace-nowrap");
    expect(screen.getByText("weekly used").className).toContain("text-muted-foreground");
    // A reset that has no room beside the label moves under it, never clipped.
    expect(weeklyLabel.parentElement?.className).toContain("flex-wrap");
    // Wrapped alone on its line, the reset keeps its place on the right.
    expect(screen.getByText(/^Reset in/).className).toContain("ml-auto");
  });

  // The header holds only the name. Each reset sits right-aligned on its own
  // lane row: the first (session or weekly) line for the big number, the
  // later lines beside their bar.
  it("puts each reset on its first lane row, not in the tile header", () => {
    render(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          providers: [
            {
              id: "claude",
              label: "Claude",
              session: 94,
              weekly: 91,
              resetSecs: 9469,
              usageMode: "remaining",
              stale: false,
              windows: [
                { id: "session", label: "Session", usedPercent: 94, resetSecs: 9469 },
                { id: "weekly", label: "Weekly", usedPercent: 91, resetSecs: 95869 },
              ],
            },
            {
              id: "codex",
              label: "Codex",
              session: 0,
              weekly: 71,
              usageMode: "remaining",
              stale: false,
              windows: [{ id: "weekly", label: "Weekly", usedPercent: 71, resetSecs: 471073 }],
            },
          ],
        }}
      />,
    );

    const sessionReset = screen.getByText("Reset in 2h 37m");
    const sessionRow = sessionReset.parentElement as HTMLElement;
    expect(sessionRow.textContent).toBe("94% session remainingReset in 2h 37m");
    expect(sessionRow.nextElementSibling?.querySelector("[role=progressbar]")?.getAttribute("aria-label")).toBe(
      "94% session remaining",
    );
    expect(sessionReset.closest('[data-slot="card-header"]')).toBeNull();
    expect(
      sessionReset.closest('[data-slot="card"]')?.querySelector('[data-slot="card-header"]')
        ?.textContent,
    ).toBe("Claude");

    const weeklyReset = screen.getByText("Reset in 1d 2h");
    expect((weeklyReset.parentElement as HTMLElement).textContent).toBe(
      "91% weekly remainingReset in 1d 2h",
    );

    const codexReset = screen.getByText("Reset in 5d 10h");
    expect((codexReset.parentElement as HTMLElement).textContent).toBe(
      "71% weekly remainingReset in 5d 10h",
    );
    expect(
      codexReset.closest('[data-slot="card"]')?.querySelector('[data-slot="card-header"]')
        ?.textContent,
    ).toBe("Codex");
  });

  // The Updating spinner takes the first line's reset place, same line, right.
  it("puts the Updating spinner on the first lane row and keeps it out of the header", () => {
    render(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          providers: [
            {
              ...usage.providers[0],
              session: 45,
              weekly: 26,
              resetSecs: 3600,
              stale: true,
              usageUnavailable: true,
              sessionUnavailable: true,
              weeklyUnavailable: true,
              sessionRetained: true,
            },
          ],
        }}
      />,
    );

    const spinner = screen.getByLabelText("Updating");
    const row = spinner.parentElement as HTMLElement;
    expect(row.textContent).toBe("45% session used");
    expect(row.nextElementSibling?.querySelector("[role=progressbar]")?.getAttribute("aria-label")).toBe("45% session used");
    expect(spinner.closest('[data-slot="card-header"]')).toBeNull();
    expect(screen.queryByText(/Reset in/)).toBeNull();
  });

  // CodexBar's pace: the line appears under the window only when CodexBar says
  // the window will not last to its reset.
  describe("runs-out line from CodexBar's pace", () => {
    const weekly = { id: "weekly", label: "Weekly", usedPercent: 54, resetSecs: 500000 };

    it("shows the runs-out line when CodexBar says the window will not last", () => {
      const html = renderUsage(null, {
        ...usage,
        providers: [
          {
            ...usage.providers[0],
            windows: [{ ...weekly, willLastToReset: false, etaSeconds: 230241 }],
          },
        ],
      });
      expect(html).toContain("Runs out in 2d 15h");
      expect(html).toContain('class="text-[13px] font-semibold text-destructive"');
    });

    it("shows no runs-out line when the window will last to its reset", () => {
      const html = renderUsage(null, {
        ...usage,
        providers: [{ ...usage.providers[0], windows: [{ ...weekly, willLastToReset: true }] }],
      });
      expect(html).not.toContain("Runs out in");
    });

    it("shows no runs-out line without CodexBar's pace", () => {
      const html = renderUsage(null, {
        ...usage,
        providers: [{ ...usage.providers[0], windows: [weekly] }],
      });
      expect(html).not.toContain("Runs out in");
    });

    it("shows no runs-out line on a stale tile", () => {
      const html = renderUsage(null, {
        ...usage,
        providers: [
          {
            ...usage.providers[0],
            stale: true,
            windows: [{ ...weekly, willLastToReset: false, etaSeconds: 230241 }],
          },
        ],
      });
      expect(html).not.toContain("Runs out in");
      expect(html).toContain('aria-label="Updating"');
    });

    it("ages the runs-out countdown from the snapshot time and drops it once none is left", () => {
      const html = renderUsage(null, {
        ...usage,
        providers: [
          {
            ...usage.providers[0],
            collectedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
            windows: [{ ...weekly, willLastToReset: false, etaSeconds: 3600 }],
          },
        ],
      });
      expect(html).not.toContain("Runs out in");
    });
  });

  // Healthy and not stale while token history is still counting: the resets
  // stay, the spinner stays away, and each window shows its own reset.
  it("shows the resets of healthy, fresh tiles while token history still counts", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onRefresh={vi.fn()}
        usage={{
          ...usage,
          tokenUsageReady: true,
          tokenUsageUpdating: true,
          providers: [
            {
              id: "claude",
              label: "Claude",
              session: 94,
              weekly: 91,
              resetSecs: 9469,
              usageMode: "remaining",
              stale: false,
              windows: [
                { id: "session", label: "Session", usedPercent: 94, resetSecs: 9469 },
                { id: "weekly", label: "Weekly", usedPercent: 91, resetSecs: 95869 },
                { id: "fable", label: "Fable only", usedPercent: 100 },
              ],
              cost: { daily: [{ day: "2026-10-16", totalTokens: 1234 }] },
            },
            {
              id: "codex",
              label: "Codex",
              session: 0,
              weekly: 71,
              usageMode: "remaining",
              stale: false,
              windows: [{ id: "weekly", label: "Weekly", usedPercent: 71, resetSecs: 471073 }],
              cost: { daily: [{ day: "2026-10-16", totalTokens: 1234 }] },
            },
          ],
        }}
      />,
    );
    expect(html).toContain('data-testid="token-history-updating"');
    expect(html).not.toContain('aria-label="Updating"');
    expect(html).toContain("Reset in 2h 37m");
    expect(html).toContain("Reset in 1d 2h");
    expect(html).toContain("Reset in 5d 10h");
  });

  it("leaves an action tile blank even when stale numbers exist", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        providerActions={{
          codex: { name: "Codex", state: "auth_required", label: "Sign in needed", onAction: vi.fn() },
        }}
        usage={{
          ...usage,
          providers: [{ ...usage.providers[0], session: 45, weekly: 26, stale: true, usageUnavailable: true }],
        }}
      />,
    );
    expect(html).toContain('aria-label="Sign in needed for Codex"');
    expect(html).not.toContain("45%");
    expect(html).not.toContain("26%");
    expect(html).not.toContain('aria-label="Updating"');
    expect(html).not.toContain("Reset in");
  });

  it("drops action tiles while the Mac App is not reachable", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="missing"
        providerActions={{
          claude: { name: "Claude", state: "auth_required", label: "Sign in needed", onAction: vi.fn() },
        }}
        usage={null}
      />,
    );
    expect(html).not.toContain("Sign in needed");
    expect(html).toContain("Mac App needs setup.");
  });

  it("shows action tiles in place of numbers, also for a provider with no usage entry", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        providerActions={{
          codex: { name: "Codex", state: "auth_required", label: "Sign in needed", onAction: vi.fn() },
          claude: { name: "Claude", state: "auth_required", label: "Sign in needed", onAction: vi.fn() },
        }}
        usage={usage}
      />,
    );
    expect(html.match(/Sign in needed<svg/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Sign in needed for Claude"');
    expect(html).toContain("Claude");
    expect(html).not.toContain("session used");
    expect(html).not.toContain("??");
    expect(html).not.toContain("Check again");
  });

  it("shows an action tile, not the loading state, while usage is still pending", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        providerActions={{
          claude: { name: "Claude", state: "auth_required", label: "Sign in needed", onAction: vi.fn() },
        }}
        usage={null}
      />,
    );
    expect(html).toContain('aria-label="Sign in needed for Claude"');
    expect(html).not.toContain("Loading usage");
  });

  it("does not report missing token history for a hidden provider", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        hiddenProviderIds={["codex"]}
        usage={{
          ...usage,
          providers: [
            { ...usage.providers[0], cost: undefined },
            { ...usage.providers[0], id: "claude", label: "Claude", cost: { daily: [{ day: "2026-07-22", totalTokens: 9 }] } },
          ],
        }}
      />,
    );
    expect(html).not.toContain("Token history is unavailable");
  });

  it("draws no chart skeleton for only a hidden provider while token history loads", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        hiddenProviderIds={["codex"]}
        usage={{
          ...usage,
          tokenUsageReady: false,
          providers: [{ ...usage.providers[0], cost: undefined }],
        }}
      />,
    );
    expect(html).not.toContain('data-slot="skeleton"');
    expect(html).not.toContain("Token history is loading");
    expect(html).toContain("No provider usage is available yet.");
  });

  it("leaves a hidden provider out of the token total and legend", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        hiddenProviderIds={["codex"]}
        usage={{
          ...usage,
          providers: [
            usage.providers[0],
            { ...usage.providers[0], id: "claude", label: "Claude", cost: { daily: [{ day: "2026-07-22", totalTokens: 9 }] } },
          ],
        }}
      />,
    );
    expect(html).toContain("<span>9</span>");
    expect(html).not.toContain("1,243");
    expect(html.match(/data-testid="usage-legend".*?<\/div>/)?.[0]).not.toContain("Codex");
  });

  it("shows no still-loading notice beside an action tile", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        providerActions={{
          claude: { name: "Claude", state: "auth_required", label: "Sign in needed", onAction: vi.fn() },
        }}
        usage={{ ok: true, refresh: { state: "unavailable" }, providers: [] }}
      />,
    );
    expect(html).toContain('aria-label="Sign in needed for Claude"');
    expect(html).not.toContain("Usage is still loading");
  });

  it("gives no tile to a hidden provider, even with a usage entry", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        hiddenProviderIds={["codex"]}
        usage={usage}
      />,
    );
    expect(html).not.toContain("session used");
    // No tile list: the provider gets no tile (its name may still stand in the chart legend).
    expect(html).not.toContain("<ol");
  });

  it("opens Settings for every action where the Companion cannot start a sign-in", () => {
    const onOpenSettings = vi.fn();
    const pref = {
      id: "codexbar.providers.claude.enabled",
      section: "providers",
      type: "boolean",
      providerId: "claude",
      label: "Claude",
      value: true,
      health: { state: "auth_required", service: "unknown", message: "" },
    } as unknown as PreferenceDescriptor;
    const actions = usageProviderActionsFor([pref], { onOpenSettings });
    expect(actions.claude.inSettings).toBe(true);
    actions.claude.onAction();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("maps each provider health to its action, and only for enabled providers", () => {
    const onOpenSettings = vi.fn();
    const onSignIn = vi.fn();
    const pref = (providerId: string, state: string, value = true) =>
      ({
        id: `codexbar.providers.${providerId}.enabled`,
        section: "providers",
        type: "boolean",
        providerId,
        label: providerId.charAt(0).toUpperCase() + providerId.slice(1),
        value,
        health: { state, service: "unknown", message: "" },
      }) as unknown as PreferenceDescriptor;
    const actions = usageProviderActionsFor(
      [
        pref("claude", "auth_required"),
        pref("gemini", "permission_required"),
        pref("cursor", "setup_required"),
        pref("copilot", "browser_sign_in_required"),
        pref("codex", "healthy"),
        pref("zai", "auth_required"),
        pref("kiro", "auth_required", false),
      ],
      { onOpenSettings, onSignIn },
    );
    expect(Object.keys(actions)).toEqual(["claude", "gemini", "cursor", "copilot", "zai"]);
    expect(actions.claude.label).toBe("Sign in needed");
    expect(actions.gemini.label).toBe("Allow access");
    expect(actions.cursor.label).toBe("Sign in needed");
    expect(actions.copilot.label).toBe("Sign in needed");

    actions.claude.onAction();
    expect(onSignIn).toHaveBeenCalledWith(expect.objectContaining({ providerId: "claude" }));
    // Zai has no sign-in the Companion can start, and Cursor's setup does: the setup row's rule.
    actions.zai.onAction();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    actions.cursor.onAction();
    expect(onSignIn).toHaveBeenCalledTimes(2);
  });
});

describe("token chart days (#579)", () => {
  const provider = (id: string) => ({ id, label: id, costSettled: true });
  it("leaves uncounted days empty while another provider has settled", () => {
    const snapshot: UsageSnapshot = {
      ...usage,
      tokenUsageUpdating: true,
      providers: [
        { ...usage.providers[0], ...provider("claude"), costSettled: false,
          cost: { daily: [{ day: "2026-10-20", totalTokens: 100 }] } },
        { ...usage.providers[0], ...provider("codex"),
          cost: { daily: [
            { day: "2026-10-19", totalTokens: 50 },
            { day: "2026-10-20", totalTokens: 70 },
          ] } },
      ],
    };
    expect(buildProviderTokenChart(snapshot.providers.map((provider) => ({
      provider, days: provider.cost!.daily!,
    }))).chartData).toEqual([
      { day: "2026-10-19", provider2: 50 },
      { day: "2026-10-20", provider1: 100, provider2: 70 },
    ]);
  });

  it.each([false, undefined])("keeps internal gaps unknown until costSettled is true (%s)", (costSettled) => {
    const history = {
      provider: { ...usage.providers[0], costSettled },
      days: [
        { day: "2026-10-18", totalTokens: 5 },
        { day: "2026-10-20", totalTokens: 0 },
      ],
    };
    expect(buildProviderTokenChart([history]).chartData).toEqual([
      { day: "2026-10-18", provider1: 5 },
      { day: "2026-10-19" },
      { day: "2026-10-20", provider1: 0 },
    ]);
    history.provider.costSettled = true;
    expect(buildProviderTokenChart([history]).chartData[1]).toEqual({
      day: "2026-10-19", provider1: 0,
    });
  });

  it("draws a day the history leaves out as a day without tokens", () => {
    const { chartData } = buildProviderTokenChart([
      { provider: provider("codex"), days: [
        { day: "2026-09-16", totalTokens: 5 },
        { day: "2026-09-17", totalTokens: 6 },
        { day: "2026-09-20", totalTokens: 7 },
      ] },
      { provider: provider("claude"), days: [
        { day: "2026-09-18", totalTokens: 9 },
      ] },
    ] as Parameters<typeof buildProviderTokenChart>[0]);
    expect(chartData).toEqual([
      { day: "2026-09-16", provider1: 5, provider2: 0 },
      { day: "2026-09-17", provider1: 6, provider2: 0 },
      { day: "2026-09-18", provider1: 0, provider2: 9 },
      { day: "2026-09-19", provider1: 0, provider2: 0 },
      { day: "2026-09-20", provider1: 7, provider2: 0 },
    ]);
  });

  it("keeps every reported day when they lie too far apart to fill in", () => {
    const { chartData } = buildProviderTokenChart([
      { provider: provider("codex"), days: [
        { day: "2024-01-01", totalTokens: 1 },
        { day: "2024-06-01", totalTokens: 2 },
        { day: "2026-01-01", totalTokens: 3 },
      ] },
    ] as Parameters<typeof buildProviderTokenChart>[0]);
    expect(chartData.map((row) => row.day)).toEqual(["2024-01-01", "2024-06-01", "2026-01-01"]);
  });

  it("keeps a single day and an empty history as they are", () => {
    expect(buildProviderTokenChart([
      { provider: provider("codex"), days: [{ day: "2026-09-16", totalTokens: 5 }] },
    ] as Parameters<typeof buildProviderTokenChart>[0]).chartData).toEqual([
      { day: "2026-09-16", provider1: 5 },
    ]);
    expect(buildProviderTokenChart([]).chartData).toEqual([]);
  });
});

describe("UsageScreen plan name and extra-usage cap", () => {
  const claude = (extra: Partial<UsageSnapshot["providers"][number]>): UsageSnapshot => ({
    ...usage,
    providers: [
      {
        id: "claude",
        label: "Claude",
        session: 5,
        weekly: 10,
        usageMode: "used",
        totalTokens: 1200000,
        ...extra,
      },
    ],
  });

  it("shows the plan name after the provider name, muted", () => {
    const html = renderUsage(null, claude({ plan: "Max 20x" }));
    expect(html).toContain(" · Max 20x</span>");
    expect(html).toContain("Claude");
  });

  it("shows no plan name when CodexBar sends none", () => {
    const html = renderUsage(null, claude({}));
    expect(html).not.toContain("Max 20x");
  });

  it("shows the monthly extra-usage cap in its currency", () => {
    const html = renderUsage(
      null,
      claude({ spend: { limit: 100, used: 0, currency: "EUR", period: "Monthly cap" } }),
    );
    expect(html).toContain("Extra usage €0 of €100 this month");
  });

  it("formats a USD cap and omits a period other than monthly", () => {
    const html = renderUsage(
      null,
      claude({ spend: { limit: 50, used: 12.5, currency: "USD", period: "Extra usage" } }),
    );
    expect(html).toContain("Extra usage $12.5 of $50");
    expect(html).not.toContain("this month");
  });

  it("keeps a provider that has only a plan or a cap, even at zero use", () => {
    const zero = { session: 0, weekly: 0, totalTokens: 0 };
    expect(renderUsage(null, claude({ ...zero, plan: "Max 20x" }))).toContain("Max 20x");
    expect(
      renderUsage(
        null,
        claude({ ...zero, spend: { limit: 100, used: 0, currency: "EUR", period: "Monthly cap" } }),
      ),
    ).toContain("Extra usage €0 of €100 this month");
  });

  it("shows no extra-usage line without a cap above zero", () => {
    expect(renderUsage(null, claude({}))).not.toContain("Extra usage");
    expect(
      renderUsage(null, claude({ spend: { limit: 0, used: 0, currency: "Credits", period: "Extra usage" } })),
    ).not.toContain("Extra usage");
    expect(
      renderUsage(null, claude({ spend: { limit: 100, used: 0, currency: "Credits" } })),
    ).not.toContain("Extra usage");
  });
});

describe("weekly axis ticks", () => {
  const days = (first: string, count: number) =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(`${first}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });

  it("labels the first day, every seventh day and the last day, as the master", () => {
    expect(weeklyDayTicks(days("2026-09-20", 30))).toEqual([
      "2026-09-20",
      "2026-09-27",
      "2026-10-04",
      "2026-10-11",
      "2026-10-19",
    ]);
  });

  it("leaves out a weekly day that would crowd the last day", () => {
    expect(weeklyDayTicks(days("2026-09-20", 30).slice(0, 29))).toEqual([
      "2026-09-20",
      "2026-09-27",
      "2026-10-04",
      "2026-10-11",
      "2026-10-18",
    ]);
  });

  it("labels the first day of a short history too", () => {
    expect(weeklyDayTicks(["2026-10-17", "2026-10-18", "2026-10-19"])).toEqual([
      "2026-10-17",
      "2026-10-19",
    ]);
  });

  it("has no tick without days and one for a single day", () => {
    expect(weeklyDayTicks([])).toEqual([]);
    expect(weeklyDayTicks(["2026-10-19"])).toEqual(["2026-10-19"]);
  });
});
