import { describe, expect, it } from "vitest";
import { detectCustomerPlatform } from "./customer-platform";

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
