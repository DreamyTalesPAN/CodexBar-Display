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
});
