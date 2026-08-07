import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  PreferenceDescriptor,
  PreferenceHealthState,
  ProviderDisplaySelection,
} from "./control-center-types";
import {
  ProviderPicker,
  providerMatchesQuery,
  providerSetupCanFinish,
  providerSetupMissingEnabledProviders,
  providerEnableIsRedundant,
  setupFixedReplacedProviderId,
  setupToggleOffDisplay,
  setupToggleOnDisplay,
} from "./provider-picker";

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
  it("renders a single combined switch in setup mode instead of Include and Enabled", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={automatic}
        items={[codex, claude]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
        setupMode
      />,
    );

    expect(html).toContain('aria-label="Stop using Codex"');
    expect(html).not.toContain('aria-label="Include Codex in Automatic"');
    expect(html).not.toContain('aria-label="Disable Codex"');
    expect(html).not.toContain("Enabled</span>");
    expect(html).toContain("Using this</span>");
  });

  it("keeps the separate Include and Enabled controls outside setup mode", () => {
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

    expect(html).toContain('aria-label="Include Codex in Automatic"');
    expect(html).toContain('aria-label="Disable Codex"');
    expect(html).not.toContain('aria-label="Stop using Codex"');
  });

  it("disables the setup-mode switch for the last remaining enabled provider", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={{ ...automatic, providerIds: ["codex"] }}
        items={[codex, cursor, copilot]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
        setupMode
      />,
    );

    expect(html).toMatch(
      /aria-label="Stop using Codex"[^>]*disabled=""|disabled=""[^>]*aria-label="Stop using Codex"/,
    );
  });

  it("shows only the displayed provider as on in Always show one, even when another stayed enabled", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={{
          mode: "fixed",
          providerIds: ["codex"],
          configured: true,
          valid: true,
        }}
        items={[codex, claude]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
        setupMode
      />,
    );

    // codex is the shown provider and must read as on; claude stayed
    // enabled in the background but is not displayed, so it must read as
    // off. Exactly one "Stop using" control may exist.
    expect(html).toContain('aria-label="Stop using Codex"');
    expect(html).toContain('aria-label="Use Claude"');
    expect(html.match(/aria-label="Stop using [^"]+"/g)).toHaveLength(1);
  });

  it("cannot turn the currently shown provider off directly in Always show one", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={{
          mode: "fixed",
          providerIds: ["codex"],
          configured: true,
          valid: true,
        }}
        items={[codex, claude]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
        setupMode
      />,
    );

    expect(html).toMatch(
      /aria-label="Stop using Codex"[^>]*disabled=""|disabled=""[^>]*aria-label="Stop using Codex"/,
    );
  });

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

  it("disables the setup-mode combined switch until the saved selection loads", () => {
    const html = renderToStaticMarkup(
      <ProviderPicker
        display={null}
        items={[codex]}
        onCheck={vi.fn()}
        onDisplayChange={vi.fn()}
        onPreferenceChange={vi.fn()}
        pendingCheckIds={new Set()}
        pendingPreferenceIds={new Set()}
        setupMode
      />,
    );

    expect(html).toMatch(
      /aria-label="Stop using Codex"[^>]*disabled=""|disabled=""[^>]*aria-label="Stop using Codex"/,
    );
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

  it("blocks setup until every enabled provider is selected and freshly ready", () => {
    expect(
      providerSetupCanFinish(
        [codex, claude],
        { ...automatic, providerIds: ["codex"] },
        new Set(),
        new Set(),
      ),
    ).toBe(false);
    expect(
      providerSetupCanFinish(
        [codex, claude],
        automatic,
        new Set(),
        new Set(["claude"]),
      ),
    ).toBe(false);
    expect(
      providerSetupCanFinish(
        [codex, claude],
        automatic,
        new Set(),
        new Set(),
        null,
        true,
      ),
    ).toBe(false);
    expect(
      providerSetupCanFinish([codex, claude], automatic, new Set(), new Set()),
    ).toBe(true);
  });

  it("does not block setup for a degraded external service when usage is ready", () => {
    const degradedCodex = provider({
      ...codex,
      health: {
        state: "healthy",
        service: "degraded",
        message: "Provider is working.",
        verifiedAt: new Date().toISOString(),
      },
    });
    expect(
      providerSetupCanFinish(
        [degradedCodex],
        { ...automatic, providerIds: ["codex"] },
        new Set(),
        new Set(),
      ),
    ).toBe(true);
  });

  it("does not block setup on a momentary stale live check when usage already succeeded once", () => {
    const staleClaude = provider({
      ...claude,
      health: {
        state: "stale",
        service: "unknown",
        message:
          "Live usage is unavailable; the last successful reading is still saved.",
        lastSuccessAt: new Date().toISOString(),
      },
    });
    expect(
      providerSetupCanFinish(
        [codex, staleClaude],
        automatic,
        new Set(),
        new Set(),
      ),
    ).toBe(true);
  });

  it("still blocks setup for providers that genuinely need customer action", () => {
    const blockedStates: PreferenceHealthState[] = [
      "auth_required",
      "setup_required",
      "no_usage_available",
      "timeout",
      "config_error",
      "unavailable",
    ];
    for (const state of blockedStates) {
      const blockedCodex = provider({
        ...codex,
        health: {
          state,
          service: "unknown",
          message: "Needs attention.",
        },
      });
      expect(
        providerSetupCanFinish(
          [blockedCodex],
          { ...automatic, providerIds: ["codex"] },
          new Set(),
          new Set(),
        ),
      ).toBe(false);
    }
  });

  it("names enabled providers that are outside the display pool", () => {
    expect(
      providerSetupMissingEnabledProviders([codex, claude], {
        ...automatic,
        providerIds: ["codex"],
      }),
    ).toEqual(["Claude"]);
  });

  it("turning the setup switch on adds the provider to Automatic", () => {
    expect(
      setupToggleOnDisplay("automatic", new Set(["codex"]), "claude"),
    ).toEqual({ mode: "automatic", providerIds: ["codex", "claude"] });
    expect(
      setupToggleOnDisplay("automatic", new Set(["codex"]), "codex"),
    ).toBeNull();
  });

  it("turning the setup switch on in fixed mode makes it the always-shown provider", () => {
    expect(setupToggleOnDisplay("fixed", new Set(["codex"]), "claude")).toEqual(
      { mode: "fixed", providerIds: ["claude"] },
    );
  });

  it("turning the setup switch off removes the provider from the display selection", () => {
    expect(
      setupToggleOffDisplay(
        "automatic",
        new Set(["codex", "claude"]),
        "claude",
      ),
    ).toEqual({ mode: "automatic", providerIds: ["codex"] });
    expect(
      setupToggleOffDisplay("automatic", new Set(["codex"]), "claude"),
    ).toBeNull();
  });

  it("turning off the last selected provider never empties the display selection", () => {
    expect(
      setupToggleOffDisplay("automatic", new Set(["codex"]), "codex"),
    ).toBeNull();
  });

  it("identifies the previously shown provider that Always show one must replace", () => {
    expect(setupFixedReplacedProviderId(new Set(["codex"]), "claude")).toBe(
      "codex",
    );
    expect(
      setupFixedReplacedProviderId(new Set(["codex", "claude"]), "codex"),
    ).toBe("claude");
    expect(setupFixedReplacedProviderId(new Set(), "codex")).toBeNull();
    expect(
      setupFixedReplacedProviderId(new Set(["codex"]), "codex"),
    ).toBeNull();
  });

  it("skips re-enabling a provider that is already healthy and freshly verified", () => {
    const now = Date.now();
    const freshHealthy = provider({
      ...codex,
      health: {
        state: "healthy",
        service: "operational",
        message: "Provider is working.",
        verifiedAt: new Date(now - 60_000).toISOString(),
      },
    });
    expect(providerEnableIsRedundant(freshHealthy, now)).toBe(true);
  });

  it("still enables a provider that is disabled, stale, or unverified", () => {
    const now = Date.now();
    const disabled = provider({ ...codex, value: false });
    const stale = provider({
      ...codex,
      health: {
        state: "stale",
        service: "unknown",
        message:
          "Live usage is unavailable; the last successful reading is still saved.",
      },
    });
    const expiredVerification = provider({
      ...codex,
      health: {
        state: "healthy",
        service: "operational",
        message: "Provider is working.",
        verifiedAt: new Date(now - 10 * 60_000).toISOString(),
      },
    });
    expect(providerEnableIsRedundant(disabled, now)).toBe(false);
    expect(providerEnableIsRedundant(stale, now)).toBe(false);
    expect(providerEnableIsRedundant(expiredVerification, now)).toBe(false);
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
