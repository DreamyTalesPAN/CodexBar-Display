import { describe, expect, it } from "vitest";
import {
  isNativeControlCenterUserAgent,
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
    expect(REPAIR_CONTROL_CENTER_RUNTIME_URL).toBe("vibetv://repair-runtime");
    expect(RESTART_CONTROL_CENTER_URL).toBe(
      "vibetv://restart-control-center",
    );
  });
});
