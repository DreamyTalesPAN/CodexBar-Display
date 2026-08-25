import { describe, expect, it } from "vitest";
import {
  deviceAwaitsProviderSetup,
  deviceCanContinueThemeSetup,
  deviceCompletedThemeSetup,
  deviceIsActive,
  deviceIsCustomerConnected,
  deviceIsReady,
  deviceNeedsExplicitConnect,
  deviceNeedsThemeSetup,
  providerRecoveryStatusRows,
  providerSetupIsChecking,
  providerSetupRequiresRecovery,
} from "./control-center-types";

describe("device connection contract", () => {
  it("keeps customer-visible connection separate from display readiness", () => {
    const waitingDevice = {
      active: true,
      connected: true,
      paired: true,
      ready: false,
      connectionState: "ready" as const,
      stream: { healthy: false, running: true },
    };

    expect(deviceIsCustomerConnected(waitingDevice)).toBe(true);
    expect(deviceIsReady(waitingDevice)).toBe(false);
    expect(
      deviceIsCustomerConnected({
        ...waitingDevice,
        connected: false,
      }),
    ).toBe(false);
    expect(
      deviceIsCustomerConnected({
        ...waitingDevice,
        active: false,
      }),
    ).toBe(false);
    expect(
      deviceIsCustomerConnected({
        ...waitingDevice,
        paired: false,
      }),
    ).toBe(false);
    expect(deviceIsReady({ connected: true, ready: true })).toBe(true);
  });

  it("only treats an explicit active=true as a completed relationship", () => {
    expect(
      deviceIsActive({
        connected: true,
        deviceId: "14799300",
        known: true,
        ready: false,
      }),
    ).toBe(false);
    expect(
      deviceIsActive({ active: true, connected: false, ready: false }),
    ).toBe(true);
  });

  it("never treats fast reachable-before-selected updates as customer connected", () => {
    const updates = [
      { connected: false, ready: false },
      { connected: true, paired: undefined, ready: false },
      { connected: true, paired: true, ready: false },
      { connected: true, paired: true, ready: true },
    ];

    expect(updates.map(deviceIsCustomerConnected)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("returns a reachable device with a missing key to the Connect screen", () => {
    expect(
      deviceNeedsExplicitConnect({
        active: true,
        connected: true,
        paired: false,
        ready: false,
        stream: {
          running: true,
          healthy: false,
          errorCode: "device_pairing_required",
        },
      }),
    ).toBe(true);
  });

  it("does not replace normal reconnecting or offline screens with Connect", () => {
    expect(
      deviceNeedsExplicitConnect({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        connectionState: "reconnecting",
      }),
    ).toBe(false);
    expect(
      deviceNeedsExplicitConnect({
        active: true,
        connected: false,
        paired: false,
        ready: false,
      }),
    ).toBe(false);
  });

  it("shows theme setup only for an active, paired VibeTV whose theme is missing", () => {
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
        health: { ok: true },
        display: { themeSpec: { active: false, renderOk: true } },
      }),
    ).toBe(true);
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "clippy",
        health: { ok: true },
        display: { themeSpec: { active: true, renderOk: false } },
      }),
    ).toBe(false);
  });

  it("shows theme setup without waiting for the display stream", () => {
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
        health: { ok: true },
        stream: { healthy: false, running: true },
        display: { themeSpec: { active: false, renderOk: true } },
      }),
    ).toBe(true);
  });

  it("keeps unrelated incomplete device states out of theme setup", () => {
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: false,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
      }),
    ).toBe(false);
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: false,
        ready: false,
        activeTheme: "theme-missing",
      }),
    ).toBe(false);
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
        health: { ok: false },
      }),
    ).toBe(false);
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
      }),
    ).toBe(false);
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
        health: { ok: true },
        display: { themeSpec: { active: false, renderOk: false } },
      }),
    ).toBe(false);
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "theme-missing",
        health: { ok: false },
      }),
    ).toBe(false);
  });

  it("keeps a VibeTV that only lacks an AI provider out of theme setup", () => {
    const awaitingProvider = {
      target: "http://192.168.178.72",
      active: true,
      connected: true,
      paired: true,
      ready: false,
      activeTheme: "theme-missing",
      health: { ok: true },
      stream: {
        healthy: false,
        running: true,
        target: "http://192.168.178.72/",
        errorCode: "provider_setup_required",
      },
      display: { themeSpec: { active: false, renderOk: true } },
    } as const;

    expect(deviceAwaitsProviderSetup(awaitingProvider)).toBe(true);
    // Without AI usage the device draws the error frame forever, so this state
    // must route to recovery before theme setup.
    expect(deviceNeedsThemeSetup(awaitingProvider)).toBe(false);
    expect(deviceCanContinueThemeSetup(awaitingProvider)).toBe(false);
  });

  it("does not trust an old provider error as live device evidence", () => {
    const awaitingProvider = {
      target: "http://192.168.178.72",
      active: true,
      connected: true,
      paired: true,
      ready: false,
      health: { ok: true },
      stream: {
        healthy: false,
        running: true,
        target: "http://192.168.178.72",
        errorCode: "provider_setup_required",
      },
    } as const;

    expect(
      deviceAwaitsProviderSetup({ ...awaitingProvider, connected: false }),
    ).toBe(false);
    expect(
      deviceAwaitsProviderSetup({
        ...awaitingProvider,
        health: { ok: false },
      }),
    ).toBe(false);
    expect(
      deviceAwaitsProviderSetup({
        ...awaitingProvider,
        stream: { ...awaitingProvider.stream, target: "http://192.168.178.99" },
      }),
    ).toBe(false);
  });

  it("still shows theme setup for other stream failures", () => {
    for (const errorCode of ["display_send_failed", "device_pairing_required"]) {
      expect(
        deviceAwaitsProviderSetup({
          active: true,
          connected: true,
          paired: true,
          ready: false,
          stream: { healthy: false, running: true, errorCode },
        }),
      ).toBe(false);
    }
    expect(
      deviceNeedsThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "theme-missing",
        health: { ok: true },
        stream: {
          healthy: false,
          running: true,
          errorCode: "display_send_failed",
        },
        display: { themeSpec: { active: false, renderOk: true } },
      }),
    ).toBe(true);
    // A stopped stream is not a provider that is merely missing.
    expect(
      deviceAwaitsProviderSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        stream: {
          healthy: false,
          running: false,
          errorCode: "provider_setup_required",
        },
      }),
    ).toBe(false);
  });

  it("completes theme setup from a successful render without waiting for provider readiness", () => {
    expect(
      deviceCanContinueThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "synthwave",
        health: { ok: true },
        stream: { healthy: true, running: true },
        display: { themeSpec: { active: true, renderOk: true } },
      }),
    ).toBe(true);
    expect(
      deviceCompletedThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: false,
        activeTheme: "synthwave",
        health: { ok: true },
        stream: { healthy: true, running: true },
        display: { themeSpec: { active: true, renderOk: true } },
      }),
    ).toBe(true);
    expect(
      deviceCompletedThemeSetup({
        active: true,
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "synthwave",
        health: { ok: true },
        stream: { healthy: true, running: true },
        display: { themeSpec: { active: true, renderOk: true } },
      }),
    ).toBe(true);
  });
});

