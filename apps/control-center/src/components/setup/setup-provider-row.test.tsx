import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupProviderRow } from "./setup-provider-row";

function render(props: Partial<Parameters<typeof SetupProviderRow>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupProviderRow
      enabled
      health="healthy"
      label="Claude Code"
      onCheckAgain={vi.fn()}
      onToggle={vi.fn()}
      {...props}
    />,
  );
}

describe("SetupProviderRow", () => {
  it("shows a ready provider as a switch that is on", () => {
    const html = render();

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("lucide-chevron-right");
  });

  it("shows an available but unused provider as a switch that is off", () => {
    const html = render({ enabled: false });

    expect(html).toContain('aria-checked="false"');
  });

  it("keeps a provider that already produced a reading switchable", () => {
    expect(render({ health: "disabled" })).toContain('role="switch"');
    const stale = render({
      detail: "Live usage is unavailable. Showing the last saved reading.",
      health: "stale",
    });
    expect(stale).toContain('role="switch"');
    expect(stale).toContain(
      "Live usage is unavailable. Showing the last saved reading.",
    );
    expect(stale).not.toContain('aria-label="Check Claude Code again"');
  });

  // A check that is slow or stuck must not hold the customer on the step: the
  // switch is the way past it, and the running check keeps its spinner.
  it("keeps the switch usable while the provider is being checked", () => {
    const html = render({ health: "checking" });

    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain('role="switch"');
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
  });

  // Without a verbatim CodexBar message, the exact check's generic detail is
  // still honest guidance and the app offers no invented provider destination.
  it("uses the generic provider detail when CodexBar reported no text", () => {
    for (const health of ["auth_required", "setup_required"]) {
      const html = render({
        detail: "This provider needs an active sign-in.",
        health,
      });

      expect(html).toContain("This provider needs an active sign-in.");
      expect(html).toContain('aria-label="Check Claude Code again"');
      expect(html).not.toContain('aria-label="Open CodexBar"');
      expect(html).not.toContain("Copy provider message");
      expect(html).not.toContain("lucide-external-link");
      expect(html.match(/data-slot="button"/g)).toHaveLength(1);
    }
  });

  // CodexBar owns provider guidance. The row repeats its answer exactly and
  // offers only Copy and Retry without guessing where this provider signs in.
  it("shows CodexBar's reported message with only Copy and Retry", () => {
    const html = render({
      health: "auth_required",
      reportedMessage:
        "Codex connection failed: codex account authentication required to read rate limits",
    });

    expect(html).toContain(
      "Codex connection failed: codex account authentication required to read rate limits",
    );
    expect(html).toContain(
      'aria-label="Copy provider message for Claude Code"',
    );
    expect(html).toContain('aria-label="Check Claude Code again"');
    expect(html).not.toContain('aria-label="Open CodexBar"');
    expect(html).not.toContain('aria-label="Sign in to Claude Code"');
    expect(html).not.toContain("lucide-external-link");
    expect(html.match(/data-slot="button"/g)).toHaveLength(2);
  });

  it("hands a missing permission to CodexBar without sniffing its text", () => {
    const html = render({ health: "permission_required" });

    expect(html).toContain("Allow access in macOS");
    expect(html).toContain('aria-label="Check Claude Code again"');
    expect(html).not.toContain('aria-label="Open CodexBar"');
    expect(html).not.toContain("Full Disk Access settings");
    expect(html.match(/data-slot="button"/g)).toHaveLength(1);
  });

  it("offers a re-check after a timed out check", () => {
    const html = render({ health: "timeout" });

    expect(html).toContain("Check timed out");
    expect(html).toContain("lucide-refresh-cw");
    expect(html).toContain('aria-label="Check Claude Code again"');
  });

  // Nothing else is left to offer for a state the design does not draw, and a
  // row with no control at all would strand the customer.
  it("offers a re-check for every state the design does not name", () => {
    for (const health of ["unavailable", "?"]) {
      expect(render({ health })).toContain("Check timed out");
    }
  });

  // Dimmed because it cannot be used right now, but not inert: the account can
  // gain usage, and the companion's own next action is to use the provider once
  // and check again. A customer whose only provider said this had nothing to
  // press -- Continue asks for a provider that is ready, and switching it off
  // leaves none.
  it("dims a provider whose account has no usage, and still lets it be checked", () => {
    const html = render({ health: "no_usage_available" });

    expect(html).toContain("No usage data on this account");
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).toContain('aria-label="Check Claude Code again"');
  });

  // "Try again later" with nothing to try again with is the same dead end.
  it("dims a provider in a service outage, and still lets it be checked", () => {
    const html = render({ health: "service_outage" });

    expect(html).toContain("Service outage — try again later");
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).toContain('aria-label="Check Claude Code again"');
  });

  it("says a check is running on those rows too", () => {
    for (const health of ["no_usage_available", "service_outage"] as const) {
      const html = render({ checking: true, health });

      expect(html).toContain("Checking");
      expect(html).not.toContain('aria-label="Check Claude Code again"');
    }
  });

  // The health decides what help to offer, never whether the provider may be
  // switched off. A provider the customer cannot switch off is one they cannot
  // keep off the display.
  it("always offers the switch, whatever the provider reports", () => {
    for (const health of [
      "auth_required",
      "setup_required",
      "permission_required",
      "timeout",
      "no_usage_available",
      "service_outage",
      "unavailable",
      "config_error",
      "engine_error",
    ]) {
      expect(render({ health })).toContain('role="switch"');
      expect(render({ health, enabled: false })).toContain(
        'aria-checked="false"',
      );
    }
  });

  // Pressing it again only enqueues a second probe of the same provider, so the
  // running request replaces the action until it answers.
  it("says a check is running instead of offering to start another", () => {
    const html = render({ checking: true, health: "unavailable" });

    expect(html).toContain("Checking");
    expect(html).not.toContain('aria-label="Check Claude Code again"');
    // Rule 3: whatever the provider reports, the switch stays.
    expect(html).toContain('role="switch"');
  });
  // A provider row must never stop the Companion. Engine recovery remains an
  // automatic app-level concern; this row can only ask CodexBar to check again.
  it("offers a re-check instead of a per-provider usage-service repair", () => {
    for (const health of ["config_error", "engine_error"] as const) {
      const html = render({ health });

      expect(html).toContain("Check timed out");
      expect(html).not.toContain("Repair the usage service");
      expect(html).toContain('aria-label="Check Claude Code again"');
      expect(html).toContain('role="switch"');
    }
  });
});
