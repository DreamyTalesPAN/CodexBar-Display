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
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeviceCandidate } from "../control-center-types";
import type { ProviderItem } from "../provider-picker";
import { deriveSetupStep, setupDeviceIsUsable } from "./setup-step";
import { SetupWizard, type SetupWizardProps } from "./setup-wizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
    onProviderToggle: vi.fn(),
    onProvidersContinue: vi.fn(),
    onDismissProviderError: vi.fn(),
    onRetryProviders: vi.fn(),
    providerError: null,
    searchError: null,
    onSearchDevices: vi.fn(),
    pendingCheckIds: new Set<string>(),
    pendingPreferenceIds: new Set<string>(),
    providersLoading: false,
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

describe("SetupWizard: initial provider scan", () => {
  it("shows the provider loading screen instead of the finished list", () => {
    render(
      <SetupWizard
        {...baseProps({
          providers: [],
          providersLoading: true,
          step: "providers",
        })}
      />,
    );

    expect(shownStep()).toBe("Choose AI providers");
    expect(
      screen.getByText(/reading provider usage on this Mac/),
    ).toBeTruthy();
    expect(screen.queryByText("Codex")).toBeNull();
    expect(
      (screen.getByRole("searchbox", {
        name: "Search providers",
      }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("moves to the loading screen as soon as the firmware check finishes", async () => {
    let finishFirmwareCheck!: (value: null) => void;
    const checkFirmware = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishFirmwareCheck = resolve;
        }),
    );
    const props = baseProps({
      deviceCandidates: [
        {
          deviceId: "vibetv-1",
          target: "http://192.168.178.73",
          known: true,
        } as never,
      ],
      providers: [],
      providersLoading: true,
      step: "device",
      connectSteps: {
        connect: vi.fn(async () => ({})),
        checkFirmware,
        installFirmware: vi.fn(),
      } as unknown as SetupWizardProps["connectSteps"],
    });
    const { rerender } = render(<SetupWizard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await act(async () => {
      rerender(<SetupWizard {...props} step="providers" />);
    });
    expect(shownStep()).toBe("Choose your VibeTV");

    await act(async () => finishFirmwareCheck(null));

    expect(shownStep()).toBe("Choose AI providers");
    expect(
      screen.getByText(/reading provider usage on this Mac/),
    ).toBeTruthy();
  });

  it("moves directly from provider completion to Display Mode after a fresh connection", async () => {
    let finishFirmwareCheck!: (value: null) => void;
    let finishProviderCompletion!: (value: boolean) => void;
    const checkFirmware = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          finishFirmwareCheck = resolve;
        }),
    );
    const onProvidersContinue = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishProviderCompletion = resolve;
        }),
    );
    const onProviderToggle = vi.fn();
    const installFirmware = vi.fn();
    const disabledClaude = {
      ...provider(),
      effectiveValue: false,
      health: { message: "", service: "unknown", state: "disabled" },
      id: "codexbar.providers.claude.enabled",
      label: "Claude",
      providerId: "claude",
      value: false,
    } as ProviderItem;
    const enabledClaude = {
      ...disabledClaude,
      effectiveValue: true,
      health: { message: "", service: "operational", state: "healthy" },
      value: true,
    } as ProviderItem;
    const stepAfterConnection = (
      providerSelectionRequired: boolean,
      providerSetupCompletedThisSession: boolean,
    ) =>
      deriveSetupStep({
        deviceUsable: setupDeviceIsUsable({
          connectionRecoveryRequired: false,
          deviceConnected: true,
          displayRemediationRequired: false,
          hasActiveDevice: true,
          hasEnteredControlCenter: false,
          providerSelectionRequired,
          providerSetupCompletedThisSession,
          themeSetupRequired: false,
          ready: false,
        }),
        displayConfigured: false,
        displaySelectionSupported: true,
        initialCheckComplete: true,
        providerSelectionRequired,
        searchingForDevice: false,
        themeSetupRequired: false,
      });
    let props = baseProps({
      connectSteps: {
        connect: vi.fn(async () => ({ firmware: "1.0.32" })),
        checkFirmware,
        installFirmware,
      },
      deviceCandidates: [
        {
          deviceId: "vibetv-1",
          firmware: "1.0.32",
          known: true,
          target: "http://192.168.178.73",
        } as DeviceCandidate,
      ],
      displayProviders: [{ id: "claude", label: "Claude" }],
      onProviderToggle,
      onProvidersContinue,
      providers: [disabledClaude],
      step: "device",
    });
    const { rerender } = render(<SetupWizard {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await Promise.resolve();
    });
    expect(props.connectSteps.connect).toHaveBeenCalled();
    expect(checkFirmware).toHaveBeenCalled();

    // Pairing updates the parent state before the firmware check finishes. The
    // wizard must keep the device screen until that check has actually answered.
    props = { ...props, step: stepAfterConnection(true, false) };
    rerender(<SetupWizard {...props} />);
    expect(shownStep()).toBe("Choose your VibeTV");

    await act(async () => finishFirmwareCheck(null));
    expect(installFirmware).not.toHaveBeenCalled();
    expect(shownStep()).toBe("Choose AI providers");

    const providerContinue = screen.getByRole("button", { name: "Continue" });
    expect((providerContinue as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Claude" }));
    expect(onProviderToggle).toHaveBeenCalledWith(disabledClaude, true);
    props = { ...props, providers: [enabledClaude] };
    rerender(<SetupWizard {...props} />);
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onProvidersContinue).toHaveBeenCalledTimes(1);
    expect(shownStep()).toBe("Choose AI providers");
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // The successful completion response clears the provider requirement while
    // the first usage frame is still missing. That must advance to Display Mode,
    // not briefly send the freshly connected customer back to Device.
    await act(async () => {
      props = { ...props, step: stepAfterConnection(false, true) };
      rerender(<SetupWizard {...props} />);
      finishProviderCompletion(true);
    });
    expect(shownStep()).toBe("Display Mode");
    expect(
      screen.queryByRole("main", { name: "Choose your VibeTV" }),
    ).toBeNull();
  });
});