describe("provider recovery contract", () => {
  // The Companion reports status "ready" as soon as one provider delivers usage
  // and keeps every other provider in the list with its own failing status.
  // TestProviderSetupTokenEvidenceKeepsOneHealthyOneFailingIsolated pins that
  // payload on the Go side. Treating it as broken sent a working Mac into
  // full-screen recovery and restarted its runtime for nothing.
  it("accepts a reconciled setup where only some providers are ready", () => {
    expect(
      providerSetupRequiresRecovery({
        status: "ready",
        engine: { status: "ready" },
        providers: [
          { id: "codex", label: "Codex", enabled: true, status: "ready" },
          {
            id: "claude",
            label: "Claude",
            enabled: true,
            status: "auth_required",
          },
        ],
      }),
    ).toBe(false);
    expect(
      providerSetupRequiresRecovery({
        status: "ready",
        providers: [
          { id: "codex", status: "ready" },
          { id: "gemini", status: "no_usage_available" },
        ],
      }),
    ).toBe(false);
  });

  it("still recovers when the reconciled status itself is not usable", () => {
    expect(providerSetupRequiresRecovery({ status: "setup_required" })).toBe(
      true,
    );
    expect(
      providerSetupRequiresRecovery({
        status: "provider_not_configured",
        providers: [{ id: "codex", status: "ready" }],
      }),
    ).toBe(true);
  });

  it("never claims recovery while the status is unknown or still checking", () => {
    expect(providerSetupRequiresRecovery({ status: "checking" })).toBe(false);
    expect(providerSetupRequiresRecovery(null)).toBe(false);
    expect(providerSetupRequiresRecovery(undefined)).toBe(false);
    expect(
      providerSetupRequiresRecovery({
        providers: [{ id: "claude", status: "auth_required" }],
      }),
    ).toBe(false);
  });

  it("keeps unknown and checking setup ahead of theme selection", () => {
    expect(providerSetupIsChecking(null)).toBe(true);
    expect(providerSetupIsChecking({ status: "checking" })).toBe(true);
    expect(providerSetupIsChecking({ status: "ready" })).toBe(false);
    expect(providerSetupIsChecking({ status: "setup_required" })).toBe(false);
  });
});

describe("providerRecoveryStatusRows", () => {
  it("names up to four switched-off providers, then collapses into a count", () => {
    const off = (id: string) => ({
      id,
      status: "not_configured",
      enabled: false,
    });
    const few = providerRecoveryStatusRows({
      status: "setup_required",
      providers: [off("claude"), off("gemini"), off("cursor"), off("opencode")],
    });
    expect(few.map((row) => row.id)).toEqual([
      "claude",
      "gemini",
      "cursor",
      "opencode",
    ]);

    const many = providerRecoveryStatusRows({
      status: "setup_required",
      providers: [off("a"), off("b"), off("c"), off("d"), off("e")],
    });
    expect(many).toEqual([
      { id: "switched-off-providers", label: "5 AI providers", text: "Switched off." },
    ]);
  });

  it("keeps the codexbar stand-in and ready providers out of the rows", () => {
    const rows = providerRecoveryStatusRows({
      status: "setup_required",
      providers: [
        { id: "codexbar", status: "not_configured" },
        { id: "codex", status: "ready", enabled: true },
        {
          id: "claude",
          label: "Claude",
          status: "auth_required",
          enabled: true,
          detail: "This provider needs an active sign-in.",
        },
      ],
    });
    expect(rows).toEqual([
      {
        id: "claude",
        label: "Claude",
        text: "This provider needs an active sign-in.",
      },
    ]);
  });
});
