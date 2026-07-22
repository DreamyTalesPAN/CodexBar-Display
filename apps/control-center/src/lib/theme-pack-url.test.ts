import { describe, expect, it } from "vitest";
import { isRemoteThemePackUrl } from "./theme-pack-url";

describe("isRemoteThemePackUrl", () => {
  it("allows public HTTPS and the exact embedded Companion theme path", () => {
    expect(isRemoteThemePackUrl("https://example.com/theme.zip")).toBe(true);
    expect(
      isRemoteThemePackUrl(
        "http://127.0.0.1:47832/theme-packs/vibetv-theme-cozy.zip",
      ),
    ).toBe(true);
  });

  it("rejects insecure and unrelated loopback URLs", () => {
    expect(isRemoteThemePackUrl("http://example.com/theme.zip")).toBe(false);
    expect(isRemoteThemePackUrl("http://127.0.0.1:9000/private")).toBe(false);
    expect(isRemoteThemePackUrl("http://127.0.0.1:47832/v1/status")).toBe(false);
  });
});
