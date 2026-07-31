import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ThemeStudioUsage } from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import { ThemeLibraryScreen } from "./theme-library-screen";

const themes: ThemeProduct[] = [
  {
    id: "live-theme",
    isFree: true,
    packSha256: "a".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/live.zip",
    priceLabel: "Kostenlos",
    source: "github-catalog",
    themeId: "live-theme",
    title: "Live Theme",
    usage: "live",
  },
  {
    id: "night-clock",
    isFree: true,
    packSha256: "b".repeat(64),
    packSizeBytes: 100,
    packUrl: "https://example.com/screensaver.zip",
    priceLabel: "Kostenlos",
    source: "github-catalog",
    themeId: "night-clock",
    title: "Night Clock",
    usage: "screensaver",
  },
];

function renderLibrary(usage: ThemeStudioUsage, catalog = themes) {
  return renderToStaticMarkup(
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={null}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSelectTheme={vi.fn()}
      selectedThemeId=""
      storefrontConfigured={false}
      themeInstallEnabled={false}
      themes={catalog}
      usage={usage}
    />,
  );
}

describe("ThemeLibraryScreen Appearance sections", () => {
  it("keeps the existing Themes list restricted to live packs", () => {
    const html = renderLibrary("live");

    expect(html).toContain(">Themes<");
    expect(html).toContain("Create Theme");
    expect(html).toContain("Live Theme");
    expect(html).not.toContain("Night Clock");
  });

  it("shows only screensaver packs and the screensaver create action", () => {
    const html = renderLibrary("screensaver");

    expect(html).toContain(">Screensavers<");
    expect(html).toContain("Create Screensaver");
    expect(html).toContain("Night Clock");
    expect(html).not.toContain("Live Theme");
  });

  it("shows a clear empty state when the catalog has no screensavers", () => {
    const html = renderLibrary("screensaver", [themes[0]]);

    expect(html).toContain("No screensavers yet");
    expect(html).toContain("Create a screensaver to add it to this list.");
    expect(html).toContain("Create Screensaver");
    expect(html).not.toContain("Reload catalog");
  });
});
