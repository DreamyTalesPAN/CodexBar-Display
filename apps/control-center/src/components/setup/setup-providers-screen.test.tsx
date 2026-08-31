import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PreferenceHealthState } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import {
  PROVIDER_READINESS_FRESHNESS_MS,
  SetupProvidersScreen,
  setupProviderCanDisplay,
  setupProviderCheckExpiresAt,
  setupProviderCheckIsStale,
  setupProviderMatchesQuery,
} from "./setup-providers-screen";

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
      onRecover={vi.fn()}
      onToggle={vi.fn()}
      pendingCheckIds={new Set<string>()}
      providers={[claude, copilot]}
      {...props}
    />,
  );
}

describe("SetupProvidersScreen", () => {
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

  it("continues once every provider that is on is ready", () => {
    const html = render({ providers: [claude, copilot] });

    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  // The companion refuses to write setup complete while any enabled provider
  // still needs the customer. Letting Continue through here only produced a
  // button that answered and left the customer on the same step with nothing
  // said. The way on is to sign the provider in or switch it off.
  it("cannot continue while a provider that is on still needs the customer", () => {
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

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
  });

  // The companion asks for an exact check of its own, and the health a provider
  // reports before that answer arrives is not it. A row could read healthy while
  // the check the companion wants was still queued, so Continue was open on a
  // gate that refuses it -- and the row said nothing about the check running.
  it("waits for a check that is still running", () => {
    const html = render({
      pendingCheckIds: new Set(["claude"]),
      providers: [claude, copilot],
    });

    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>[^<]*<span>Continue<\/span>/,
    );
    // And the row keeps its switch throughout: docs/control-center-ui-principles
    // rule 3 does not let a check decide whether a provider may be turned off.
    expect(html).toContain('aria-label="Claude Code"');
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

// The companion only accepts an exact check for five minutes. The app used to
// remember that it had asked for one forever, so when that readiness expired
// nothing re-armed: Continue was refused, and a row reporting healthy offers no
// Check again. The same staleness rule now governs both timestamps.
describe("setupProviderCheckIsStale", () => {
  const now = Date.UTC(2026, 7, 31, 12, 0, 0);

  it("holds a check the companion still accepts", () => {
    expect(setupProviderCheckIsStale(now - 60_000, now)).toBe(false);
  });

  it("lets go once the companion would not accept it any more", () => {
    expect(
      setupProviderCheckIsStale(now - PROVIDER_READINESS_FRESHNESS_MS - 1, now),
    ).toBe(true);
  });

  it("treats a missing or unreadable time as no check at all", () => {
    expect(setupProviderCheckIsStale(undefined, now)).toBe(true);
    expect(setupProviderCheckIsStale(Number.NaN, now)).toBe(true);
  });

  // A clock that jumped backwards must not lock the check out.
  it("does not trust a time in the future", () => {
    expect(setupProviderCheckIsStale(now + 60_000, now)).toBe(true);
  });

  it("matches the companion's window", () => {
    expect(PROVIDER_READINESS_FRESHNESS_MS).toBe(5 * 60 * 1000);
  });
});

// Making the check re-armable was not enough on its own: nothing on screen
// changes when a check expires, so the step has to come back for it. This is
// the moment it has to come back at.
describe("setupProviderCheckExpiresAt", () => {
  const now = Date.UTC(2026, 7, 31, 12, 0, 0);

  it("has nothing to wait for when no check still counts", () => {
    expect(setupProviderCheckExpiresAt([undefined, undefined], now)).toBe(null);
    expect(
      setupProviderCheckExpiresAt(
        [now - PROVIDER_READINESS_FRESHNESS_MS - 1],
        now,
      ),
    ).toBe(null);
  });

  it("waits for the newest check, not the oldest", () => {
    const older = now - 4 * 60 * 1000;
    const newer = now - 60 * 1000;

    expect(setupProviderCheckExpiresAt([older, newer], now)).toBe(
      newer + PROVIDER_READINESS_FRESHNESS_MS,
    );
  });

  it("ignores a check that has already stopped counting", () => {
    const expired = now - PROVIDER_READINESS_FRESHNESS_MS - 1;
    const live = now - 60 * 1000;

    expect(setupProviderCheckExpiresAt([expired, live], now)).toBe(
      live + PROVIDER_READINESS_FRESHNESS_MS,
    );
  });
});
