// @vitest-environment jsdom
//
// Regression tests for two ways the wizard could strand a customer with no
// control left on screen. Both were reachable on a completely healthy Mac.
//
// DO NOT weaken these tests to make them pass. Fix the component.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
    displaySavePending: false,
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
    onRetryProviders: vi.fn(),
    providerError: null,
    searchError: null,
    onSearchDevices: vi.fn(),
    onUpdateMacApp: vi.fn(),
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
  it("hands the screen back to the derived step once Continue is pressed", async () => {
    render(<SetupWizard {...baseProps({ step: "display" })} />);
    expect(shownStep()).toBe("Display Mode");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose AI providers");

    // Continue waits for the companion to accept it before releasing the step.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(shownStep()).toBe("Display Mode");
  });

  // Coming back from theme leaves the derived step ahead, so a refused
  // completion would carry the customer to a screen with nowhere to show it.
  it("keeps the provider step when completion is refused", async () => {
    const onProvidersContinue = vi.fn(async () => false);
    render(
      <SetupWizard {...baseProps({ step: "theme", onProvidersContinue })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose AI providers");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(onProvidersContinue).toHaveBeenCalled();
    expect(shownStep()).toBe("Choose AI providers");
  });

  it("does not offer Back on the step it lands on, and still moves on", async () => {
    render(<SetupWizard {...baseProps({ step: "display" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // No way back from the provider step by design -- so Continue has to work.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(shownStep()).toBe("Display Mode");
  });

  // A save that did not land must not read as one that did: the rollback
  // restores the old selection, so the derived step stays on theme and the
  // customer would be carried off the display step believing it was kept.
  it("keeps the display step when the save is refused", async () => {
    const onDisplayContinue = vi.fn(async () => false);
    render(
      <SetupWizard
        {...baseProps({ step: "theme", onDisplayContinue })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Display Mode");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(onDisplayContinue).toHaveBeenCalled();
    expect(shownStep()).toBe("Display Mode");
  });

  it("moves on when the save lands", async () => {
    const onDisplayContinue = vi.fn(async () => true);
    render(
      <SetupWizard
        {...baseProps({ step: "theme", onDisplayContinue })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(shownStep()).toBe("Choose your theme");
  });

  // The display choice is written optimistically, and the derived step reads
  // that as done. Moving on for it would put the customer on the theme step --
  // picking, even installing -- on a write that can still roll back.
  it("holds the display step while its save is in flight", () => {
    const { rerender } = render(
      <SetupWizard
        {...baseProps({ step: "theme", displaySavePending: true })}
      />,
    );
    expect(shownStep()).toBe("Display Mode");

    rerender(
      <SetupWizard
        {...baseProps({ step: "theme", displaySavePending: false })}
      />,
    );
    expect(shownStep()).toBe("Choose your theme");
  });

  it("releases the theme step the same way", async () => {
    render(<SetupWizard {...baseProps({ step: "theme" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Display Mode");

    // The display save is awaited before the step is released, so this one
    // settles a microtask later than the provider step's Continue.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(shownStep()).toBe("Choose your theme");
  });
});

describe("SetupWizard: while the connect sequence is running", () => {
  // Pairing publishes the device before the firmware check and install have
  // finished. The firmware progress and its failure dialogs live on the device
  // step, so leaving it early runs the update out of sight and strands its
  // failure on a screen nobody is on.
  it("stays on the device step even once the derived step has moved on", async () => {
    const connect = vi.fn(() => new Promise<null>(() => {}) as Promise<null>);
    const props = baseProps({
      step: "device",
      deviceCandidates: [
        {
          deviceId: "vibetv-1",
          target: "http://192.168.178.73",
          known: true,
        } as never,
      ],
      connectSteps: {
        connect,
        checkFirmware: vi.fn(),
        installFirmware: vi.fn(),
      } as unknown as SetupWizardProps["connectSteps"],
    });
    const { rerender } = render(<SetupWizard {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });
    expect(connect).toHaveBeenCalled();

    // Pairing has published the device, so the derived step moves on while the
    // firmware check and install are still to come.
    await act(async () => {
      rerender(<SetupWizard {...props} step="providers" />);
    });

    expect(shownStep()).toBe("Choose your VibeTV");
  });

  // A failure is the sequence waiting for the customer, not the end of it. The
  // firmware dialogs that offer the retry live on this step, so leaving on
  // "failed" unmounted the one that was about to explain it.
  // Dismissing the dialog is not the same as the firmware being dealt with:
  // SetupDialog offers a close button and Escape, and clearing the failure
  // object used to release the step and carry the customer past a check that
  // never finished.
  it("stays on the device step after the firmware dialog is dismissed", async () => {
    const props = baseProps({
      step: "device",
      deviceCandidates: [
        {
          deviceId: "vibetv-1",
          target: "http://192.168.178.73",
          known: true,
        } as never,
      ],
      connectSteps: {
        connect: vi.fn(async () => null),
        checkFirmware: vi.fn(async () => {
          throw {
            code: "firmware_check_failed",
            message: "Could not check VibeTV's firmware.",
            nextAction: "Check the internet connection, then try again.",
          };
        }),
        installFirmware: vi.fn(),
      } as unknown as SetupWizardProps["connectSteps"],
    });
    const { rerender } = render(<SetupWizard {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    await act(async () => {
      rerender(<SetupWizard {...props} step="providers" />);
    });

    expect(shownStep()).toBe("Choose your VibeTV");
  });

  it("stays on the device step when the firmware check fails", async () => {
    const props = baseProps({
      step: "device",
      deviceCandidates: [
        {
          deviceId: "vibetv-1",
          target: "http://192.168.178.73",
          known: true,
        } as never,
      ],
      connectSteps: {
        connect: vi.fn(async () => null),
        checkFirmware: vi.fn(async () => {
          throw {
            code: "firmware_check_failed",
            message: "Could not check VibeTV's firmware.",
            nextAction: "Check the internet connection, then try again.",
          };
        }),
        installFirmware: vi.fn(),
      } as unknown as SetupWizardProps["connectSteps"],
    });
    const { rerender } = render(<SetupWizard {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });
    await act(async () => {
      rerender(<SetupWizard {...props} step="providers" />);
    });

    expect(shownStep()).toBe("Choose your VibeTV");
    expect(
      screen.getByText("Could not check VibeTV's firmware"),
    ).toBeTruthy();
  });
});

describe("SetupWizard: a VibeTV that a rescan no longer finds", () => {
  const candidate = (deviceId: string, target: string) =>
    ({ deviceId, target, known: true }) as never;

  // Search again is easy to reach now, and a VibeTV can be gone by the time it
  // answers. The choice used to survive as a target nothing matched: no card
  // drawn as selected, Connect still live, and pressing it doing nothing.
  it("does not keep a choice the current results no longer contain", () => {
    const props = baseProps({
      step: "device",
      deviceSearchState: "multiple",
      deviceCandidates: [
        candidate("vibetv-a", "http://192.168.178.10"),
        candidate("vibetv-b", "http://192.168.178.11"),
      ],
    });
    const { rerender } = render(<SetupWizard {...props} />);

    fireEvent.click(screen.getAllByRole("radio")[1]);

    // The rescan comes back without the one they picked.
    rerender(
      <SetupWizard
        {...props}
        deviceCandidates={[candidate("vibetv-a", "http://192.168.178.10")]}
      />,
    );

    const remaining = screen.getAllByRole("radio");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("leaves Connect closed when a rescan finds nothing at all", () => {
    const props = baseProps({
      step: "device",
      deviceSearchState: "multiple",
      deviceCandidates: [candidate("vibetv-a", "http://192.168.178.10")],
    });
    const { rerender } = render(<SetupWizard {...props} />);
    fireEvent.click(screen.getAllByRole("radio")[0]);

    rerender(<SetupWizard {...props} deviceCandidates={[]} />);

    expect(
      screen.getByRole("button", { name: "Connect" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("SetupWizard: a scan that could not be made", () => {
  // The step used to report a count of zero and keep the reason to itself, so
  // the customer could only try the same thing again -- and for a refused
  // Local Network permission, trying again can never work.
  it("says why the scan failed and offers another one", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "device",
          deviceSearchState: "failed",
          searchError: {
            code: "LOCAL_NETWORK_ACCESS_REQUIRED",
            message: "Local Network access is off for VibeTV Control Center.",
            nextAction:
              "Open System Settings > Privacy & Security > Local Network, allow VibeTV Control Center, then try again.",
          },
        })}
      />,
    );

    expect(
      screen.getByText("We couldn't search for your VibeTV"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Local Network access is off/).textContent,
    ).toContain("System Settings");
  });

  // Every dialog can be dismissed, and dismissing the only rescan control left
  // the step with nothing but the address field. The step carries its own.
  it("keeps a way to scan again on the step itself", () => {
    const onSearchDevices = vi.fn();
    render(
      <SetupWizard
        {...baseProps({
          step: "device",
          deviceSearchState: "not-found",
          onSearchDevices,
        })}
      />,
    );

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    fireEvent.click(screen.getByRole("button", { name: "Search again" }));

    expect(onSearchDevices).toHaveBeenCalled();
  });

  it("does not offer it while a scan is still running", () => {
    render(
      <SetupWizard
        {...baseProps({ step: "device", deviceSearchState: "searching" })}
      />,
    );

    expect(screen.queryByRole("button", { name: "Search again" })).toBeNull();
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

  // The provider list is read the same way as the display selection, and a
  // failed read left the step saying no providers matched: an empty list, a
  // closed Continue, and nothing said. Nothing retries it on its own either.
  it("shows a failed provider read, with a way to ask again", () => {
    const onRetryProviders = vi.fn();
    render(
      <SetupWizard
        {...baseProps({
          step: "providers",
          providers: [],
          onRetryProviders,
          providerError: {
            code: "COMPANION_TIMEOUT",
            message: "Provider settings need attention.",
            nextAction: "Try again in a moment.",
          },
        })}
      />,
    );

    expect(screen.getByText("Provider settings need attention.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryProviders).toHaveBeenCalled();
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