describe("SetupWizard: live handover", () => {
  it("keeps setup visible until the fresh preview is actually rendered", async () => {
    vi.useFakeTimers();
    const onFinished = vi.fn();
    const themeSpecPath = "/themes/u/claude--6-546f9e.json";
    const themeSpecHash = "546f9e84";
    let resolvePack!: () => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvePack = () =>
              resolve({
                ok: true,
                status: 200,
                json: async () => ({
                  assets: {},
                  spec: { p: [] },
                  specHash: themeSpecHash,
                  specPath: themeSpecPath,
                  themeId: "claude-creature",
                }),
              } as Response);
          }),
      ),
    );
    const waitingDevice = {
      active: true,
      activeTheme: "claude-creature",
      connected: true,
      paired: true,
      ready: false,
      display: {
        themeSpec: {
          active: true,
          hash: themeSpecHash,
          path: themeSpecPath,
          renderOk: true,
        },
      },
    } as NonNullable<SetupWizardProps["device"]>;
    const readyDevice: NonNullable<SetupWizardProps["device"]> = {
      ...waitingDevice,
      ready: true,
    };
    const invalidFrame = {
      ok: true,
      frame: { v: 2, provider: "claude", label: "Claude" },
    } as SetupWizardProps["displayFrame"];
    const frame = {
      ok: true,
      frame: {
        v: 2,
        provider: "claude",
        label: "Claude",
        usageSlots: [
          { id: "session", label: "Session", percent: 44 },
        ],
      },
    } as SetupWizardProps["displayFrame"];
    const props = baseProps({
      device: waitingDevice,
      onFinished,
      step: "live",
    });
    const { rerender } = render(<SetupWizard {...props} />);

    act(() => vi.advanceTimersByTime(300_000));
    expect(onFinished).not.toHaveBeenCalled();
    expect(shownStep()).toBe("Your VibeTV is live");

    rerender(<SetupWizard {...props} device={readyDevice} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onFinished).not.toHaveBeenCalled();

    rerender(
      <SetupWizard
        {...props}
        device={readyDevice}
        displayFrame={invalidFrame}
      />,
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(onFinished).not.toHaveBeenCalled();

    rerender(
      <SetupWizard
        {...props}
        device={readyDevice}
        displayFrame={frame}
      />,
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(onFinished).not.toHaveBeenCalled();

    await act(async () => {
      resolvePack();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("img", {
        name: /Rendered VibeTV theme claude-creature showing Claude/i,
      }),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_999));
    expect(onFinished).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});

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

  // The Automatic pool no longer covering an enabled provider is refused on a
  // screen with no Include control, and the selection is still valid -- so the
  // derived step is theme and releasing the override carried the refusal to a
  // screen that renders none. The step that owns it is named instead.
  it("shows the step a refusal names, with the refusal on it", async () => {
    const onProvidersContinue = vi.fn(async () => "display" as const);
    const props = baseProps({ step: "theme", onProvidersContinue });
    const { rerender } = render(<SetupWizard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose AI providers");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(shownStep()).toBe("Display Mode");

    rerender(
      <SetupWizard
        {...props}
        providerError={{
          code: "provider_display_incomplete",
          message: "Every enabled provider must be included for display.",
          nextAction:
            "Add this provider to Automatic mode, select it in Always show, or turn it off.",
        }}
      />,
    );
    expect(shownStep()).toBe("Display Mode");
    expect(
      screen.getByText("Every enabled provider must be included for display."),
    ).toBeTruthy();
  });

  // The device step is the first choice the customer makes, so Back reaches
  // it from the provider step. There is no Continue on it: Connect is what
  // moves on, and a connect that finishes releases the step again.
  it("walks back to the device step, and Connect carries the customer on again", async () => {
    const props = baseProps({
      step: "display",
      deviceCandidates: [
        {
          deviceId: "vibetv-1",
          target: "http://192.168.178.73",
          known: true,
        } as never,
      ],
      connectSteps: {
        connect: vi.fn(async () => null),
        checkFirmware: vi.fn(async () => null),
        installFirmware: vi.fn(),
      } as unknown as SetupWizardProps["connectSteps"],
    });
    render(<SetupWizard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose AI providers");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose your VibeTV");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
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

  // The save can still be running when the customer leaves the step, and Back
  // is their later word on where they want to be. The continuation used to
  // release the override anyway and carry them forward from the step they had
  // just gone back to.
  it("keeps a Back press made while the save was running", async () => {
    let settle: (saved: boolean) => void = () => {};
    const onDisplayContinue = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <SetupWizard {...baseProps({ step: "theme", onDisplayContinue })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Display Mode");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose AI providers");

    await act(async () => {
      settle(true);
    });

    expect(shownStep()).toBe("Choose AI providers");
  });

  it("keeps a Back press made while provider completion was running", async () => {
    let settle: (done: boolean) => void = () => {};
    const onProvidersContinue = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    render(
      <SetupWizard {...baseProps({ step: "display", onProvidersContinue })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(shownStep()).toBe("Choose your VibeTV");

    await act(async () => settle(true));

    expect(shownStep()).toBe("Choose your VibeTV");
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

describe("SetupWizard: leaving the address dialog", () => {
  // The lookup can take a while, and its continuation pairs the VibeTV and can
  // start a firmware install. Cancel used to close the dialog and let both
  // happen anyway, on a VibeTV the customer had decided against.
  it("does not connect to an address the customer walked away from", async () => {
    let settle: (candidate: DeviceCandidate) => void = () => {};
    const onFindManualTarget = vi.fn(
      () =>
        new Promise<DeviceCandidate>((resolve) => {
          settle = resolve;
        }),
    );
    const connect = vi.fn();
    render(
      <SetupWizard
        {...baseProps({
          step: "device",
          deviceSearchState: "not-found",
          onFindManualTarget,
          connectSteps: {
            connect,
            installFirmware: vi.fn(),
          } as unknown as SetupWizardProps["connectSteps"],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enter IP manually" }));
    fireEvent.change(screen.getByLabelText("IP address"), {
      target: { value: "192.168.1.50" },
    });
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Enter IP address" }),
      ).getByRole("button", { name: "Connect" }),
    );
    expect(onFindManualTarget).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      settle({ target: "http://192.168.1.50", deviceId: "9517433" } as DeviceCandidate);
    });

    expect(connect).not.toHaveBeenCalled();
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

  // Connecting empties the discovered list, so after a firmware failure is
  // dismissed the step is still held -- deliberately -- with an empty list and
  // a closed Connect. The attempt is still there to repeat, and pressing
  // Connect repeats it instead of demanding a full rescan first.
  it("still offers the attempt that failed once its dialog is dismissed", async () => {
    const installFirmware = vi.fn(async () => {
      throw { code: "firmware_update_failed", message: "Update did not finish." };
    });
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
        connect: vi.fn(async () => ({})),
        checkFirmware: vi.fn(async () => ({ from: "1.0.0", to: "1.1.0" })),
        installFirmware,
      } as unknown as SetupWizardProps["connectSteps"],
    });
    const { rerender } = render(<SetupWizard {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    });
    expect(installFirmware).toHaveBeenCalledTimes(1);

    // The connect emptied the discovered list, and the dialog is dismissed
    // without using either of its actions.
    await act(async () => {
      rerender(<SetupWizard {...props} deviceCandidates={[]} />);
    });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
    });
    expect(shownStep()).toBe("Choose your VibeTV");

    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      fireEvent.click(connectButton);
    });
    expect(installFirmware).toHaveBeenCalledTimes(2);
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

  // The status poll owns a missing Companion and presents the runtime-recovery
  // screen. Repeating the same outage as a provider refusal puts two unrelated
  // recovery paths on top of each other, including during automatic repair.
  it("does not present a missing Companion as a provider-step refusal", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "providers",
          providerError: {
            code: "COMPANION_UNREACHABLE",
            message: "Mac App did not answer.",
            nextAction: "Quit and reopen the Mac App.",
          },
        })}
      />,
    );

    expect(screen.queryByText("Mac App did not answer.")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

// Every one of these dialogs is centred, so two at once are two stacked cards
// with the lower one's buttons unreachable. That is what a customer met after
// pressing Connect on a fresh Mac: a failed firmware check landing on "Finish
// AI setup on this Mac". The step's own failure is about what they just did and
// wins; the usage incident is still there once that one is answered.
describe("SetupWizard with a broken usage service", () => {
  it("shows the usage incident when the step has nothing of its own", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "welcome",
          usageFailure: "setup_incomplete",
          onRepairUsageService: vi.fn(),
        })}
      />,
    );

    expect(screen.getByText("Finish AI setup on this Mac")).toBeTruthy();
  });

  it("keeps the recovery action available on the Live step", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "live",
          usageFailure: "setup_incomplete",
          onRepairUsageService: vi.fn(),
        })}
      />,
    );

    expect(screen.getByText("Finish AI setup on this Mac")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Repair" })).toBeTruthy();
  });

  it("never stacks it on the step's own failure", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "device",
          deviceSearchState: "not-found",
          usageFailure: "setup_incomplete",
          onRepairUsageService: vi.fn(),
        })}
      />,
    );

    expect(screen.getByText("We couldn't find your VibeTV")).toBeTruthy();
    expect(screen.queryByText("Finish AI setup on this Mac")).toBeNull();
  });

  it("never stacks it on a scan that could not be made", () => {
    render(
      <SetupWizard
        {...baseProps({
          step: "device",
          searchError: {
            code: "search_failed",
            message: "The Mac refused the local network scan.",
            nextAction: "Allow Local Network access, then search again.",
          },
          usageFailure: "setup_incomplete",
          onRepairUsageService: vi.fn(),
        })}
      />,
    );

    expect(screen.getByText("We couldn't search for your VibeTV")).toBeTruthy();
    expect(screen.queryByText("Finish AI setup on this Mac")).toBeNull();
  });

  it("lets the customer put the incident away", () => {
    const onDismissUsageFailure = vi.fn();
    render(
      <SetupWizard
        {...baseProps({
          step: "welcome",
          usageFailure: "setup_incomplete",
          onRepairUsageService: vi.fn(),
          onDismissUsageFailure,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismissUsageFailure).toHaveBeenCalledTimes(1);
  });
});
