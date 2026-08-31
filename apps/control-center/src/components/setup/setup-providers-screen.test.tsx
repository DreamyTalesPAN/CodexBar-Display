import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PreferenceHealthState } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import {
  SetupProvidersScreen,
  setupProviderCanDisplay,
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
