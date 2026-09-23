import { describe, expect, it } from "vitest";
import {
  copyForHost,
  detectCustomerPlatform,
  errorForHost,
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
