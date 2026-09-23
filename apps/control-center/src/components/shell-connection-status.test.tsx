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
});
