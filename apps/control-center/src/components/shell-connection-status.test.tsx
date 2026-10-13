import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { overviewConnectionStatus, ShellConnectionStatus } from "./shell-connection-status";

describe("overviewConnectionStatus", () => {
  it("shows Online and the Mac App version only for a customer-connected device", () => {
    const state = overviewConnectionStatus(
      "online",
      { active: true, connected: true, paired: true, ready: false },
      undefined,
      "1.0.33",
    );
    expect(state).toEqual({ label: "Online · v1.0.33", compactLabel: "Online", ready: true });
    expect(renderToStaticMarkup(<ShellConnectionStatus {...state} />)).toContain("Online · v1.0.33");
  });

  it("distinguishes a firmware reboot, disconnected VibeTV, and missing Mac App", () => {
    const disconnected = { active: true, connected: false, paired: true, ready: false };
    expect(overviewConnectionStatus("online", disconnected, "installing", "1.0.33").label).toBe("VibeTV restarting");
    expect(overviewConnectionStatus("online", disconnected, "error", "1.0.33").label).toBe("VibeTV not connected");
    expect(overviewConnectionStatus("missing", disconnected, undefined, "1.0.33").label).toBe("Mac App offline");
  });

  it("names a theme VibeTV cannot draw instead of Online (#498)", () => {
    const state = overviewConnectionStatus("online", {
      active: true, connected: true, deviceId: "14799300", paired: true, ready: false,
      connectionState: "display_render_failed",
    }, undefined, "1.0.33");
    expect(state.label).toBe("Theme not shown · VibeTV can't show this theme. Choose another theme.");
    expect(state.compactLabel).toBe("Theme not shown");
    expect(state.ready).toBe(false);
  });

  // Issue #265: the Mac App decides that the signal is weak; the header says so.
  it("names a weak WiFi signal and what to do about it (#265)", () => {
    const status = (connected: boolean, health?: { ok: boolean; wifi?: { rssi: number; weak?: boolean } }) =>
      overviewConnectionStatus("online", { active: true, connected, paired: true, ready: connected, health }).label;

    expect(status(true, { ok: true, wifi: { rssi: -82, weak: true } })).toBe(
      "Weak WiFi signal · Move VibeTV closer to your router.",
    );
    // A good signal, a low reading the Mac App has not named weak, a VibeTV
    // that reports no signal (the Cable, older firmware), and a reading kept
    // from a VibeTV that has gone away.
    for (const label of [
      status(true, { ok: true, wifi: { rssi: -48 } }),
      status(true, { ok: true, wifi: { rssi: -85 } }),
      status(true, { ok: true }),
      status(true),
      status(false, { ok: true, wifi: { rssi: -82, weak: true } }),
    ]) {
      expect(label).not.toContain("Weak WiFi signal");
      expect(label).not.toContain("closer to your router");
    }
  });

  // Issues #438/#460: the Windows app must not call itself a Mac App.
  it("names the app for the platform", () => {
    expect(overviewConnectionStatus("missing", null, undefined, undefined, true).label).toBe("App offline");
    expect(overviewConnectionStatus("unknown", null, undefined, undefined, true).label).toBe("Connecting to app");
    expect(overviewConnectionStatus("unknown", null).label).toBe("Connecting to Mac App");
  });
});
