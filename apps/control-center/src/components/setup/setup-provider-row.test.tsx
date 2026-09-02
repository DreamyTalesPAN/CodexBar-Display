import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupProviderRow } from "./setup-provider-row";

function render(props: Partial<Parameters<typeof SetupProviderRow>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupProviderRow
      enabled
      health="healthy"
      label="Claude Code"
      providerId="claude"
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

  // The control leads somewhere now. The usage service publishes no sign-in
  // destination in any released version, so the destination is ours, and it
  // leaves through the native side -- an ordinary link would navigate the
  // Control Center itself away into a website.
  it("offers sign-in for a provider that has none", () => {
    for (const health of ["auth_required", "setup_required"]) {
      const html = render({ health });

      expect(html).toContain("Sign in to Claude Code");
      expect(html).toContain('aria-label="Sign in to Claude Code"');
      expect(html).toContain("lucide-external-link");
    }
  });

  // "wir zeigen codexbar": where the usage service says something the customer
  // can act on, its sentence is what the row says.
  it("prefers what the usage service reported", () => {
    const html = render({
      health: "auth_required",
      reportedMessage:
        "No Ollama session cookie found. Please sign in at https://ollama.com/signin in your browser.",
      providerId: "ollama",
    });

    expect(html).toContain("Please sign in at https://ollama.com/signin");
    // The control keeps its name; it is the sentence that changes.
    expect(html).not.toContain(">Sign in to Claude Code</span>");
  });

  // A credential the provider's own CLI writes on disk: a browser login puts
  // nothing where the usage service looks, so the row hands over the command.
  it("copies the command for a provider that is not signed in through a browser", () => {
    const html = render({ health: "auth_required", providerId: "gemini" });

    expect(html).toContain('aria-label="Copy the Claude Code sign-in command"');
    expect(html).toContain("lucide-copy");
  });

  // The top blocker on a Mac whose customer is already signed in everywhere.
  // Sending them to a login page would be the second-most useless thing.
  it("sends a blocked cookie read to the macOS setting, not to a login page", () => {
    const html = render({
      health: "auth_required",
      providerId: "codex",
      reportedMessage:
        "Safari cookie file exists but is not readable (~/Library/Containers/com.apple.Safari/…). Enable Full Disk Access.",
    });

    expect(html).toContain('aria-label="Open Full Disk Access settings"');
    expect(html).not.toContain('aria-label="Sign in to Claude Code"');
  });

  // Where we do not know a destination, the row offers another check rather
  // than a control that leads nowhere.
  it("offers no destination it does not have", () => {
    const html = render({ health: "auth_required", providerId: "clawrouter" });

    expect(html).toContain('aria-label="Check Claude Code again"');
    expect(html).not.toContain("lucide-external-link");
  });

  it("waits without a second action once sign-in was pressed", () => {
    const html = render({ health: "auth_required", recovering: true });

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


  // The wait replaced the sign-in action but left the other two live, so every
  // press launched the recovery again and queued another check behind it.
  it("replaces every recovery action while its attempt runs", () => {
    const cases = [
      { health: "permission_required", waiting: "Waiting for access…" },
      { health: "config_error", waiting: "Repairing…" },
      { health: "auth_required", waiting: "Waiting for sign-in…" },
    ] as const;

    for (const { health, waiting } of cases) {
      const html = render({ health, recovering: true });

      expect(html).toContain(waiting);
      expect(html).toContain('data-slot="spinner"');
      expect(html).not.toContain('data-slot="button"');
      // Rule 3 again: the switch is not one of the things that goes away.
      expect(html).toContain('role="switch"');
    }
  });

});
