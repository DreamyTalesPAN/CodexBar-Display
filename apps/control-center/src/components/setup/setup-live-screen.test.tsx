import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SetupLiveScreen } from "./setup-live-screen";

const device = {
  active: true,
  connected: true,
  ready: true,
  paired: true,
  activeTheme: "clippy",
} as Parameters<typeof SetupLiveScreen>[0]["device"];

const displayFrame = {
  ok: true,
  frame: {
    v: 2,
    provider: "codex",
    label: "Codex",
    usageSlots: [{ id: "weekly", label: "Weekly", percent: 29 }],
  },
} as Parameters<typeof SetupLiveScreen>[0]["displayFrame"];

function render(props: Partial<Parameters<typeof SetupLiveScreen>[0]> = {}) {
  return renderToStaticMarkup(
    <SetupLiveScreen
      device={device}
      displayFrame={displayFrame}
      usage={null}
      {...props}
    />,
  );
}

describe("SetupLiveScreen", () => {
  it("celebrates the live device", () => {
    expect(render()).toContain("Your VibeTV is live");
  });

  it("shows the rendered VibeTV instead of a placeholder", () => {
    expect(render()).toContain('data-testid="vibetv-case"');
  });

  it("has no primary action and no way back", () => {
    const html = render();

    expect(html).not.toContain("<span>Back</span>");
    expect(html.match(/<button/g) || []).toHaveLength(1);
  });
});
