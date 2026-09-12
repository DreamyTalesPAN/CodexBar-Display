// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreferenceHealthState, UsageSnapshot } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import {
  PROVIDER_LOADING_LOG_INTERVAL_MS,
  SetupProvidersScreen,
  setupProviderCanDisplay,
  setupProviderMatchesQuery,
} from "./setup-providers-screen";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
  it("shows the approved loading state until the provider list is ready", () => {
    const html = render({ loading: true, providers: [] });

    expect(html).toContain("This can take up to 5 minutes. We&#x27;re sorry.");
    expect(html).toContain("reading provider usage on this Mac");
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
      usage: { providers: [{id: "codex", label: "Codex", session: 0, weekly: 0, usageMode: "used"}] },
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
    expect(html).toContain('data-slot="provider-notice"');
    expect(html).toContain("Live usage is unavailable. Showing the last saved reading.");
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

  it("does not offer more when everything already fits", () => {
    const html = render({ providers: [claude, copilot] });

    expect(html).not.toContain("Show more providers");
  });

  it("puts switched-on providers first without changing either group", () => {
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

    const providers = [offOpenAI, claude, offCursor, onCodex];
    const html = render({ providers });
    const labels = ["Claude Code", "Codex", "OpenAI", "Cursor"];
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

 describe("upstream provider migration", () => {
   const gemini = provider({health: "unsupported", label: "Gemini", providerId: "gemini"});
   gemini.health.reported = "Google no longer supports Gemini CLI OAuth for individual, AI Pro, or Ultra accounts. Enable CodexBar's Antigravity provider, sign in to Antigravity or run `agy`, then refresh.";
   const antigravity = provider({health: "disabled", label: "Antigravity", providerId: "antigravity", value: false});
   it("enables the replacement without hiding or disabling Gemini", () => {
     const onToggle = vi.fn();
     renderDom(<SetupProvidersScreen usage={usage} onCheckAgain={vi.fn()} onContinue={vi.fn()} onToggle={onToggle} pendingCheckIds={new Set()} pendingPreferenceIds={new Set()} providers={[gemini, antigravity]} />);
     expect((screen.getByRole("button", {name: "Continue"}) as HTMLButtonElement).disabled).toBe(true);
     expect(screen.getByText("Gemini no longer reports usage for personal Google accounts. You can turn on Antigravity instead.")).toBeTruthy();
     expect(screen.queryByText(gemini.health.reported!)).toBeNull();
     fireEvent.click(screen.getByRole("button", {name: "Turn on Antigravity"}));
     expect(onToggle).toHaveBeenCalledExactlyOnceWith(antigravity, true);
     expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
     expect(screen.getByRole("switch", {name: "Gemini"}).getAttribute("aria-checked")).toBe("true");
   });
   it("shows the already-on state without a redundant action", () => {
     const html = render({providers: [gemini, {...antigravity, value: true}]});
     expect(html).toContain("Antigravity is already on — you can turn Gemini off.");
     expect(html).not.toContain("Turn on Antigravity");
     expect(html).not.toContain("Show Antigravity");
   });
   it("does not enable again while the replacement setting is saving", () => {
     const onToggle = vi.fn();
     renderDom(<SetupProvidersScreen usage={usage} onCheckAgain={vi.fn()} onContinue={vi.fn()} onToggle={onToggle} pendingCheckIds={new Set()} pendingPreferenceIds={new Set([antigravity.id])} providers={[gemini, antigravity]} />);
     const button = screen.getByRole("button", {name: "Turn on Antigravity"}) as HTMLButtonElement;
     expect(button.disabled).toBe(true);
     fireEvent.click(button);
     expect(onToggle).not.toHaveBeenCalled();
   });
   it("opens Continue only once an enabled provider has usable data", () => {
     expect(render({providers:[gemini, antigravity]})).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<span>Continue/);
     const healthy = {...antigravity, value: true, health: {...antigravity.health, state: "healthy"}};
     expect(render({providers:[gemini, healthy], usage: {providers: [{id: "antigravity", label: "Antigravity", session: 0, weekly: 0, usageMode: "used"}]}})).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<span>Continue/);
     expect(setupProviderCanDisplay(gemini, usage)).toBe(false);
   });
   it("does not invent an alternative absent from the inventory", () => {
     expect(render({providers:[gemini]})).not.toContain("Turn on Antigravity");
   });
 });
