import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UsageScreen } from "./usage-screen";

const usage = {
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

function renderUsage(busyAction: string | null = null) {
  return renderToStaticMarkup(
    <UsageScreen
      busyAction={busyAction}
      companionStatus="online"
      onPreferenceChange={vi.fn()}
      onRefresh={vi.fn()}
      pendingPreferenceIds={new Set()}
      preferences={[]}
      usage={usage}
    />,
  );
}

describe("UsageScreen", () => {
  it("shows a simple loading state while the first usage snapshot is pending", () => {
    const html = renderToStaticMarkup(
      <UsageScreen
        companionStatus="online"
        onPreferenceChange={vi.fn()}
        onRefresh={vi.fn()}
        pendingPreferenceIds={new Set()}
        preferences={null}
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
        onPreferenceChange={vi.fn()}
        onRefresh={vi.fn()}
        pendingPreferenceIds={new Set()}
        preferences={[]}
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
});
