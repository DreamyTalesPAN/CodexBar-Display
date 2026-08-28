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

  it("disables the switch while the provider is being checked", () => {
    const html = render({ health: "checking" });

    expect(html).toContain("lucide-loader-circle");
    expect(html).toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("offers sign-in for a provider that has none", () => {
    for (const health of ["auth_required", "setup_required"]) {
      const html = render({ health });

      expect(html).toContain("Sign in to Claude Code");
      expect(html).toContain("lucide-chevron-right");
      expect(html).not.toContain('role="switch"');
    }
  });

  it("waits without a second button once sign-in was pressed", () => {
    const html = render({ health: "auth_required", signingIn: true });

    expect(html).toContain("Waiting for sign-in…");
    expect(html).toContain("lucide-loader-circle");
    expect(html).not.toContain("<button");
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
  // row with no control at all would strand the customer.
  it("offers a re-check for every state the design does not name", () => {
    for (const health of ["unavailable", "config_error", "engine_error", "?"]) {
      expect(render({ health })).toContain("Check timed out");
    }
  });

  it("dims a provider whose account has no usage and offers no control", () => {
    const html = render({ health: "no_usage_available" });

    expect(html).toContain("No usage data on this account");
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).not.toContain("<button");
  });

  it("dims a provider in a service outage and offers no control", () => {
    const html = render({ health: "service_outage" });

    expect(html).toContain("Service outage — try again later");
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).not.toContain("<button");
  });
});
