import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyForHost,
  detectCustomerPlatform,
  errorForHost,
  statusForHost,
} from "./customer-platform";

describe("copyForHost", () => {
  it("leaves every macOS text unchanged", () => {
    const text =
      "Mac App did not answer. Quit VibeTV Control Center, then open it again from Applications. Update the Mac App on this Mac.";
    expect(copyForHost(text, false)).toBe(text);
  });

  it("words the app and the computer for Windows", () => {
    expect(copyForHost("Mac App needs setup.", true)).toBe("App needs setup.");
    expect(
      copyForHost(
        "Mac App did not answer. Quit VibeTV Control Center, then open it again from Applications. If it still does not answer, replace it with the latest Mac App from app.vibetv.shop.",
        true,
      ),
    ).toBe(
      "App did not answer. Quit VibeTV Control Center, then open it again from the Start menu. If it still does not answer, replace it with the latest app from app.vibetv.shop.",
    );
    expect(copyForHost("Your Mac App is out of date", true)).toBe(
      "Your app is out of date",
    );
    expect(
      copyForHost("Keep VibeTV on the same WiFi as this Mac.", true),
    ).toBe("Keep VibeTV on the same WiFi as this computer.");
  });

  it("words an error's message and next step for Windows only", () => {
    const error = {
      code: "COMPANION_TIMEOUT",
      message: "Mac App took too long to answer.",
      nextAction: "Restart the Mac App, then retry.",
    };
    expect(errorForHost(error, false)).toBe(error);
    expect(errorForHost(error, true)).toEqual({
      code: "COMPANION_TIMEOUT",
      message: "App took too long to answer.",
      nextAction: "Restart the app, then retry.",
    });
    expect(errorForHost(null, true)).toBeNull();
  });
});

// Issue #548: the runtime keeps one wording, the Mac's, and the Windows app
// rewords it where it is shown. A new sentence of the runtime that the rule
// above does not catch ("on the Mac", "in macOS") would reach a Windows
// customer as it is, so every sentence in the runtime's source is put through
// the rule here.
describe("the runtime's sentences in the Windows app", () => {
  it.each([
    // Setup log, after the background service came back.
    ["The Mac App's background service started again.", "The app's background service started again."],
    // Refusals while the app restarts or cannot do something.
    ["Mac App is restarting.", "App is restarting."],
    ["This Mac App cannot scan WiFi networks through VibeTV.", "This app cannot scan WiFi networks through VibeTV."],
    ["Connect VibeTV to this Mac with the USB cable, then press Connect.", "Connect VibeTV to this computer with the USB cable, then press Connect."],
    // The update check and its job.
    ["Mac App is up to date.", "App is up to date."],
    ["Mac App update is available.", "App update is available."],
    ["Mac App check failed.", "App check failed."],
    // Diagnostics checks.
    ["Finish AI setup in the Mac App, then click Check again.", "Finish AI setup in the app, then click Check again."],
    ["Keep VibeTV powered on and connected to the same WiFi as this Mac.", "Keep VibeTV powered on and connected to the same WiFi as this computer."],
    ["Keep the Mac App running until VibeTV receives a usage frame.", "Keep the app running until VibeTV receives a usage frame."],
  ])("%s", (mac, windows) => {
    expect(copyForHost(mac, true)).toBe(windows);
    expect(copyForHost(mac, false)).toBe(mac);
  });

  // Sentences that keep the Mac on purpose: they are chosen by system in the
  // runtime itself, belong to a path only the Mac has, or are never shown.
  const keepsTheMac = [
    "macOS blocked access required by this provider.",
    "Allow the requested macOS permission, then check again.",
    "Allow the required macOS access, then check this provider.",
    "Finish installing the Mac App in Applications.",
    "Mac setup binary installed",
    "Keep only one VibeTV Companion daemon running for this macOS user.",
    "starts and restarts the VibeTV background service on macOS",
    "run setup on macOS as your normal logged-in user, then rerun `codexbar-display setup`",
  ];

  it("leaves no other sentence of the runtime naming the Mac", () => {
    const root = join(process.cwd(), "../../companion");
    const sources = (readdirSync(root, { recursive: true }) as string[]).filter(
      (file) => file.endsWith(".go") && !file.endsWith("_test.go"),
    );
    expect(sources.length).toBeGreaterThan(50);
    const left: string[] = [];
    for (const file of sources) {
      for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
        if (/^\s*\/\//.test(line)) continue;
        for (const match of line.replace(/\s\/\/ .*$/, "").matchAll(/"((?:[^"\\]|\\.)*)"|`([^`]*)`/g)) {
          const text = match[1] ?? match[2];
          // A sentence, not a path, a field name or a build constraint.
          if (!text.includes(" ") || keepsTheMac.includes(text)) continue;
          if (/\bMac\b|macOS|\bApplications\b/.test(copyForHost(text, true))) {
            left.push(`${file}: ${text}`);
          }
        }
      }
    }
    expect(left).toEqual([]);
  });
});

describe("detectCustomerPlatform", () => {
  it("trusts the browser's own platform name first", () => {
    expect(
      detectCustomerPlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        userAgentDataPlatform: "Windows",
      }),
    ).toBe("windows");
    expect(
      detectCustomerPlatform({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        userAgentDataPlatform: "macOS",
      }),
    ).toBe("macos");
  });

  it("falls back to the user agent when no platform name is reported", () => {
    expect(
      detectCustomerPlatform({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      }),
    ).toBe("windows");
    expect(
      detectCustomerPlatform({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      }),
    ).toBe("macos");
  });

  it("does not answer a phone or tablet with a desktop installer", () => {
    expect(
      detectCustomerPlatform({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      }),
    ).toBe("unknown");
    expect(
      detectCustomerPlatform({
        userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
      }),
    ).toBe("unknown");
  });

  it("stays unknown for a system we do not build for or say nothing about", () => {
    expect(detectCustomerPlatform({ userAgentDataPlatform: "Linux" })).toBe(
      "unknown",
    );
    expect(
      detectCustomerPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }),
    ).toBe("unknown");
    expect(detectCustomerPlatform({})).toBe("unknown");
  });
});

describe("statusForHost", () => {
  // A firmware or theme job that loses the background service carries the
  // runtime's "Mac App ... from Applications" recovery in its status.
  const status = {
    phase: "error" as const,
    startedAt: "2026-09-29T08:00:00Z",
    message: "Mac App did not answer.",
    error: "Open VibeTV Control Center again from Applications.",
    failure: {
      code: "companion_unavailable",
      message: "Mac App did not answer.",
      nextAction: "Open VibeTV Control Center again from Applications.",
    },
    logs: ["Preparing VibeTV update.", "Mac App did not answer."],
  };

  it("words the whole status for Windows", () => {
    const worded = statusForHost(status, true);
    expect(JSON.stringify(worded)).not.toMatch(/Mac|Applications/);
    expect(worded?.error).toBe("Open VibeTV Control Center again from the Start menu.");
    expect(worded?.failure?.code).toBe("companion_unavailable");
    expect(worded?.logs[1]).toBe("App did not answer.");
  });

  it("leaves the macOS status untouched", () => {
    expect(statusForHost(status, false)).toBe(status);
    expect(statusForHost(null, true)).toBeNull();
  });
});
