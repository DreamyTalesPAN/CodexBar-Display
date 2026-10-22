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
import type { PreferenceHealthState, UsageSnapshot } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import {
  PROVIDER_LOADING_LOG_INTERVAL_MS,
  ProviderList,
  PROVIDER_SIGN_IN_FOLLOW_UP_WINDOW_MS,
  SIGN_IN_PROVIDER_IDS,
  SetupProvidersScreen,
  acknowledgedProviderIssues,
  forgetResolvedProviderIssues,
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

  it("shows one provider popup and keeps its dismissal across polls", () => {
    const onToggle = vi.fn();
    const failed = { ...copilot, value: true,
      health: { ...copilot.health, reported: "No available fetch strategy for copilot." } };
    const props = { usage, providers: [claude, failed], onToggle,
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
    rerender(<SetupProvidersScreen {...props} pendingCheckIds={new Set(["copilot"])} />);
    rerender(<SetupProvidersScreen {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "GitHub Copilot" }));
    expect(onToggle).toHaveBeenCalledWith(failed, false);
    rerender(<SetupProvidersScreen {...props} providers={[claude, { ...failed, value: false }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Paul, 16.10.: the popup carried a status line under the sentence ("No
  // usage reading yet."). The dialog says one sentence, and time passing
  // does not open it again.
  // Settings takes the list off the page whenever the customer leaves it.
  // Remembered in the list alone, an acknowledged message opened again on
  // every visit and took the click meant for another control.
  // Only the acknowledgement outlives the list. A switch pressed on one visit
  // must not let a stale message open by itself on a later one.
  it("does not open a stale message by itself on a later visit", () => {
    const off = provider({ providerId: "codex", label: "Codex", health: "disabled", value: false });
    const props = { usage, onToggle: vi.fn(),
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
  // Paul, 16.10. ("wieso hab ich hier so viele optionen?"): the popup showed
  // the engine's own text, a status line and a copy action. Every state says
  // one fixed sentence and ends on OK.
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

  // A signed-out provider the app cannot sign in says what the customer has
  // to do (its own app, installed and signed in) and offers the setup guide
  // as its signal action beside OK.
  it("tells a signed-out provider without a sign-in to use its own app", () => {
    const onOpenSetupGuide = vi.fn();
    const failed = { ...copilot, value: true,
      health: { ...copilot.health, reported: "No available fetch strategy for copilot." } };
    renderDom(<SetupProvidersScreen usage={usage} providers={[claude, failed]}
      onOpenSetupGuide={onOpenSetupGuide} onOpenSignIn={vi.fn()}
      onContinue={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(
      "GitHub Copilot needs a GitHub sign-in that VibeTV can't start yet.",
    )).toBeTruthy();
    expect(dialog.queryByText("No available fetch strategy for copilot.")).toBeNull();
    expect(dialog.queryByRole("button", { name: /Copy provider message/ })).toBeNull();
    expect(dialog.getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Close", "Open setup guide"]);
    fireEvent.click(dialog.getByRole("button", { name: "Open setup guide" }));
    expect(onOpenSetupGuide).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
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
    const props = { onContinue: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>(),
      providers: [claude, { ...copilot, value: true }],
    };
    const { rerender, container } = renderDom(<SetupProvidersScreen {...props} usage={null} />);
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
    rerender(<SetupProvidersScreen {...props} usage={usage} />);
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /Check .* again/ })).toBeNull();
  });

  it("continues once an enabled provider is ready", () => {
    const html = render({ providers: [claude, copilot] });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
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

  it("keeps Continue outside the provider list, which scrolls and fades at its bottom", () => {
    renderDom(
      <SetupProvidersScreen
        onContinue={vi.fn()}
        onToggle={vi.fn()}
        pendingCheckIds={new Set<string>()}
        pendingPreferenceIds={new Set<string>()}
        providers={[claude, copilot]}
        usage={usage}
      />,
    );
    const list = screen.getByText("Claude Code").closest(".overflow-y-auto");

    expect(list?.className).toMatch(/max-h-\[/);
    expect(list?.className).toContain("mask-image:");
    expect(list?.contains(screen.getByText("GitHub Copilot"))).toBe(true);
    expect(screen.getByRole("button", { name: "Continue" }).closest(".overflow-y-auto")).toBeNull();
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

  // The looks (states overview 644): a dialog opens by itself only for the
  // sign-in and access states, once, and closed stays closed.
  it("opens nothing by itself for a healthy, quiet or unsupported provider", () => {
    for (const health of ["healthy", "stale", "unavailable", "unsupported", "no_usage_available"] as const) {
      const { unmount } = renderDom(<SetupProvidersScreen usage={usage}
        providers={[provider({ providerId: "openai", label: "OpenAI", health, message: "Failure" })]}
        onContinue={vi.fn()} onToggle={vi.fn()}
        pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
      expect(screen.queryByRole("dialog")).toBeNull();
      unmount();
    }
  });

  it("a sign-in the app can start has its row button and no dialog by itself", () => {
    const onOpenSignIn = vi.fn();
    const claudeOut = provider({ providerId: "claude", label: "Claude", health: "auth_required" });
    renderDom(<SetupProvidersScreen usage={usage} providers={[claudeOut]} onOpenSignIn={onOpenSignIn}
      onContinue={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in needed for Claude" }));
    expect(onOpenSignIn).toHaveBeenCalledWith(claudeOut);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the access dialog by itself once, and it stays closed after OK", () => {
    const access = provider({ providerId: "gemini", label: "Gemini", health: "permission_required",
      message: "Allow access on this computer" });
    const props = { usage, providers: [access], onContinue: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const { rerender } = renderDom(<SetupProvidersScreen {...props} />);
    expect(within(screen.getByRole("dialog")).getByText("Allow access on this computer so VibeTV can read Gemini usage.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    rerender(<SetupProvidersScreen {...props} providers={[{ ...access }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the row's Allow access action opens the same dialog again", () => {
    const access = provider({ providerId: "gemini", label: "Gemini", health: "permission_required" });
    renderDom(<SetupProvidersScreen usage={usage} providers={[access]} onContinue={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow access for Gemini" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows one dialog at a time for two access needs", () => {
    const first = provider({ providerId: "gemini", label: "Gemini", health: "permission_required" });
    const second = provider({ providerId: "openai", label: "OpenAI", health: "permission_required" });
    renderDom(<SetupProvidersScreen usage={usage} providers={[first, second]} onContinue={vi.fn()} onToggle={vi.fn()}
      pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(within(screen.getByRole("dialog")).getByText("OpenAI")).toBeTruthy();
  });


  it("a closed access message comes back once the provider was healthy again", () => {
    const access = provider({ providerId: "gemini", label: "Gemini", health: "permission_required",
      message: "Allow access on this computer" });
    const healthy = provider({ providerId: "gemini", label: "Gemini", health: "healthy" });
    const props = { usage, onContinue: vi.fn(), onToggle: vi.fn(),
      pendingCheckIds: new Set<string>(), pendingPreferenceIds: new Set<string>() };
    const { rerender } = renderDom(<SetupProvidersScreen {...props} providers={[access]} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    // The cause is still there: the message stays closed.
    rerender(<SetupProvidersScreen {...props} providers={[{ ...access }]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Healthy again: the cause is gone, so its message is due once it comes back.
    rerender(<SetupProvidersScreen {...props} providers={[healthy]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<SetupProvidersScreen {...props} providers={[access]} />);
    expect(within(screen.getByRole("dialog")).getByText("Allow access on this computer so VibeTV can read Gemini usage.")).toBeTruthy();
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

it("forgets the closed message of a provider that is healthy or off, even unmounted", () => {
  acknowledgedProviderIssues.set("codexbar.providers.gemini.enabled", "Allow access on this computer so VibeTV can read Gemini usage.");
  acknowledgedProviderIssues.set("codexbar.providers.openai.enabled", "Allow access on this computer so VibeTV can read OpenAI usage.");
  forgetResolvedProviderIssues([
    provider({ providerId: "gemini", label: "Gemini", health: "healthy" }),
    provider({ providerId: "openai", label: "OpenAI", health: "permission_required", value: false }),
  ]);
  expect(acknowledgedProviderIssues.has("codexbar.providers.gemini.enabled")).toBe(false);
  expect(acknowledgedProviderIssues.has("codexbar.providers.openai.enabled")).toBe(false);
});
