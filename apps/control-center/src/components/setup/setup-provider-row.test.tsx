import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupProviderRow, setupProviderIssueMessage } from "./setup-provider-row";

function render(props: Partial<Parameters<typeof SetupProviderRow>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupProviderRow enabled health="healthy" label="Claude Code"
      onCheckAgain={vi.fn()} onToggle={vi.fn()} onShowIssue={vi.fn()} {...props} />,
  );
}

describe("SetupProviderRow", () => {
  it("shows ready and disabled providers without an error action", () => {
    expect(render()).toContain('aria-checked="true"');
    const off = render({ enabled: false, health: "auth_required" });
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain("Show provider message");
  });

  it.each(["checking", "auth_required", "setup_required", "permission_required", "timeout",
    "no_usage_available", "service_outage", "unavailable", "config_error", "engine_error", "stale"])(
    "keeps the switch usable for %s", (health) => {
      const html = render({ health });
      expect(html).toContain('role="switch"');
      expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
    },
  );

  it("keeps error text in the popup and offers its opener plus retry", () => {
    const html = render({ health: "auth_required" });
    expect(html).toContain('aria-label="Show provider message for Claude Code"');
    expect(html).toContain('aria-label="Check Claude Code again"');
    expect(html).not.toContain("Sign in to Claude Code");
    expect(html).not.toContain("Open CodexBar");
  });

  it("replaces retry with a spinner while the exact check runs", () => {
    for (const health of ["checking", "unavailable", "no_usage_available", "service_outage"]) {
      const html = render({ checking: true, health });
      expect(html).toContain("lucide-loader-circle");
      expect(html).not.toContain('aria-label="Check Claude Code again"');
    }
  });

  it("retains the bounded stale-reading presentation and switch", () => {
    const html = render({ health: "stale" });
    expect(html).toContain('aria-label="Show provider message for Claude Code"');
    expect(html).not.toContain('aria-label="Check Claude Code again"');
  });

  it.each(["no_usage_available", "service_outage"])("dims unusable %s without disabling it", (health) => {
    const html = render({ health });
    expect(html).toMatch(/data-slot="item-title"[^>]*opacity-50/);
    expect(html).toContain('aria-label="Check Claude Code again"');
  });
});

describe("provider popup guidance", () => {
  it("preserves the exact reported message before generic detail", () => {
    const reportedMessage = "Codex connection failed: account authentication required to read rate limits";
    expect(setupProviderIssueMessage({ health: "auth_required", label: "Codex",
      detail: "Sign in required", reportedMessage })).toBe(reportedMessage);
    expect(setupProviderIssueMessage({ health: "auth_required", label: "Codex",
      detail: "This provider needs an active sign-in." })).toBe("This provider needs an active sign-in.");
  });

  it.each([
    ["auth_required", "Sign in to Claude Code"],
    ["permission_required", "Allow access in macOS"],
    ["no_usage_available", "No usage data on this account"],
    ["service_outage", "Service outage — try again later"],
    ["stale", "Live usage is unavailable"],
    ["timeout", "Check timed out"],
    ["config_error", "Check timed out"],
    ["engine_error", "Check timed out"],
    ["?", "Check timed out"],
  ])("retains the existing generic guidance for %s", (health, message) => {
    expect(setupProviderIssueMessage({ health, label: "Claude Code" })).toBe(message);
  });

  it.each(["healthy", "checking", "disabled"])("does not turn %s into an error", (health) => {
    expect(setupProviderIssueMessage({ health, label: "Codex" })).toBeNull();
  });
});

 it("shows a terminal upstream explanation without a sign-in or retry action", () => {
   const html = render({health: "unsupported", reportedMessage: "Google no longer supports Gemini CLI OAuth. Enable Antigravity.", label: "Gemini"});
   expect(html).toContain("Google no longer supports Gemini CLI OAuth. Enable Antigravity.");
   expect(html).toContain('aria-label="Copy provider message for Gemini"');
   expect(html).not.toContain('aria-label="Check Gemini again"');
   expect(html).toContain('role="switch"');
 });
