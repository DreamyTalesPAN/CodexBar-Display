// @vitest-environment jsdom
//
// Accessibility baseline (issue #214, docs/control-center-accessibility.md).
// Every core screen and dialog is rendered with realistic props and checked
// with axe-core. Fix a finding at its source; do not disable a rule here.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThemeProduct } from "@/lib/themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ControlCenterShell } from "./control-center-shell";
import type {
  ActiveTab,
  DeviceInfo,
  UsageSnapshot,
} from "./control-center-types";
import { LogsScreen } from "./logs-screen";
import { OverviewScreen } from "./overview-screen";
import type { ProviderItem } from "./provider-picker";
import { SettingsScreen, type SettingsScreenProps } from "./settings-screen";
import {
  SetupAddressDialog,
  SetupCableHelpDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
  SetupDevicePickerDialog,
} from "./setup/setup-device-dialogs";
import {
  SetupFirmwareBlockedDialog,
  SetupFirmwareUpdateFailedDialog,
} from "./setup/setup-firmware-dialogs";
import { SetupStepFailedDialog } from "./setup/setup-provider-dialogs";
import { SetupRecoveryDialogs } from "./setup/setup-recovery-dialogs";
import { SetupUsageDialog } from "./setup/setup-usage-dialog";
import { SetupWizard, type SetupWizardProps } from "./setup/setup-wizard";
import { LeaveEditorDialog } from "./theme-studio/leave-editor-dialog";
import { ThemeLibraryScreen } from "./theme-library-screen";
import { UpdatesScreen } from "./updates-screen";
import { UsageScreen } from "./usage-screen";

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({
    ok: true,
    value: {
      themes: [
        {
          id: "u-1",
          updatedAt: "2026-07-01T00:00:00Z",
          document: {
            packName: "My Theme",
            spec: { themeId: "my-theme", usage: "live" },
          },
        },
      ],
    },
  }),
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The one rule switched off: jsdom has no layout or computed colours, so axe
// cannot measure contrast here. Contrast is covered by the token table in
// docs/control-center-accessibility.md and by theme-legibility.test.ts.
const AXE_OPTIONS: axe.RunOptions = {
  rules: { "color-contrast": { enabled: false } },
};

async function expectNoViolations(element: ReactElement) {
  renderApp(element);
  // Effects (storage reads, Radix focus handling) settle after the first paint.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await checkDocument();
}

// The app root (app/layout.tsx) provides the tooltip context.
function renderApp(element: ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

async function checkDocument() {
  const results = await axe.run(document.body, AXE_OPTIONS);
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.html}`)
          .join("\n")}`,
    ),
  ).toEqual([]);
}

const device: DeviceInfo = {
  active: true,
  connected: true,
  paired: true,
  ready: true,
  deviceId: "14799300",
  board: "esp8266-smalltv-st7789",
  firmware: "1.0.39",
  capabilities: { standby: { supported: true } },
};

const usage: UsageSnapshot = {
  ok: true,
  tokenUsageReady: true,
  currentProvider: "codex",
  providers: [
    {
      id: "codex",
      label: "Codex",
      source: "oauth",
      session: 12,
      weekly: 34,
      resetSecs: 3600,
      usageMode: "used",
      cost: { daily: [{ day: "2026-07-22", totalTokens: 1234 }] },
    },
    {
      id: "claude",
      label: "Claude",
      session: 80,
      weekly: 10,
      usageMode: "used",
      cost: { daily: [{ day: "2026-07-22", totalTokens: 99 }] },
    },
  ],
};

function provider(providerId: string, label: string, value: boolean): ProviderItem {
  return {
    allowsDefault: false,
    availability: { state: "available" },
    effectiveValue: value,
    health: {
      message: value ? "Ready." : "Off.",
      service: "operational",
      state: value ? "healthy" : "disabled",
    },
    id: `codexbar.providers.${providerId}.enabled`,
    label,
    owner: "codexbar",
    providerId,
    section: "providers",
    type: "boolean",
    value,
    writable: true,
    writeStrategy: "codexbar_command",
  };
}

