import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  PreferenceDescriptor,
  ProviderDisplaySelection,
} from "./control-center-types";
import { ProviderPicker, providerMatchesQuery } from "./provider-picker";

const codex = provider({
  id: "codexbar.providers.codex.enabled",
  label: "Codex",
  providerId: "codex",
  description: "Usage from the Codex subscription.",
});
const claude = provider({
  id: "codexbar.providers.claude.enabled",
  label: "Claude",
  providerId: "claude",
  description: "Usage from Claude.",
});
const cursor = provider({
  id: "codexbar.providers.cursor.enabled",
  label: "Cursor",
  providerId: "cursor",
  value: false,
});
const copilot = provider({
  id: "codexbar.providers.copilot.enabled",
  label: "GitHub Copilot",
  providerId: "copilot",
  value: false,
});
const automatic: ProviderDisplaySelection = {
  mode: "automatic",
  providerIds: ["codex", "claude"],
  configured: true,
  valid: true,
};

describe("ProviderPicker", () => {
  it("renders semantic provider controls and separate display choices", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={automatic}
        items={[codex, claude]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />,
    );

    expect(html).toContain("AI providers");
    expect(html).toContain("Display mode");
    expect(html).toContain("Provider display selection");
    expect(html).toContain('aria-label="Include Codex in Automatic"');
    expect(html).toContain('aria-label="Disable Codex"');
    expect(html).toContain("Check again");
    expect(html).toContain("min-h-11");
  });

  it("announces pending display saves on only the changed provider row", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={automatic}
        displayPendingProviderId="claude"
        items={[codex, claude]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Saving display choice for Claude"');
    expect(html).not.toContain('aria-label="Saving display choice for Codex"');
  });

  it("disables display choices until the saved selection loads", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={null}
        items={[codex]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Automatic<\/button>/);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Always show one<\/button>/,
    );
    expect(html).toMatch(
      /role="checkbox"[^>]*disabled=""[^>]*aria-label="Include Codex in Automatic"/,
    );
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("renders a service outage only once when it is the provider health state", () => {
    const outage = provider({
      id: "codexbar.providers.gemini.enabled",
      label: "Gemini",
      providerId: "gemini",
      health: {
        state: "service_outage",
        service: "outage",
        message: "The provider service is unavailable.",
      },
    });
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={{ ...automatic, providerIds: ["gemini"] }}
        items={[outage]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />,
    );

    expect(html.match(/Service outage/g)).toHaveLength(1);
  });

  it("searches true provider identity instead of the shared descriptor prefix", () => {
    expect(providerMatchesQuery(codex, "codex")).toBe(true);
    expect(providerMatchesQuery(claude, "codex")).toBe(false);
    expect(providerMatchesQuery(claude, "usage from claude")).toBe(true);
  });

  it("shows the four common providers first and collapses the rest", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={automatic}
        items={[
          provider({
            id: "codexbar.providers.gemini.enabled",
            label: "Gemini",
            providerId: "gemini",
            value: false,
          }),
          cursor,
          claude,
          provider({
            id: "codexbar.providers.opencode.enabled",
            label: "OpenCode",
            providerId: "opencode",
            value: false,
          }),
          copilot,
          codex,
        ]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />,
    );

    expect(html.indexOf(">Codex</h3>")).toBeLessThan(
      html.indexOf(">Claude</h3>"),
    );
    expect(html.indexOf(">Claude</h3>")).toBeLessThan(
      html.indexOf(">Cursor</h3>"),
    );
    expect(html.indexOf(">Cursor</h3>")).toBeLessThan(
      html.indexOf(">GitHub Copilot</h3>"),
    );
    expect(html).not.toContain(">Gemini</h3>");
    expect(html).not.toContain(">OpenCode</h3>");
    expect(html).toContain("Show all providers (2 more)");
  });

  it("keeps enabled providers visible outside the common four", () => {
    const enabledGemini = provider({
      id: "codexbar.providers.gemini.enabled",
      label: "Gemini",
      providerId: "gemini",
    });
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={{ ...automatic, providerIds: ["codex", "claude", "gemini"] }}
        items={[codex, claude, cursor, copilot, enabledGemini]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
      />,
    );

    expect(html).toContain(">Gemini</h3>");
    expect(html).not.toContain("Show all providers");
  });

});

function provider(
  overrides: Partial<PreferenceDescriptor> &
    Pick<PreferenceDescriptor, "id" | "label" | "providerId">,
): PreferenceDescriptor {
  return {
    section: "providers",
    owner: "codexbar",
    type: "boolean",
    value: true,
    effectiveValue: true,
    allowsDefault: false,
    availability: { state: "available" },
    writeStrategy: "codexbar_command",
    writable: true,
    health: {
      state: "healthy",
      service: "operational",
      message: "Provider is ready.",
      verifiedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}
