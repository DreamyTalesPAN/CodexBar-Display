import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupScreen } from "./setup-screen";

describe("SetupScreen", () => {
  it("marks the active setup step for assistive technology", () => {
    const html = renderToStaticMarkup(
      <SetupScreen
        companionStatus="missing"
        device={null}
        deviceState="unknown"
        deviceTarget=""
        setupComplete={false}
        showIntro={false}
      />,
    );

    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Step 1<span class=\"sr-only\">, current</span>");
  });

  it("keeps the complete public Mac App handoff visible", () => {
    const html = renderToStaticMarkup(
      <SetupScreen
        companionStatus="missing"
        device={null}
        deviceState="unknown"
        deviceTarget=""
        hostedMode
        macAppRelease={{
          checkedAt: "2026-08-24T12:00:00Z",
          status: "available",
          updateAvailable: false,
          message: "Mac App download ready.",
          dmgDownloadStatus: "available",
          dmgDownloadUrl:
            "https://github.com/DreamyTalesPAN/CodexBar-Display/releases/download/v1.0.99/VibeTV-Control-Center.dmg",
        }}
        setupComplete={false}
        showIntro={false}
      />,
    );

    expect(html).toContain("Open the downloaded DMG");
    expect(html).toContain("wait for the copy to finish");
    expect(html).toContain("Open VibeTV Control Center from Applications");
  });
});
