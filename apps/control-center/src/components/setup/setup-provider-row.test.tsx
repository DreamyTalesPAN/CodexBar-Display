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
    "no_usage_available", "service_outage", "unavailable", "config_error", "engine_error", "stale",
    "unsupported"])(
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
    ["unsupported", "This provider no longer supports this account"],
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

// Google ended Gemini CLI OAuth for consumer accounts. The stored credential
// is still valid, so a sign-in button or a re-check would only repeat the
// same refusal; the row must carry the provider's migration path instead.
describe("a provider the account lost access to", () => {
  const reportedMessage =
    "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh.";

  it("shows the migration message and no sign-in or re-check loop", () => {
    const html = render({
      health: "unsupported",
      label: "Gemini",
      onOpenSignIn: vi.fn(),
    });
    expect(html).toContain('aria-label="Show provider message for Gemini"');
    // The two actions that cannot resolve it must not be offered.
    expect(html).not.toContain("Sign in to Gemini");
    expect(html).not.toContain('aria-label="Check Gemini again"');
    // Switching it off is how the customer moves on, so it stays available.
    expect(html).toContain('role="switch"');
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("passes the upstream migration guidance through unchanged", () => {
    expect(
      setupProviderIssueMessage({
        health: "unsupported",
        label: "Gemini",
        detail: "Gemini no longer supports this account.",
        reportedMessage,
      }),
    ).toBe(reportedMessage);
  });
});