const providers = [
  provider("codex", "Codex", true),
  provider("claude", "Claude", true),
  provider("cursor", "Cursor", false),
];

const themes: ThemeProduct[] = [
  {
    id: "live-theme",
    isFree: true,
    packSha256: "a".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/live.zip",
    priceLabel: "Free",
    source: "github-catalog",
    themeId: "live-theme",
    title: "Live Theme",
    usage: "live",
  },
  {
    id: "night-clock",
    isFree: true,
    packSha256: "b".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/screensaver.zip",
    priceLabel: "Free",
    source: "github-catalog",
    themeId: "night-clock",
    title: "Night Clock",
    usage: "screensaver",
  },
];

function inShell(activeTab: ActiveTab, children: ReactElement) {
  return (
    <ControlCenterShell
      activeTab={activeTab}
      device={device}
      onTabChange={vi.fn()}
      updateAvailable
    >
      {children}
    </ControlCenterShell>
  );
}

function settingsProps(
  overrides: Partial<SettingsScreenProps> = {},
): SettingsScreenProps {
  return {
    automaticPreviews: [],
    brightness: 70,
    busyAction: null,
    connectionMode: "cable",
    device,
    standby: {
      enabled: true,
      timeoutMinutes: 10,
      brightnessPercent: 20,
      screensaverPath: "/themes/s/night.json",
    },
    onBrightnessChange: vi.fn(),
    onChooseScreensaver: vi.fn(),
    onConnectionModeChange: vi.fn(),
    onDismissError: vi.fn(),
    onEraseDevice: vi.fn(),
    onResetSetup: vi.fn(),
    onRunDiagnostics: vi.fn(),
    onSaveBrightness: vi.fn(),
    onSaveStandby: vi.fn(),
    onStandbyBrightnessChange: vi.fn(),
    providerPicker: {
      usage,
      display: {
        mode: "automatic",
        providerIds: ["codex", "claude"],
        configured: true,
        valid: true,
      },
      items: providers,
      pendingCheckIds: new Set(),
      pendingPreferenceIds: new Set(),
      onCheck: vi.fn(),
      onDisplayChange: vi.fn(),
      onPreferenceChange: vi.fn(),
    },
    ...overrides,
  };
}

