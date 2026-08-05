import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./settings-screen";

describe("SettingsScreen", () => {
  it("keeps VibeTV mutations disabled during a firmware update", () => {
    const html = renderToStaticMarkup(
      <SettingsScreen
        brightness={50}
        busyAction="firmware-update"
        device={{ connected: true, paired: true, ready: true }}
        onBrightnessChange={vi.fn()}
        onResetSetup={vi.fn()}
        onSaveBrightness={vi.fn()}
      />,
    );

    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });
});
