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
  afterEach(cleanup);

  it("does not present a partial provider sum as complete token history", () => {
    const html = renderUsage(null, {
      ...usage,
      providers: [...usage.providers, { id: "claude", label: "Claude", session: 0, weekly: 10, usageMode: "used" }],
    });
    expect(html).toContain("Token history is unavailable");
    expect(html).toContain("not available for every selected provider");
    expect(html).not.toContain("Total tokens in the last 30 days");
    expect(html).toContain('aria-label="34% weekly used"');
    expect(html).toContain('aria-label="10% weekly used"');
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
    expect(html).toContain('aria-label="34% weekly used"');
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
    expect(html).toContain('aria-label="12% session used"');
    expect(html).toContain('aria-label="34% weekly used"');
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

    expect(html).toContain("Total tokens in the last 30 days");
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
    expect(html).toContain('aria-label="12% codex spark weekly used"');
    expect(html.indexOf('aria-label="57% 7-day quota used"')).toBeLessThan(
      html.indexOf('aria-label="12% codex spark weekly used"'),
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

    expect(html).toContain('aria-label="23% custom quota used"');
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
      providers: [{ ...usage.providers[0], stale: true, resetSecs: 3600 }],
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
        },
      ],
    });
    expect(html).toContain('aria-label="45% session used"');
    expect(html).toContain('aria-label="26% weekly used"');
    expect(html).toContain('aria-label="Updating"');
    expect(html).not.toContain("??");
    expect(html).not.toContain("Reset in");
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

  it("keeps a stale reading's non-zero lane and shows a zero lane as unavailable", () => {
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
    expect(sessionRow.nextElementSibling?.getAttribute("aria-label")).toBe(
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
            },
          ],
        }}
      />,
    );

    const spinner = screen.getByLabelText("Updating");
    const row = spinner.parentElement as HTMLElement;
    expect(row.textContent).toBe("45% session used");
    expect(row.nextElementSibling?.getAttribute("aria-label")).toBe("45% session used");
    expect(spinner.closest('[data-slot="card-header"]')).toBeNull();
    expect(screen.queryByText(/Reset in/)).toBeNull();
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
    expect(html).not.toContain(">Codex<");
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
