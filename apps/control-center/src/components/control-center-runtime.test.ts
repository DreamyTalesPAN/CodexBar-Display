import { describe, expect, it } from "vitest";
import {
  FINISH_CODEXBAR_RECOVERY_URL,
  isNativeControlCenterUserAgent,
  localThemeRenderPackUrl,
  REPAIR_CODEXBAR_URL,
  REPAIR_CONTROL_CENTER_RUNTIME_URL,
  RESTART_CONTROL_CENTER_URL,
} from "./control-center-runtime";

describe("native Control Center recovery", () => {
  it("recognizes only the native WebView user agent", () => {
    expect(isNativeControlCenterUserAgent("VibeTVControlCenter/1.2.3+45")).toBe(
      true,
    );
    expect(
      isNativeControlCenterUserAgent(
        "Mozilla/5.0 VibeTVControlCenter/1.2.3+45",
      ),
    ).toBe(false);
    expect(isNativeControlCenterUserAgent("Mozilla/5.0")).toBe(false);
  });

  it("keeps automatic repair separate from the full app restart", () => {
    expect(REPAIR_CODEXBAR_URL).toBe("vibetv://repair-codexbar");
    expect(FINISH_CODEXBAR_RECOVERY_URL).toBe(
      "vibetv://finish-codexbar-recovery",
    );
    expect(REPAIR_CONTROL_CENTER_RUNTIME_URL).toBe("vibetv://repair-runtime");
    expect(RESTART_CONTROL_CENTER_URL).toBe(
      "vibetv://restart-control-center",
    );
  });

  it("addresses the exact installed ThemeSpec revision when known", () => {
    expect(
      localThemeRenderPackUrl(
        "synthwave",
        "/themes/u/synthwa-1-6b39a3.json",
        "6B39A36C",
      ),
    ).toBe(
      "/theme-packs/render/synthwave/synthwa-1-6b39a3.json?specHash=6b39a36c",
    );
    expect(localThemeRenderPackUrl("synthwave")).toBe(
      "/theme-packs/render/synthwave.json",
    );
  });
});
