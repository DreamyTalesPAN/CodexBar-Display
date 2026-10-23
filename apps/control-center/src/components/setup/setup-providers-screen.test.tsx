// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  within,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import sharedSetupSentences from "./provider-setup-sentences.json";
import type { PreferenceHealthState, UsageSnapshot } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import {
  PROVIDER_LOADING_LOG_INTERVAL_MS,
  ProviderList,
  PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS,
  SIGN_IN_PROVIDER_IDS,
  SetupProvidersScreen,
  acknowledgedProviderIssues,
  setupProviderCanDisplay,
  setupProviderMatchesQuery,
  setupProviderDialogSentence,
  setupProviderOffersSignIn,
  setupProvidersCanContinue,
} from "./setup-providers-screen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  acknowledgedProviderIssues.clear();
});

function provider(fields: {
  health: PreferenceHealthState;
  label: string;
  message?: string;
  providerId: string;
  value?: boolean;
}): ProviderItem {
  const value = fields.value ?? true;
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: value,
    health: {
      message: fields.message || "",
      service: "operational",
      state: fields.health,
    },
    id: `codexbar.providers.${fields.providerId}.enabled`,
    label: fields.label,
    owner: "codexbar",
    providerId: fields.providerId,
    section: "providers",
    type: "boolean",
    value,
    writable: true,
    writeStrategy: "codexbar_command",
  };
}

const claude = provider({
  health: "healthy",
  label: "Claude Code",
  message: "Ready.",
  providerId: "claude",
});
const copilot = provider({
  health: "auth_required",
  label: "GitHub Copilot",
  message: "Sign in required.",
  providerId: "copilot",
  value: false,
});

const usage: UsageSnapshot = {
  providers: ["claude", "codex"].map((id) => ({
    id, label: id, session: 0, weekly: 0, resetSecs: 0, usageMode: "used",
    sessionUnavailable: true, weeklyUnavailable: true,
    windows: [{ id: "weekly", label: "Weekly", usedPercent: 0 }],
  })),
};

function render(
  props: Partial<Parameters<typeof SetupProvidersScreen>[0]> = {},
) {
  return renderToStaticMarkup(
    <SetupProvidersScreen
      onCheckAgain={vi.fn()}
      onContinue={vi.fn()}
      onToggle={vi.fn()}
      pendingCheckIds={new Set<string>()}
      pendingPreferenceIds={new Set<string>()}
      usage={usage}
      providers={[claude, copilot]}
      {...props}
    />,
  );
}

