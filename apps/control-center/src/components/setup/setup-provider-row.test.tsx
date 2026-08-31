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
      onRecover={vi.fn()}
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
    for (const health of ["stale", "disabled"]) {
      expect(render({ health })).toContain('role="switch"');
    }
  });

  // A check that is slow or stuck must not hold the customer on the step: the
  // switch is the way past it, and the running check keeps its spinner.
  it("keeps the switch usable while the provider is being checked", () => {
    const html = render({ health: "checking" });

    expect(html).toContain("lucide-loader-circle");
    expect(html).toContain('role="switch"');
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("offers sign-in for a provider that has none", () => {
    for (const health of ["auth_required", "setup_required"]) {
      const html = render({ health });

      expect(html).toContain("Sign in to Claude Code");
      expect(html).toContain("lucide-chevron-right");
    }
  });

  it("waits without a second action once sign-in was pressed", () => {
    const html = render({ health: "auth_required", signingIn: true });

    expect(html).toContain("Waiting for sign-in…");
    expect(html).toContain("lucide-loader-circle");
    expect(html).not.toContain('data-slot="button"');
  });

  it("sends the customer to macOS for a missing permission", () => {
    const html = render({ health: "permission_required" });

    expect(html).toContain("Allow access in macOS");
    expect(html).toContain("lucide-chevron-right");
  });

  it("offers a re-check after a timed out check", () => {
    const html = render({ health: "timeout" });

    expect(html).toContain("Check timed out");
    expect(html).toContain("lucide-refresh-cw");
    expect(html).toContain('aria-label="Check Claude Code again"');
  });

  // Nothing else is left to offer for a state the design does not draw, and a
  // row with no control at all would strand the customer. Not for a broken
  // usage service, though: another check meets the same broken service, and
  // the companion says what does help -- see the repair case below.
  it("offers a re-check for every state the design does not name", () => {
    for (const health of ["unavailable", "?"]) {
      expect(render({ health })).toContain("Check timed out");
    }
  });

  it("dims a provider whose account has no usage and offers no recovery", () => {
    const html = render({ health: "no_usage_available" });

    expect(html).toContain("No usage data on this account");
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).not.toContain('data-slot="button"');
  });

  it("dims a provider in a service outage and offers no recovery", () => {
    const html = render({ health: "service_outage" });

    expect(html).toContain("Service outage — try again later");
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).not.toContain('data-slot="button"');
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

  // Pressing it again only enqueues a second probe of the same provider, and
  // the first answer clears the pending mark while the rest are still running
  // -- reopening a Continue whose gate is not satisfied, and repeating the
  // sign-in work behind the check.
  it("says a check is running instead of offering to start another", () => {
    const html = render({ checking: true, health: "unavailable" });

    expect(html).toContain("Checking");
    expect(html).not.toContain('aria-label="Check Claude Code again"');
    // Rule 3: whatever the provider reports, the switch stays.
    expect(html).toContain('role="switch"');
  });


  // Checking again meets the same broken service, so the row said "Check timed
  // out" and offered the one action that cannot work. A customer whose only
  // provider was in that state could not finish setup at all: Continue asks for
  // a provider that is ready, and switching it off leaves none.
  it("offers the repair when the usage service is what is broken", () => {
    for (const health of ["config_error", "engine_error"] as const) {
      const onRecover = vi.fn();
      const html = render({ health, onRecover });

      expect(html).toContain("Repair the usage service");
      expect(html).not.toContain("Check timed out");
      expect(html).toContain(
        'aria-label="Repair the usage service for Claude Code"',
      );
      expect(html).toContain('role="switch"');
    }
  });

});
