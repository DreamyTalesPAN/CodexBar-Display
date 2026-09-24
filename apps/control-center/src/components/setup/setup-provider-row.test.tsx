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

  // Windows can start a provider's sign-in; the Mac app cannot, and its rows
  // must stay as they are. The button therefore follows the shell action, not
  // the health alone, and never replaces the popup opener or the re-check.
  it("offers to start the sign-in only when the shell can start one", () => {
    for (const health of ["auth_required", "setup_required"]) {
      const html = render({ health, onOpenSignIn: vi.fn() });
      expect(html).toContain("Sign in to Claude Code");
      expect(html).toContain("lucide-log-in");
      expect(html).toContain('aria-label="Show provider message for Claude Code"');
      expect(html).toContain('aria-label="Check Claude Code again"');
    }
    expect(render({ health: "auth_required" })).not.toContain("lucide-log-in");
  });

  // Claude on Windows is signed in to the tool, but its usage endpoint only
  // answers a browser session, so this row opens that page instead.
  it("offers the browser sign-in page when the provider needs a browser session", () => {
    const html = render({
      health: "browser_sign_in_required",
      onOpenSignIn: vi.fn(),
    });
    expect(html).toContain("lucide-external-link");
    expect(html).toContain('aria-label="Open Claude Code sign-in in your browser"');
    expect(html).toContain('aria-label="Check Claude Code again"');
    expect(html).toContain('role="switch"');
    expect(render({ health: "browser_sign_in_required" })).not.toContain(
      "lucide-external-link",
    );
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

  it("names an engine that is too old instead of a timed-out check", () => {
    expect(setupProviderIssueMessage({ health: "engine_incompatible", label: "Codex" })).toBe(
      "The usage engine is too old. Repair the usage engine, then check again.",
    );
    expect(render({ health: "engine_incompatible" })).toContain('aria-label="Check Claude Code again"');
  });

  it("keeps the engine's product name out of provider messages", () => {
    expect(setupProviderIssueMessage({ health: "engine_incompatible", label: "Codex",
      detail: "CodexBar 0.17.0 is too old. Version 0.23.0 or newer is required." })).toBe(
      "Usage engine 0.17.0 is too old. Version 0.23.0 or newer is required.",
    );
  });
});
