import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "./control-center-types";
import { UsageScreen } from "./usage-screen";

const usage: UsageSnapshot = {
  ok: true,
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
      onPreferenceChange={vi.fn()}
      onRefresh={vi.fn()}
      pendingPreferenceIds={new Set()}
      preferences={[]}
      usage={snapshot}
    />,
  );
}

describe("UsageScreen", () => {
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
    expect(html).toContain("usage unavailable");
    expect(html).not.toContain("Session: 0%");
    expect(html).not.toContain("Weekly: 0%");
    expect(html).not.toContain("Reset in");
  });

  it("renders missing normalized window lanes as unknown before extras", () => {
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

    expect(html).toContain("Session: ??");
    expect(html).toContain("7-day quota: 57% used");
    expect(html).toContain("Codex Spark Weekly: 12% used");
    expect(html.indexOf("Session: ??")).toBeLessThan(
      html.indexOf("7-day quota: 57% used"),
    );
    expect(html.indexOf("7-day quota: 57% used")).toBeLessThan(
      html.indexOf("Codex Spark Weekly: 12% used"),
    );
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
});
