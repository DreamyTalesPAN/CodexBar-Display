import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OverviewScreen } from "./overview-screen";

describe("OverviewScreen", () => {
  it("does not describe a rejected pairing token as live or provider setup", () => {
    const html = renderToStaticMarkup(
      <OverviewScreen
        companionStatus="online"
        device={{
          connected: true,
          deviceId: "14799300",
          paired: false,
          ready: false,
          stream: {
            errorCode: "device_pairing_required",
            healthy: false,
            running: true,
          },
        }}
      />,
    );

    expect(html).toContain("Not connected");
    expect(html).toContain("Pair VibeTV again to resume display updates.");
    expect(html).not.toContain("Start using any AI provider.");
  });
});
