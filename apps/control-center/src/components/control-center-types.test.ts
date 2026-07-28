import { describe, expect, it } from "vitest";
import {
  deviceCanContinueThemeSetup,
  deviceCompletedThemeSetup,
  deviceIsActive,
  deviceIsReady,
  deviceNeedsExplicitConnect,
  deviceNeedsThemeSetup,
} from "./control-center-types";

describe("device connection contract", () => {
  it("only treats an explicit ready=true as connected", () => {
    expect(
      deviceIsReady({
        connected: true,
        paired: true,
        ready: false,
        connectionState: "ready",
        stream: { healthy: true, running: true },
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
    expect(deviceIsActive({ active: true, connected: false, ready: false })).toBe(
      true,
    );
  });

  it("never flashes Connected during fast reachable-before-ready updates", () => {
    const updates = [
      { connected: false, ready: false },
      { connected: true, paired: undefined, ready: false },
      { connected: true, paired: true, ready: false },
      { connected: true, paired: true, ready: true },
    ];

    expect(updates.map(deviceIsReady)).toEqual([false, false, false, true]);
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

  it("keeps an entered theme setup eligible until the complete device readback", () => {
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
    ).toBe(false);
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
