// @vitest-environment jsdom

import {
  act,
  cleanup,
  render as renderDom,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreferenceHealthState } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import {
  OFFERED_PROVIDER_IDS,
  PROVIDER_LOADING_LOG_INTERVAL_MS,
  SetupProvidersScreen,
  offeredProviders,
  setupProviderCanDisplay,
  setupProviderMatchesQuery,
  setupProviderOffersSignIn,
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
      providers={[claude, copilot]}
      {...props}
    />,
  );
}

describe("SetupProvidersScreen", () => {
  // VibeTV launches with the four providers it has been checked against. The
  // rest of CodexBar's inventory keeps its saved values but is not offered.
  it("offers only Codex, Claude, Cursor and Antigravity", () => {
    expect(OFFERED_PROVIDER_IDS).toEqual([
      "codex",
      "claude",
      "cursor",
      "antigravity",
    ]);
    const offered = offeredProviders([
      claude,
      copilot,
      provider({ health: "healthy", label: "Codex", providerId: "Codex" }),
      provider({ health: "disabled", label: "Cursor", providerId: "cursor" }),
      provider({
        health: "disabled",
        label: "Gemini",
        providerId: "gemini",
        value: false,
      }),
      provider({
        health: "disabled",
        label: "Antigravity",
        providerId: "antigravity",
      }),
    ]);
    expect(offered.map((item) => item.label)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
      "Antigravity",
    ]);
  });

  // Hiding a provider the customer already switched on would leave its switch
  // on with no row to turn it off, and the Companion then refuses an Automatic
  // display that omits it. An enabled provider therefore stays visible.
  it("keeps an enabled provider outside the offered four visible", () => {
    const offered = offeredProviders([
      provider({ health: "healthy", label: "Codex", providerId: "codex" }),
      provider({
        health: "healthy",
        label: "Gemini",
        providerId: "gemini",
        value: true,
      }),
      provider({
        health: "disabled",
        label: "Copilot",
        providerId: "copilot",
        value: false,
      }),
    ]);
    expect(offered.map((item) => item.label)).toEqual(["Codex", "Gemini"]);
  });

  // The sign-in action belongs to a signed-out tool and to a browser
  // sign-in with a page to open; a healthy or timed-out row has none.
  it("offers the sign-in action only where a sign-in can be started", () => {
    expect(setupProviderOffersSignIn(copilot)).toBe(true);
    expect(
      setupProviderOffersSignIn(
        provider({ health: "setup_required", label: "X", providerId: "x" }),
      ),
    ).toBe(true);
    expect(setupProviderOffersSignIn(claude)).toBe(false);
    expect(
      setupProviderOffersSignIn(
        provider({ health: "timeout", label: "X", providerId: "x" }),
      ),
    ).toBe(false);
    const browser = provider({
      health: "browser_sign_in_required",
      label: "X",
      providerId: "x",
    });
    expect(setupProviderOffersSignIn(browser)).toBe(false);
    expect(
      setupProviderOffersSignIn({
        health: { ...browser.health, signInUrl: "https://claude.ai/login" },
      }),
    ).toBe(true);
  });

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
    expect(html).toContain(
      "Live usage is unavailable. Showing the last saved reading.",
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
    expect(setupProviderCanDisplay(claude)).toBe(true);
    expect(
      setupProviderCanDisplay(
        provider({ health: "stale", label: "Codex", providerId: "codex" }),
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
        ),
      ).toBe(false);
    }
  });
});
