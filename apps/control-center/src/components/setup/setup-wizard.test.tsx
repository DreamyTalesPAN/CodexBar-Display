// @vitest-environment jsdom
//
// Regression tests for two ways the wizard could strand a customer with no
// control left on screen. Both were reachable on a completely healthy Mac.
//
// DO NOT weaken these tests to make them pass. Fix the component.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderItem } from "../provider-picker";
import { SetupWizard, type SetupWizardProps } from "./setup-wizard";

afterEach(cleanup);

// jsdom has no matchMedia; the display step asks it about reduced motion.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

function provider(): ProviderItem {
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: true,
    health: { message: "", service: "operational", state: "healthy" },
    id: "codexbar.providers.codex.enabled",
    label: "Codex",
    owner: "codexbar",
    value: true,
  } as ProviderItem;
}

function baseProps(overrides: Partial<SetupWizardProps>): SetupWizardProps {
  return {
    aiFixPrompt: () => "",
    automaticPreviews: [],
    connectSteps: {
      connect: vi.fn(),
      installFirmware: vi.fn(),
    } as unknown as SetupWizardProps["connectSteps"],
    device: null,
    deviceCandidates: [],
    deviceSearchState: "idle",
    displayFrame: null,
    displayMode: "automatic",
    displayProviderId: null,
    displayProviders: [{ id: "codex", label: "Codex" }],
    installingTheme: false,
    onCreateSupportReport: vi.fn(),
    onDisplayContinue: vi.fn(),
    onFindManualTarget: vi.fn(),
    onFinished: vi.fn(),
    onInstallTheme: vi.fn(),
    onProviderCheck: vi.fn(),
    onProviderRecover: vi.fn(),
    onProviderToggle: vi.fn(),
    onProvidersContinue: vi.fn(),
    onDismissProviderError: vi.fn(),
    providerError: null,
    onSearchDevices: vi.fn(),
    onSelectTheme: vi.fn(),
    providers: [provider()],
    selectedThemeId: null,
    step: "display",
    themeInstallLogs: [],
    themes: [],
    usage: null,
    welcomeLines: [],
    ...overrides,
  };
}

function shownStep(): string {
  return document.querySelector("main")?.getAttribute("aria-label") ?? "";
}

describe("SetupWizard: going back", () => {
  // The derived step stays "display" throughout: the server already accepted
  // the providers, which is exactly why Back is offered there at all. Before
  // the fix the override outlived the visit and the customer was held on the
  // provider step for good -- no Back button, and a Continue that answered 200
  // without ever moving.
  it("hands the screen back to the derived step once Continue is pressed", () => {
    render(<SetupWizard {...baseProps({ step: "display" })} />);
    expect(shownStep()).toBe("Display Mode");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose AI providers");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(shownStep()).toBe("Display Mode");
  });

  it("does not offer Back on the step it lands on, and still moves on", () => {
    render(<SetupWizard {...baseProps({ step: "display" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // No way back from the provider step by design -- so Continue has to work.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(shownStep()).toBe("Display Mode");
  });

  it("releases the theme step the same way", () => {
    render(<SetupWizard {...baseProps({ step: "theme" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Display Mode");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(shownStep()).toBe("Choose your theme");
  });
});

describe("SetupWizard: a refusal from the companion", () => {
  // Both writing steps go through the companion, which applies gates the
  // screen cannot fully anticipate. Swallowing the refusal left a Continue
  // that answered and did nothing.
  it("shows what the provider step was refused, and why", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "providers",
          providerError: {
            code: "provider_check_required",
            message: "Every enabled provider must be ready.",
            nextAction:
              "Check each enabled provider and fix or turn off any provider that needs attention.",
          },
        })}
      />,
    );

    expect(
      screen.getByText("Every enabled provider must be ready."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Check each enabled provider and fix or turn off any provider that needs attention.",
      ),
    ).toBeTruthy();
  });

  it("shows what the display step was refused", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "display",
          providerError: {
            code: "provider_display_disabled",
            message: "A displayed provider is turned off.",
            nextAction: "Turn it on or choose another displayed provider.",
          },
        })}
      />,
    );

    expect(
      screen.getByText("A displayed provider is turned off."),
    ).toBeTruthy();
  });

  it("says nothing when nothing was refused", () => {
    render(<SetupWizard {...baseProps({ step: "providers" })} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("SetupWizard: typing an address while the scan runs", () => {
  // The manual lookup takes over the search attempt, which ends the running
  // scan. If that scan's state then settles to "not-found" while the address
  // dialog is open, its dialog must not stack on top of the one the customer
  // is typing into.
  it("keeps the not-found dialog out of the way while the address dialog is open", () => {
    const props = baseProps({ step: "device", deviceSearchState: "searching" });
    const { rerender } = render(<SetupWizard {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Enter IP address manually" }),
    );

    // The superseded scan settles underneath.
    rerender(<SetupWizard {...props} deviceSearchState="not-found" />);

    expect(screen.queryByText("We couldn't find your VibeTV")).toBeNull();
  });

  // Closing the address dialog is the customer saying "that wasn't it". The
  // settled scan then has to explain itself and offer another one, otherwise
  // the step is a dead end: empty list, no dialog, no Back.
  it("explains the settled scan once the address dialog is closed", () => {
    const props = baseProps({ step: "device", deviceSearchState: "searching" });
    const { rerender } = render(<SetupWizard {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Enter IP address manually" }),
    );
    rerender(<SetupWizard {...props} deviceSearchState="not-found" />);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(screen.getByRole("button", { name: "Scan again" })).toBeTruthy();
  });
});