function themeLibrary(usageKind: "live" | "screensaver" = "live") {
  return (
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={device}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSaveStandby={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId="live-theme"
      storefrontConfigured={false}
      themeInstallEnabled
      themes={themes}
      usage={usageKind}
    />
  );
}

const updatesProps = {
  companionStatus: "online" as const,
  companionVersion: "1.0.61",
  companionRelease: {
    checkedAt: "2026-09-10T10:00:00Z",
    status: "available" as const,
    updateAvailable: false,
    message: "Mac App is up to date.",
  },
  device: { connected: true, board: "esp8266-smalltv-st7789", firmware: "1.0.39" },
  firmwareUpdate: {
    checkedAt: "2026-09-10T10:00:00Z",
    status: "update_available" as const,
    updateAvailable: true,
    latestFirmware: "1.0.40",
  },
  onCheckUpdates: vi.fn(),
  onCreateReport: vi.fn(),
  onInstallUpdate: vi.fn(),
};

function wizardProps(overrides: Partial<SetupWizardProps>): SetupWizardProps {
  return {
    aiFixPrompt: () => "",
    automaticPreviews: [],
    connectSteps: {
      connect: vi.fn(),
      installFirmware: vi.fn(),
    } as unknown as SetupWizardProps["connectSteps"],
    connectionMode: "cable",
    connectionModeChoiceRequired: false,
    device: null,
    deviceCandidates: [],
    deviceSearchState: "idle",
    displayFrame: null,
    displayMode: "automatic",
    displayProviderId: null,
    displaySavePending: false,
    displayProviders: [
      { id: "codex", label: "Codex" },
      { id: "claude", label: "Claude" },
    ],
    installingTheme: false,
    onCreateSupportReport: vi.fn(),
    onConfigureWiFi: vi.fn(),
    onDisplayContinue: vi.fn(),
    onFindManualTarget: vi.fn(),
    onFinished: vi.fn(),
    onInstallTheme: vi.fn(),
    onReturnToThemes: vi.fn(),
    themeError: null,
    onDismissThemeError: vi.fn(),
    onRetryTheme: vi.fn(),
    onProviderCheck: vi.fn(),
    onProviderToggle: vi.fn(),
    onProvidersContinue: vi.fn(),
    onDismissProviderError: vi.fn(),
    onRetryProviders: vi.fn(),
    providerError: null,
    searchError: null,
    onSearchDevices: vi.fn(),
    onScanWiFiNetworks: vi.fn(),
    onSelectConnectionMode: vi.fn(),
    pendingCheckIds: new Set<string>(),
    pendingPreferenceIds: new Set<string>(),
    providersLoading: false,
    onSelectTheme: vi.fn(),
    providers,
    selectedThemeId: "live-theme",
    step: "welcome",
    themeInstallLogs: [],
    themes: [{ id: "live-theme", name: "Live Theme" }],
    usage,
    welcomeLines: [],
    ...overrides,
  };
}

const candidates = [
  { target: "cable://vibetv", deviceId: "14799300", transport: "cable" },
  { target: "http://192.168.178.73", deviceId: "16198106", transport: "wifi" },
] as SetupWizardProps["deviceCandidates"];

const stepError = {
  code: "PROVIDER_REFUSED",
  message: "Claude could not be switched on.",
  nextAction: "Sign in to Claude, then try again.",
};

describe("accessibility baseline: main screens", () => {
  it("Overview", () =>
    expectNoViolations(
      inShell(
        "overview",
        <OverviewScreen companionStatus="online" device={device} usage={usage} />,
      ),
    ));

  it("Overview without a VibeTV", () =>
    expectNoViolations(
      inShell("overview", <OverviewScreen companionStatus="missing" device={null} />),
    ));

  it("Usage", () =>
    expectNoViolations(
      inShell(
        "usage",
        <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
      ),
    ));

  it("Usage while loading and after an error", async () => {
    await expectNoViolations(
      inShell(
        "usage",
        <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={null} />,
      ),
    );
    cleanup();
    await expectNoViolations(
      inShell(
        "usage",
        <UsageScreen
          companionStatus="online"
          onRefresh={vi.fn()}
          usage={null}
          usageError={{
            code: "COMPANION_TIMEOUT",
            message: "Usage needs attention.",
            nextAction: "Check the Mac App, then try again.",
          }}
        />,
      ),
    );
  });

  it("Settings", () =>
    expectNoViolations(inShell("settings", <SettingsScreen {...settingsProps()} />)));

  it("Appearance: themes and screensavers", async () => {
    await expectNoViolations(inShell("theme-library", themeLibrary("live")));
    cleanup();
    await expectNoViolations(inShell("theme-library", themeLibrary("screensaver")));
  });

  it("Updates", () =>
    expectNoViolations(inShell("updates", <UpdatesScreen {...updatesProps} />)));

  it("Updates while installing", () =>
    expectNoViolations(
      inShell(
        "updates",
        <UpdatesScreen
          {...updatesProps}
          updateStatus={{
            phase: "installing",
            stage: "uploading",
            startedAt: "2026-09-10T10:01:00Z",
            message: "Uploading firmware.",
            logs: [],
          }}
        />,
      ),
    ));

  it("Support", () =>
    expectNoViolations(
      inShell(
        "logs",
        <LogsScreen
          device={device}
          events={[
            {
              id: "1",
              label: "VibeTV connected",
              detail: "Connected by USB-C.",
              timestamp: "2026-09-10T10:00:00Z",
            },
          ]}
          lastError={{
            code: "COMPANION_TIMEOUT",
            message: "Usage needs attention.",
            nextAction: "Check the Mac App, then try again.",
          }}
          onLoadDiagnostics={vi.fn()}
          onRefresh={vi.fn()}
          onRepairUsageEngine={vi.fn()}
          onRunSetupAgain={vi.fn()}
        />,
      ),
    ));
});

describe("accessibility baseline: setup", () => {
  for (const step of [
    "welcome",
    "device",
    "providers",
    "display",
    "theme",
    "live",
  ] as const) {
    it(`Setup step: ${step}`, () =>
      expectNoViolations(
        <SetupWizard
          {...wizardProps({
            step,
            device: step === "welcome" || step === "device" ? null : device,
            deviceCandidates: step === "device" ? candidates : [],
            deviceSearchState: step === "device" ? "multiple" : "idle",
          })}
        />,
      ));
  }

  it("Setup dialogs", async () => {
    const dialogs: ReactElement[] = [
      <SetupAddressDialog key="a" onConnect={async () => null} onOpenChange={vi.fn()} open />,
      <SetupDeviceNotFoundDialog
        key="b"
        onEnterAddressManually={vi.fn()}
        onOpenChange={vi.fn()}
        onScanAgain={vi.fn()}
        onUseCable={vi.fn()}
        onUseWiFi={vi.fn()}
        open
      />,
      <SetupCableHelpDialog key="c" onEnterAddressManually={vi.fn()} onScanAgain={vi.fn()} />,
      <SetupConnectFailedDialog
        key="d"
        description="Move VibeTV closer to your router, then search again."
        onEnterAddressManually={vi.fn()}
        onOpenChange={vi.fn()}
        onSearchAgain={vi.fn()}
        open
        title="VibeTV did not connect"
      />,
      <SetupDevicePickerDialog
        key="e"
        candidates={candidates}
        error={null}
        onConnect={vi.fn()}
        onOpenChange={vi.fn()}
      />,
      <SetupFirmwareBlockedDialog
        key="f"
        onOpenChange={vi.fn()}
        onResolve={vi.fn()}
        open
        reason="firmware_check_failed"
      />,
      <SetupFirmwareUpdateFailedDialog
        key="g"
        onCreateSupportReport={vi.fn()}
        onOpenChange={vi.fn()}
        onRetry={vi.fn()}
        open
      />,
      <SetupStepFailedDialog key="h" error={stepError} onOpenChange={vi.fn()} onRetry={vi.fn()} />,
      <SetupRecoveryDialogs
        key="i"
        onHide={vi.fn()}
        onRestart={vi.fn()}
        onRetry={vi.fn()}
        phase="failed"
        retrying={false}
      />,
      <SetupUsageDialog
        key="j"
        cause="unknown"
        onCreateSupportReport={vi.fn()}
        onOpenChange={vi.fn()}
        onRepair={vi.fn()}
        open
      />,
    ];
    for (const dialog of dialogs) {
      await expectNoViolations(<main>{dialog}</main>);
      const open = screen.getByRole("dialog");
      expect(open.getAttribute("aria-labelledby")).toBeTruthy();
      expect(open.getAttribute("aria-describedby")).toBeTruthy();
      expect(open.contains(document.activeElement)).toBe(true);
      cleanup();
    }
  });
});

describe("accessibility baseline: focus and labels", () => {
  it("moves focus to the new step's title when setup continues", () => {
    const view = renderApp(<SetupWizard {...wizardProps({ step: "providers", device })} />);
    expect(document.activeElement?.textContent).toBe("Choose AI providers");
    view.rerender(
      <TooltipProvider>
        <SetupWizard {...wizardProps({ step: "display", device })} />
      </TooltipProvider>,
    );
    expect(document.activeElement?.textContent).toBe("Display Mode");
  });

  it("returns focus to the control that opened a dialog", async () => {
    renderApp(inShell("settings", <SettingsScreen {...settingsProps()} />));
    const opener = screen.getByRole("button", { name: "Reset to factory settings" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Radix hands focus back on the next tick.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus after a setup dialog as well", async () => {
    renderApp(
      <main>
        <SetupCableHelpDialog onEnterAddressManually={vi.fn()} onScanAgain={vi.fn()} />
      </main>,
    );
    const tick = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await tick();
    const opener = screen.getByRole("button", { name: "How to connect VibeTV" });
    opener.focus();
    fireEvent.click(opener);
    await tick();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await tick();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("says why a theme cannot be installed, not only in a tooltip", async () => {
    renderApp(
      <main>
        <ThemeLibraryScreen
          busyAction={null}
          companionStatus="online"
          device={null}
          onInstallCustomTheme={async () => false}
          onInstallTheme={vi.fn()}
          onSelectTheme={vi.fn()}
          selectedThemeId=""
          storefrontConfigured={false}
          themeInstallEnabled={false}
          themes={themes}
        />
      </main>,
    );
    const install = screen.getAllByRole("button", { name: "Install" })[0];
    expect((install as HTMLButtonElement).disabled).toBe(true);
    const reason = document.getElementById(install.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe(install.getAttribute("title"));
    expect(reason?.textContent).toBeTruthy();
  });

  it("names each usage card after its provider and each bar with its value", () => {
    renderApp(
      inShell(
        "usage",
        <UsageScreen companionStatus="online" onRefresh={vi.fn()} usage={usage} />,
      ),
    );
    const codex = screen.getByRole("group", { name: "Codex" });
    expect(
      codex.querySelector('[role="progressbar"][aria-label="Session: 12% used"]'),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Claude" })).toBeTruthy();
  });

  it("names a provider that is still being checked", () => {
    renderApp(
      <SetupWizard
        {...wizardProps({
          step: "providers",
          device,
          pendingCheckIds: new Set(["codexbar.providers.codex.enabled"]),
        })}
      />,
    );
    expect(screen.getByRole("switch", { name: "Codex" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Cursor" })).toBeTruthy();
  });
});

describe("accessibility baseline: confirmations and errors", () => {
  it("Settings: reset to factory settings", async () => {
    renderApp(inShell("settings", <SettingsScreen {...settingsProps()} />));
    fireEvent.click(screen.getByRole("button", { name: "Reset to factory settings" }));
    const dialog = screen.getByRole("dialog", {
      name: "Reset VibeTV to factory settings?",
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await checkDocument();
  });

  it("Settings: switch connection", async () => {
    renderApp(inShell("settings", <SettingsScreen {...settingsProps()} />));
    fireEvent.click(screen.getByRole("button", { name: "WiFi" }));
    expect(screen.getByRole("dialog", { name: "Switch to WiFi?" })).toBeTruthy();
    await checkDocument();
  });

  it("Appearance: delete a custom theme", async () => {
    renderApp(inShell("theme-library", themeLibrary("live")));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete My Theme" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete My Theme?" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await checkDocument();
  });

  it("Updates: update failed", async () => {
    renderApp(
      inShell(
        "updates",
        <UpdatesScreen
          {...updatesProps}
          updateStatus={{
            phase: "error",
            startedAt: "2026-09-10T10:01:00Z",
            error: "Update was not installed.",
            logs: [],
          }}
        />,
      ),
    );
    expect(screen.getByRole("dialog", { name: "Update failed" })).toBeTruthy();
    await checkDocument();
  });

  it("Theme Studio: leave with unsaved changes", () =>
    expectNoViolations(
      <main>
        <LeaveEditorDialog
          onDiscard={vi.fn()}
          onKeepEditing={vi.fn()}
          onSaveAndReturn={async () => {}}
          saving={false}
        />
      </main>,
    ));
});