describe("SetupProvidersScreen", () => {
  it("names the included usage service and where provider access is granted", () => {
    const html = render();
    expect(html).toContain("VibeTV reads your AI usage with CodexBar, a helper app installed with VibeTV.");
    expect(html).toContain("Turn on the providers you use below.</p>");
    expect(html).not.toContain("If one needs a sign-in");
  });

  it("leads a signed-out row to its sign-in button instead of a popup", () => {
    // Bench Mac, 09.10.: "Check again" on signed-out Claude opened its
    // provider message with a copy action on top of "Sign in to Claude", and
    // a second one popped up while the sign-in was already recovering.
    vi.useFakeTimers();
    const failed = provider({ providerId: "claude", label: "Claude", health: "auth_required",
      message: "Sign in to claude.ai (or refresh Claude cookies) to load usage data." });
    const signedOut = { ...failed, health: { ...failed.health, reported: failed.health.message } };
    const onOpenSignIn = vi.fn();
    const onCheckAgain = vi.fn();
    const props = { usage, providers: [signedOut], onOpenSignIn, onCheckAgain,
      onToggle: vi.fn(), onContinue: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const { rerender } = renderDom(<SetupProvidersScreen {...props} />);
    // The row is one sign-in action beside its switch, including while
    // background checks are running.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("switch", { name: "Claude" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check Claude again" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show provider message for Claude" })).toBeNull();
    rerender(<SetupProvidersScreen {...props} pendingCheckIds={new Set(["claude"])} />);
    expect(screen.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy();
    rerender(<SetupProvidersScreen {...props} providers={[{ ...signedOut }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const changed = { ...signedOut, health: { ...signedOut.health, reported: "A new sign-in failure." } };
    rerender(<SetupProvidersScreen {...props} providers={[changed]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
    expect(onOpenSignIn).toHaveBeenCalledWith(changed);
    expect(screen.queryByRole("dialog")).toBeNull();
    // 3. While the sign-in recovers, the row passes through "stale" as the
    // usage service restarts; even "Check again" opens nothing.
    const recovering = provider({ providerId: "claude", label: "Claude", health: "stale",
      message: "Live usage is unavailable; the last successful reading is still saved." });
    rerender(<SetupProvidersScreen {...props} providers={[recovering]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show provider message for Claude" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    rerender(<SetupProvidersScreen {...props} providers={[{ ...recovering, health: { ...recovering.health, state: "unavailable" } }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Check Claude again" }));
    rerender(<SetupProvidersScreen {...props} providers={[{ ...recovering, health: { ...recovering.health, state: "unavailable", message: "Still failing." } }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // After the three minutes a failing check reports again, as before.
    act(() => { vi.advanceTimersByTime(PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS); });
    fireEvent.click(screen.getByRole("button", { name: "Check Claude again" }));
    rerender(<SetupProvidersScreen {...props} providers={[{ ...recovering, health: { ...recovering.health, state: "unavailable", message: "Failing after the window." } }]} />);
    expect(within(screen.getByRole("dialog")).getByText(
      "VibeTV could not read Claude usage right now and tries again by itself.",
    )).toBeTruthy();
    rerender(<SetupProvidersScreen {...props} providers={[{ ...claude, label: "Claude" }]} />);
    expect(screen.getByRole("switch", { name: "Claude" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in to Claude" })).toBeNull();
  });

  // The Mac app could not read the claude.ai sign-in from the browser (#965):
  // "Sign in to Claude" only opened the same browser again and the row stayed
  // there. After the sign-in window the popup names the next step.
  it("names the next step on the Mac when Claude still asks for a sign-in after the window (#965)", () => {
    vi.useFakeTimers();
    const userAgent = vi.spyOn(window.navigator, "userAgent", "get")
      .mockReturnValue("VibeTVControlCenter/1.0.66+1");
    const platform = vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    const sentence = "VibeTV could not read your Claude sign-in from the browser. Sign in to Claude Code on this Mac, or sign in to claude.ai in Firefox, then check again. Using Chrome? Allow VibeTV Control Center under System Settings > Privacy & Security > Files & Folders > Google Chrome.";
    const signedOut = provider({ providerId: "claude", label: "Claude", health: "auth_required",
      message: "Sign in to Claude so VibeTV can read its usage." });
    const onOpenSignIn = vi.fn();
    const onCheckAgain = vi.fn();
    const props = { usage, providers: [signedOut], onOpenSignIn, onCheckAgain,
      onToggle: vi.fn(), onContinue: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    try {
      renderDom(<SetupProvidersScreen {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
      act(() => { vi.advanceTimersByTime(PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS - 1); });
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(sentence)).toBeTruthy();
      expect(within(dialog).queryByRole("button", { name: "Sign in to Claude" })).toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: "Check again" }));
      expect(onCheckAgain).toHaveBeenCalledWith(signedOut);
      expect(screen.queryByRole("dialog")).toBeNull();
      // Dismissed, it stays closed; a new sign-in that fails again opens it again.
      fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => { vi.advanceTimersByTime(PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS); });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Not now" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      userAgent.mockRestore();
      platform.mockRestore();
    }
  });

  it("keeps the plain sign-in row outside the Mac app after the window (#965)", () => {
    vi.useFakeTimers();
    const signedOut = provider({ providerId: "claude", label: "Claude", health: "auth_required",
      message: "Sign in to Claude so VibeTV can read its usage." });
    renderDom(<SetupProvidersScreen usage={usage} providers={[signedOut]} onOpenSignIn={vi.fn()}
      onCheckAgain={vi.fn()} onToggle={vi.fn()} onContinue={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
    act(() => { vi.advanceTimersByTime(PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy();
  });

  it("shows one provider popup, keeps dismissal across polls, and reopens after retry", () => {
    const onCheckAgain = vi.fn();
    const onToggle = vi.fn();
    const failed = { ...copilot, value: true,
      health: { ...copilot.health, reported: "No available fetch strategy for copilot." } };
    const props = { usage, providers: [claude, failed], onCheckAgain, onToggle,
      onContinue: vi.fn(), pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const { rerender } = renderDom(<SetupProvidersScreen {...props} />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).getByText(
      "GitHub Copilot needs a GitHub sign-in that VibeTV can't start yet.",
    )).toBeTruthy();
    expect(screen.queryByText(failed.health.reported)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    rerender(<SetupProvidersScreen {...props} providers={[{ ...claude }, { ...failed }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(failed.health.reported)).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Check GitHub Copilot again" }));
    expect(onCheckAgain).toHaveBeenCalledWith(failed);
    rerender(<SetupProvidersScreen {...props} pendingCheckIds={new Set(["copilot"])} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<SetupProvidersScreen {...props} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("switch", { name: "GitHub Copilot" }));
    expect(onToggle).toHaveBeenCalledWith(failed, false);
    rerender(<SetupProvidersScreen {...props} providers={[claude, { ...failed, value: false }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open a stale provider's message by itself, only from its warning icon", () => {
    // Right after the runtime restarts, every enabled provider is stale until
    // CodexBar answers again. That recovers by itself and needs no click.
    const stale = provider({ providerId: "codex", label: "Codex", health: "stale",
      message: "Live usage is unavailable; the last successful reading is still saved." });
    renderDom(<SetupProvidersScreen usage={usage} providers={[stale, claude]}
      onContinue={vi.fn()} onCheckAgain={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show provider message for Codex" }));
    expect(within(screen.getByRole("dialog")).getByText(
      "VibeTV shows the last Codex reading until a new one arrives.",
    )).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Paul, 16.10.: the popup carried a status line under the sentence ("No
  // usage reading yet."). The dialog says one sentence, and time passing
  // does not open it again.
  it("shows no reading line beside the sentence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T09:43:00Z"));
    const props = { usage, onContinue: vi.fn(), onCheckAgain: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const failing = provider({ providerId: "codex", label: "Codex", health: "auth_required",
      message: "Sign in required." });
    const since = (item: ProviderItem, noReadingSince: string): ProviderItem =>
      ({ ...item, health: { ...item.health, noReadingSince } });

    const { rerender } = renderDom(<SetupProvidersScreen {...props}
      providers={[since(failing, "2026-07-28T08:29:00Z")]} />);
    expect(screen.getByRole("dialog").textContent).not.toContain("No usage reading");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    vi.setSystemTime(new Date("2026-08-14T09:43:00Z"));
    rerender(<SetupProvidersScreen {...props} providers={[since(failing, "2026-07-28T08:29:00Z")]} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show provider message for Codex" }));
    rerender(<SetupProvidersScreen {...props} providers={[failing]} />);
    expect(screen.getByRole("dialog").textContent).not.toContain("No usage reading");
  });

  // Settings takes the list off the page whenever the customer leaves it.
  // Remembered in the list alone, an acknowledged message opened again on
  // every visit and took the click meant for another control.
  it("keeps an acknowledged message closed when the list is shown again", () => {
    const signedOut = provider({ providerId: "codex", label: "Codex",
      health: "auth_required", message: "Authentication required." });
    const props = { usage, onCheckAgain: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const setup = renderDom(<SetupProvidersScreen {...props} onContinue={vi.fn()}
      providers={[signedOut, claude]} />);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    setup.unmount();

    // Settings shows this same list.
    const settings = renderDom(<ProviderList {...props} providers={[{ ...signedOut }, claude]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The row still carries the message, and asking for it shows it.
    fireEvent.click(screen.getByRole("button", { name: "Show provider message for Codex" }));
    expect(within(screen.getByRole("dialog")).getByText(
      "Sign in to Codex so VibeTV can read its usage.",
    )).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    settings.unmount();

    // A different problem is new to the customer.
    const timedOut = provider({ providerId: "codex", label: "Codex",
      health: "timeout", message: "The provider check timed out." });
    renderDom(<ProviderList {...props} providers={[timedOut, claude]} />);
    expect(within(screen.getByRole("dialog")).getByText(
      "Codex did not answer in time, and VibeTV tries again by itself.",
    )).toBeTruthy();
  });

  // Only the acknowledgement outlives the list. A switch pressed on one visit
  // must not let a stale message open by itself on a later one.
  it("does not open a stale message by itself on a later visit", () => {
    const off = provider({ providerId: "codex", label: "Codex", health: "disabled", value: false });
    const props = { usage, onCheckAgain: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const first = renderDom(<ProviderList {...props} providers={[off, claude]} />);
    fireEvent.click(screen.getByRole("switch", { name: "Codex" }));
    first.unmount();

    const stale = provider({ providerId: "codex", label: "Codex", health: "stale",
      message: "Live usage is unavailable; the last successful reading is still saved." });
    renderDom(<ProviderList {...props} providers={[stale, claude]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Windows, Claude delivering usage, Codex just switched on: one throttled
  // check made the usage engine ask for a browser sign-in, and its list of
  // failed sources opened by itself under the title "Claude". The Mac App now
  // keeps that row healthy and sends no engine sentence for a browser sign-in.
  it("opens nothing for a healthy provider and shows no engine text for a browser sign-in", () => {
    const summary = "Claude usage failed from all configured sources. Web: No cookies available for web API; OAuth: OAuth error: Claude OAuth usage endpoint is rate limited. Retrying in about 1s; credentials were preserved.; CLI: Claude CLI /usage opened, but this Claude version returned local activity stats instead of plan limit percentages. Use Auto, OAuth, or Web mode for Claude limits. [claude:browser-sign-in-required https://claude.ai/login]";
    const engineText = /OAuth|cookies|https:\/\/|\[claude:/;
    const codex = provider({ providerId: "codex", label: "Codex", health: "checking" });
    const props = { usage, onOpenSignIn: vi.fn(), onContinue: vi.fn(), onCheckAgain: vi.fn(),
      onToggle: vi.fn(), pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    // A healthy row has nothing to say, whatever an earlier check left on it.
    const { rerender } = renderDom(<SetupProvidersScreen {...props}
      providers={[codex, { ...claude, health: { ...claude.health, reported: summary } }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show provider message for Claude Code" })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(engineText);

    // A provider that really needs the browser session offers the sign-in on
    // its row. Since #590 a sign-in row opens no popup of its own: the button
    // is the one thing to do, and the engine's summary stays out of the page.
    const message = "Claude usage needs a signed-in claude.ai session in your browser. Sign in to claude.ai in your browser, close the browser, then check again.";
    const signIn = provider({ providerId: "claude", label: "Claude Code", health: "browser_sign_in_required", message });
    rerender(<SetupProvidersScreen {...props} providers={[codex, { ...signIn,
      health: { ...signIn.health, signInUrl: "https://claude.ai/login", reported: summary } }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Sign in to Claude Code/ })).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(engineText);
  });

  // Paul, 16.10. ("wieso hab ich hier so viele optionen?"): the popup showed
  // the engine's own text, a status line and a copy action. Every state says
  // one fixed sentence and ends on OK.
  it("says one fixed sentence per state, without engine text or a copy action", () => {
    const engine = "No available fetch strategy for openai.";
    const cases: [PreferenceHealthState, string][] = [
      ["auth_required", "VibeTV can't read OpenAI until the OpenAI app is installed and running."],
      ["setup_required", "VibeTV can't read OpenAI until the OpenAI app is installed and running."],
      ["browser_sign_in_required", "Sign in to OpenAI in your browser, then close the browser."],
      ["permission_required", "Allow access on this computer so VibeTV can read OpenAI usage."],
      ["unsupported", "OpenAI no longer works with this account, so switch it off and use another provider."],
      ["no_usage_available", "This OpenAI account has no usage yet."],
      ["service_outage", "OpenAI has a service outage, and VibeTV tries again by itself."],
      ["stale", "VibeTV shows the last OpenAI reading until a new one arrives."],
      ["engine_incompatible", "The usage engine is too old and needs a repair."],
      ["rate_limited", "Nothing to fix: OpenAI is busy right now, and VibeTV tries again by itself."],
      ["timeout", "OpenAI did not answer in time, and VibeTV tries again by itself."],
      ["unavailable", "VibeTV could not read OpenAI usage right now and tries again by itself."],
      ["config_error", "VibeTV could not read OpenAI usage right now and tries again by itself."],
    ];
    for (const [state, sentence] of cases) {
      const item = provider({ providerId: "openai", label: "OpenAI", health: state, message: engine });
      const failed = { ...item, health: { ...item.health, reported: engine,
        nextAction: "Finish setup for this provider.", noReadingSince: undefined } };
      expect(setupProviderDialogSentence(failed)).toBe(sentence);
      const { unmount } = renderDom(<SetupProvidersScreen usage={usage} providers={[failed]}
        onContinue={vi.fn()} onCheckAgain={vi.fn()} onToggle={vi.fn()}
        pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
      if (state === "stale") {
        fireEvent.click(screen.getByRole("button", { name: "Show provider message for OpenAI" }));
      }
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(sentence)).toBeTruthy();
      expect(dialog.textContent).not.toMatch(/fetch strategy|No usage reading|Check again|check again/);
      expect(within(dialog).getAllByRole("button").map((button) => button.textContent))
        .toEqual(["OK"]);
      unmount();
    }
    for (const state of ["healthy", "checking", "disabled"]) {
      expect(setupProviderDialogSentence(provider({ providerId: "openai", label: "OpenAI", health: state }))).toBeNull();
    }
    // A provider whose sign-in the app starts says so, and its stale row with
    // a sign-in behind it says the same.
    const claudeOut = provider({ providerId: "claude", label: "Claude", health: "auth_required" });
    expect(setupProviderDialogSentence(claudeOut)).toBe("Sign in to Claude so VibeTV can read its usage.");
    expect(setupProviderDialogSentence({ ...claudeOut,
      health: { ...claudeOut.health, state: "stale", signInState: "auth_required" } }))
      .toBe("Sign in to Claude so VibeTV can read its usage.");
  });

  // The setup log reads the same fixture (companion/internal/codexbar,
  // provider_setup_sentences_test.go): one sentence per state on both sides.
  it("says the shared fixture sentence per state, as the setup log does", () => {
    for (const entry of sharedSetupSentences) {
      const item = provider({ providerId: entry.providerId, label: entry.label, health: entry.state });
      expect(setupProviderDialogSentence(item), entry.state).toBe(entry.sentence);
    }
  });

  it("offers the sign-in on a stale row whose live check waits for one", () => {
    // 09.10. on the Mac: Claude's saved cookie expired while an earlier
    // reading was still saved, and the stale row offered nothing to click.
    const stale = provider({ providerId: "claude", label: "Claude", health: "stale",
      message: "Live usage is unavailable; the last successful reading is still saved." });
    const signedOut = { ...stale, health: { ...stale.health, signInState: "auth_required" } };
    const onOpenSignIn = vi.fn();
    const onCheckAgain = vi.fn();
    const props = { usage, onContinue: vi.fn(), onCheckAgain, onOpenSignIn, onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const { rerender } = renderDom(<SetupProvidersScreen {...props} providers={[signedOut]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
    expect(onOpenSignIn).toHaveBeenCalledWith(signedOut);
    expect(screen.queryByRole("button", { name: "Check Claude again" })).toBeNull();
    // A stale row with no sign-in behind it recovers by itself.
    rerender(<SetupProvidersScreen {...props} providers={[stale]} />);
    expect(screen.queryByRole("button", { name: "Sign in to Claude" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check Claude again" })).toBeNull();
  });

  it("queues simultaneous provider failures and lets a dismissed message be opened again", () => {
    const second = provider({ providerId: "openai", label: "OpenAI", health: "unavailable", message: "Second failure" });
    renderDom(<SetupProvidersScreen usage={usage} providers={[{ ...copilot, value: true }, second]}
      onContinue={vi.fn()} onCheckAgain={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).getByText("GitHub Copilot needs a GitHub sign-in")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(within(screen.getByRole("dialog")).getByText("OpenAI")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show provider message for GitHub Copilot" }));
    expect(within(screen.getByRole("dialog")).getByText("GitHub Copilot needs a GitHub sign-in")).toBeTruthy();
  });

  // The Companion can start the sign-in of these four only; every other
  // provider is listed without a sign-in button.
  it("starts a sign-in only for Codex, Claude, Cursor and Antigravity", () => {
    expect(SIGN_IN_PROVIDER_IDS).toEqual([
      "codex",
      "claude",
      "cursor",
      "antigravity",
    ]);
  });

  // Copilot has no app of its own: CodexBar reads it with a GitHub sign-in,
  // so the sentence names that sign-in. Every other provider that has no
  // sign-in in the app keeps the own-app sentence (#591).
  it("names the GitHub sign-in for Copilot and keeps the own-app sentence for other providers", () => {
    // CodexBar 0.75.0 names the provider "Copilot" in its inventory.
    const copilotSignedOut = provider({ providerId: "copilot", label: "Copilot",
      health: "setup_required", message: "No available fetch strategy for copilot." });
    const openaiSignedOut = provider({ providerId: "openai", label: "OpenAI",
      health: "setup_required", message: "No available fetch strategy for openai." });
    expect(setupProviderDialogSentence(copilotSignedOut))
      .toBe("GitHub Copilot needs a GitHub sign-in that VibeTV can't start yet.");
    expect(setupProviderDialogSentence(openaiSignedOut)).toBe(
      "VibeTV can't read OpenAI until the OpenAI app is installed and running.",
    );
  });

  // A signed-out provider the app cannot sign in says what the customer has
  // to do and offers the setup guide as its signal action beside OK. Copilot
  // has no own app: its sentence names the GitHub sign-in (#591).
  it("tells a signed-out Copilot that its GitHub sign-in cannot start yet, and keeps the setup guide beside OK", () => {
    const onOpenSetupGuide = vi.fn();
    const failed = { ...copilot, value: true,
      health: { ...copilot.health, reported: "No available fetch strategy for copilot." } };
    renderDom(<SetupProvidersScreen usage={usage} providers={[claude, failed]}
      onOpenSetupGuide={onOpenSetupGuide} onOpenSignIn={vi.fn()}
      onContinue={vi.fn()} onCheckAgain={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(
      "GitHub Copilot needs a GitHub sign-in that VibeTV can't start yet.",
    )).toBeTruthy();
    expect(dialog.queryByText("No available fetch strategy for copilot.")).toBeNull();
    expect(dialog.queryByRole("button", { name: /Copy provider message/ })).toBeNull();
    expect(dialog.getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Close", "Open setup guide"]);
    // Frame 39 of the template: "<Provider> needs its own app", Close beside the guide.
    expect(dialog.getByRole("heading", { name: "GitHub Copilot needs a GitHub sign-in" })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Open setup guide" }));
    expect(onOpenSetupGuide).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the setup guide off for sign-in providers, other states and without a guide", () => {
    const claudeSignedOut = provider({ providerId: "claude", label: "Claude",
      health: "auth_required", message: "Sign in to Claude." });
    const timedOut = provider({ providerId: "copilot", label: "GitHub Copilot",
      health: "timeout", message: "The provider check timed out." });
    const signedOut = { ...copilot, value: true };
    for (const [item, guide, sentence, title] of [
      [claudeSignedOut, vi.fn(), "Sign in to Claude so VibeTV can read its usage.", "Claude"],
      // Only the own-app case is drawn in the template; the others keep the provider's name.
      [timedOut, vi.fn(), "GitHub Copilot did not answer in time, and VibeTV tries again by itself.", "GitHub Copilot"],
      [signedOut, undefined, "GitHub Copilot needs a GitHub sign-in that VibeTV can't start yet.", "GitHub Copilot needs a GitHub sign-in"],
    ] as const) {
      const { unmount } = renderDom(<SetupProvidersScreen usage={usage} providers={[item]}
        onOpenSetupGuide={guide} onContinue={vi.fn()} onCheckAgain={vi.fn()} onToggle={vi.fn()}
        pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText(sentence)).toBeTruthy();
      expect(dialog.getByRole("heading", { name: title })).toBeTruthy();
      expect(dialog.queryByRole("button", { name: "Open setup guide" })).toBeNull();
      unmount();
    }
  });

  // The sign-in action belongs to one of the four signed-out tools the
  // Companion can start, and to a browser sign-in with a page to open; a
  // healthy or timed-out row has none.
  it("offers the sign-in action only where a sign-in can be started", () => {
    expect(
      setupProviderOffersSignIn(
        provider({
          health: "auth_required",
          label: "Codex",
          providerId: "codex",
        }),
      ),
    ).toBe(true);
    expect(
      setupProviderOffersSignIn(
        provider({
          health: "setup_required",
          label: "Cursor",
          providerId: "cursor",
        }),
      ),
    ).toBe(true);
    expect(setupProviderOffersSignIn(claude)).toBe(false);
    expect(
      setupProviderOffersSignIn(
        provider({ health: "timeout", label: "Codex", providerId: "codex" }),
      ),
    ).toBe(false);
    // Only listed because the customer had switched it on: the Companion has
    // no sign-in it could start for this provider, so a button here would
    // only ever fail.
    expect(
      setupProviderOffersSignIn(
        provider({ health: "auth_required", label: "OpenAI", providerId: "openai" }),
      ),
    ).toBe(false);
    const browser = provider({
      health: "browser_sign_in_required",
      label: "OpenAI",
      providerId: "openai",
    });
    expect(setupProviderOffersSignIn(browser)).toBe(false);
    // A page CodexBar named itself works for any provider.
    expect(
      setupProviderOffersSignIn({
        providerId: browser.providerId,
        health: { ...browser.health, signInUrl: "https://claude.ai/login" },
      }),
    ).toBe(true);
  });

  it("shows the approved loading state until the provider list is ready", () => {
    const html = render({ loading: true, providers: [] });

    expect(html).toContain("This can take up to 5 minutes. We&#x27;re sorry.");
    expect(html).toContain("reading provider usage on this Mac");

    // Issue #438: Windows reads usage on this computer, not on a Mac.
    const windows = render({ loading: true, providers: [], windowsHost: true });
    expect(windows).toContain("reading provider usage on this computer");
    expect(windows).not.toContain("this Mac");
    expect(html).not.toContain("still checking, hang tight");
    expect(html).toMatch(
      /<input[^>]*disabled=""[^>]*placeholder="Search providers"/,
    );
    expect(html.match(/data-slot="skeleton"/g)).toHaveLength(6);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
    expect(html).not.toContain("No AI providers match your search.");
  });

  it("adds another still-checking line every twenty seconds", () => {
    vi.useFakeTimers();
    const props = {
      usage,
      loading: true,
      onCheckAgain: vi.fn(),
      onContinue: vi.fn(),
      onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(),
      pendingPreferenceIds: new Set<string>(),
      providers: [] as ProviderItem[],
    };
    const { rerender } = renderDom(<SetupProvidersScreen {...props} />);

    expect(screen.queryAllByText(/still checking, hang tight/)).toHaveLength(0);

    act(() => vi.advanceTimersByTime(PROVIDER_LOADING_LOG_INTERVAL_MS));
    expect(screen.getAllByText(/still checking, hang tight/)).toHaveLength(1);

    act(() => vi.advanceTimersByTime(PROVIDER_LOADING_LOG_INTERVAL_MS));
    expect(screen.getAllByText(/still checking, hang tight/)).toHaveLength(2);

    rerender(
      <SetupProvidersScreen {...props} loading={false} providers={[claude]} />,
    );
    act(() => vi.advanceTimersByTime(PROVIDER_LOADING_LOG_INTERVAL_MS));
    expect(screen.queryAllByText(/still checking, hang tight/)).toHaveLength(0);
    expect(screen.getByText("Claude Code")).toBeTruthy();
  });

  it("lists every provider it was given, with no collapse", () => {
    const html = render();

    expect(html).toContain("Choose AI providers");
    expect(html).toContain("Claude Code");
    expect(html).toContain("GitHub Copilot");
    expect(html).not.toContain("Show all");
  });

  it("cannot continue without a provider that is on and ready", () => {
    const html = render({
      providers: [
        copilot,
        provider({
          health: "healthy",
          label: "Cursor",
          providerId: "cursor",
          value: false,
        }),
      ],
    });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  it.each([
    null,
    { providers: [] },
    { providers: [{ ...usage.providers[0], usageUnavailable: true }] },
    { providers: [{ ...usage.providers[0], stale: true }] },
    { providers: [{ ...usage.providers[0], windows: [], totalTokens: 100 }] },
    { providers: [{ ...usage.providers[1] }] },
  ] as (UsageSnapshot | null)[])("waits for displayable usage from the enabled provider: %j", (reading) => {
    const html = render({ providers: [claude], usage: reading });
    expect(html).toContain('data-slot="spinner"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Claude Code"/);
  });

  it("removes the spinner when a 0% reading arrives without resets or token history", () => {
    const props = {
      onCheckAgain: vi.fn(), onContinue: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>(),
      providers: [claude, { ...copilot, value: true }],
    };
    const { rerender, container } = renderDom(<SetupProvidersScreen {...props} usage={null} />);
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
    rerender(<SetupProvidersScreen {...props} usage={usage} />);
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Check GitHub Copilot again" })).toBeTruthy();
  });

  it("continues once an enabled provider is ready", () => {
    const html = render({ providers: [claude, copilot] });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  it("continues on an enabled provider with a bounded last-good reading", () => {
    const html = render({
      providers: [
        provider({
          health: "stale",
          label: "Codex",
          message: "Live usage is unavailable. Showing the last saved reading.",
          providerId: "codex",
        }),
      ],
    });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
    expect(html).toContain('aria-label="Show provider message for Codex"');
    expect(html).not.toContain("Live usage is unavailable. Showing the last saved reading.");
  });

  // CodexBar ships 65 providers and almost all of them are off. Putting the
  // whole inventory on screen buried the customer's own two under a page of
  // names they have never heard of.
  it("shows ten providers and offers the rest", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      provider({
        health: "healthy",
        label: `Provider ${index}`,
        providerId: `p${index}`,
      }),
    );
    const html = render({ providers: many });

    expect(html).toContain("Provider 9");
    expect(html).not.toContain("Provider 10");
    expect(html).toContain("Show more providers (4 left)");
  });

  // Calm rule: a link is ink with an underline, like the other links in Settings.
  it("shows the more-providers control as an underlined link", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      provider({
        health: "healthy",
        label: `Provider ${index}`,
        providerId: `p${index}`,
      }),
    );
    const html = render({ providers: many });
    const control = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Show more providers/)?.[0] ?? "";
    const opening = control.slice(0, control.indexOf(">"));

    expect(opening).toContain("underline");
    expect(opening).toContain("font-normal");
    expect(opening).not.toContain("font-semibold");
  });

  it("does not offer more when everything already fits", () => {
    const html = render({ providers: [claude, copilot] });

    expect(html).not.toContain("Show more providers");
  });

  it("puts the common subscription tools first, then switched-on providers", () => {
    const offOpenAI = provider({
      health: "disabled",
      label: "OpenAI",
      providerId: "openai",
      value: false,
    });
    const onCodex = provider({
      health: "healthy",
      label: "Codex",
      providerId: "codex",
    });
    const offCursor = provider({
      health: "disabled",
      label: "Cursor",
      providerId: "cursor",
      value: false,
    });

    const offAzure = provider({
      health: "disabled",
      label: "Azure OpenAI",
      providerId: "azureopenai",
      value: false,
    });
    const providers = [offOpenAI, claude, offCursor, onCodex, offAzure];
    const html = render({ providers });
    const labels = ["Codex", "Claude Code", "Cursor", "OpenAI", "Azure OpenAI"];
    const positions = labels.map((label) => html.indexOf(`>${label}</`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right),
    );
  });

  // CodexBar switches providers on by itself, so a Mac whose own provider is
  // working can still carry a second one that is merely not signed in. Holding
  // the customer there closed the only step with no Back and no Skip, over a
  // provider the rotation would have skipped anyway.
  it("continues on one working provider, whatever the others report", () => {
    const html = render({
      providers: [
        claude,
        provider({
          health: "auth_required",
          label: "GitHub Copilot",
          message: "Sign in required.",
          providerId: "copilot",
        }),
      ],
    });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  // One is the floor, not zero: without a working provider VibeTV has nothing
  // real to put on the screen, and the companion refuses the completion.
  it("cannot continue while no provider that is on is ready", () => {
    const html = render({
      providers: [
        provider({
          health: "auth_required",
          label: "GitHub Copilot",
          message: "Sign in required.",
          providerId: "copilot",
        }),
      ],
    });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  // The row and the completion endpoint now share the same health descriptor.
  // A manually requested refresh may keep running without replacing that
  // authoritative healthy answer or holding the customer on this step.
  it("continues on a healthy provider while a manual check is running", () => {
    const html = render({
      pendingCheckIds: new Set(["claude"]),
      providers: [claude, copilot],
    });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
    // And the row keeps its switch throughout: docs/control-center-ui-principles
    // rule 3 does not let a check decide whether a provider may be turned off.
    expect(html).toContain('aria-label="Claude Code"');
  });

  // The switch shows the new value the moment it is pressed, so a second press
  // before the first write answers starts a race: two writes, and both the row
  // and what the companion saved end on whichever answer landed last rather
  // than on the customer's last press. Settings already closed its own switch
  // for this; the setup row was the one left open.
  it("closes a provider's switch while its own write is running", () => {
    const html = render({
      pendingPreferenceIds: new Set(["codexbar.providers.claude.enabled"]),
      providers: [claude, copilot],
    });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Claude Code"/,
    );
    // And only that one: the other row's switch is untouched.
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="GitHub Copilot"/,
    );
  });

  // Each completion forces a live provider read before it writes anything, so
  // a second press paid for the same slow check twice and either answer could
  // move the step or raise a refusal on its own.
  it("closes Continue while the completion is on its way", () => {
    const html = render({ continuing: true, providers: [claude, copilot] });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  it("closes Continue while a provider switch is still saving", () => {
    // Continue with one provider on skips Display Mode (#423). Deriving that
    // from a switch whose write can still be refused pinned VibeTV to the
    // wrong provider when the write rolled back.
    const html = render({
      pendingPreferenceIds: new Set([copilot.id]),
      providers: [claude, copilot],
    });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });
  // #627: Paul turned on Codex and Claude; Continue opened Display Mode while
  // Claude was still on its first reading, so Automatic could not rotate to it
  // and Manual did not offer it.
  it("waits for the first reading of every provider just switched on", () => {
    const closed = /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/;
    const cursor = provider({ health: "healthy", label: "Cursor", providerId: "cursor" });
    const warming = provider({ health: "checking", label: "Cursor", providerId: "cursor" });

    expect(render({ providers: [claude, cursor] })).toMatch(closed);
    expect(render({ providers: [claude, warming] })).toMatch(closed);
    expect(setupProvidersCanContinue([claude, cursor], usage)).toBe(false);

    const withCursor: UsageSnapshot = {
      providers: [...usage.providers, { ...usage.providers[0], id: "cursor", label: "Cursor" }],
    };
    expect(setupProvidersCanContinue([claude, cursor], withCursor)).toBe(true);

    // After a usage-service restart the row is checking while the reading
    // retained from before is stale: still waiting.
    const retained: UsageSnapshot = {
      providers: [...usage.providers, { ...usage.providers[0], id: "cursor", label: "Cursor",
        stale: true }],
    };
    expect(setupProvidersCanContinue([claude, warming], retained)).toBe(false);
    // Usage can arrive before the row turns healthy; Display Mode still leaves
    // a checking provider out, so Continue waits for the row as well.
    expect(setupProvidersCanContinue([claude, warming], withCursor)).toBe(false);
    expect(setupProvidersCanContinue([claude, { ...cursor }], retained)).toBe(false);
  });

  it("does not wait on a provider that has a definite answer", () => {
    // Signed out: the row says what to do, and the step is not held for it.
    const signedOut = { ...copilot, value: true };
    expect(setupProvidersCanContinue([claude, signedOut], usage)).toBe(true);
    // Off is off.
    const cursor = provider({ health: "healthy", label: "Cursor", providerId: "cursor" });
    expect(setupProvidersCanContinue([claude, { ...cursor, value: false }], usage)).toBe(true);
  });

  it("keeps Continue closed exactly while a switched-on row spins", () => {
    // A reading without percentages is also what the Companion reports before
    // the first real reading, so its row spins and Continue waits with it
    // (Codex review on #642).
    const closed = /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/;
    const cursor = provider({ health: "healthy", label: "Cursor", providerId: "cursor" });
    const empty: UsageSnapshot = {
      providers: [...usage.providers, { ...usage.providers[0], id: "cursor", label: "Cursor",
        usageUnavailable: true }],
    };
    const html = render({ providers: [claude, cursor], usage: empty });
    expect(html).toContain('data-slot="spinner"');
    expect(html).toMatch(closed);
    expect(setupProvidersCanContinue([claude, cursor], empty)).toBe(false);
    // Switching it off is the customer's way on.
    expect(setupProvidersCanContinue([claude, { ...cursor, value: false }], empty)).toBe(true);
  });

    it("finds a provider by label, by its message and by its id", () => {
    expect(setupProviderMatchesQuery(copilot, "github")).toBe(true);
    expect(setupProviderMatchesQuery(copilot, "sign in")).toBe(true);
    expect(setupProviderMatchesQuery(copilot, "copilot")).toBe(true);
    expect(setupProviderMatchesQuery(copilot, "claude")).toBe(false);
    expect(setupProviderMatchesQuery(copilot, "  ")).toBe(true);
  });

  it("keeps the Back and Help ways out of the step", () => {
    const html = render({ onBack: vi.fn() });

    expect(html).toContain("Back");
    expect(html).toContain("Help");
  });

  // A provider that cannot produce a reading must not reach the display step:
  // pinning VibeTV to it would leave the screen permanently blank.
  it("only lets providers that can show something onto the display step", () => {
    expect(setupProviderCanDisplay(claude, usage)).toBe(true);
    expect(
      setupProviderCanDisplay(
        provider({ health: "stale", label: "Codex", providerId: "codex" }),
        usage,
      ),
    ).toBe(true);
    expect(
      setupProviderCanDisplay(
        provider({
          health: "healthy",
          label: "Codex",
          providerId: "codex",
          value: false,
        }),
        usage,
      ),
    ).toBe(false);
    for (const health of [
      "auth_required",
      "setup_required",
      "permission_required",
      "timeout",
      "no_usage_available",
      "service_outage",
      "checking",
    ] as PreferenceHealthState[]) {
      expect(
        setupProviderCanDisplay(
          provider({ health, label: "Codex", providerId: "codex" }),
          usage,
        ),
      ).toBe(false);
    }
  });
});

describe("SetupProvidersScreen accessibility", () => {
  it("has no violations with the list, without a match, while loading and with a provider message open", async () => {
    await expectNoAxeViolations(render());
    await expectNoAxeViolations(render({ providers: [] }));
    await expectNoAxeViolations(render({ providers: [], loading: true }));
    const failed = { ...copilot, value: true,
      health: { ...copilot.health, reported: "No available fetch strategy for copilot." } };
    renderDom(
      <SetupProvidersScreen
        onCheckAgain={vi.fn()}
        onContinue={vi.fn()}
        onToggle={vi.fn()}
        pendingCheckIds={new Set<string>()}
        pendingPreferenceIds={new Set<string>()}
        providers={[claude, failed]}
        usage={usage}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    await expectNoAxeViolations(document.body.innerHTML);
  });
});
