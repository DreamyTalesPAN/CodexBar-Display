// @vitest-environment jsdom
//
// The customer's own themes only appear after the storage read in an effect,
// which renderToStaticMarkup never runs. Their row carried the two controls
// that used to be hidden in setup mode -- the Custom badge and Delete -- so
// without this the Appearance tab's custom rows had no coverage at all.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThemeProduct } from "@/lib/themes";
import { ThemeLibraryScreen } from "./theme-library-screen";

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({
    ok: true,
    value: {
      themes: [
        {
          id: "u-1",
          updatedAt: "2026-07-01T00:00:00Z",
          document: {
            packName: "My Theme",
            spec: { themeId: "my-theme", usage: "live" },
          },
        },
      ],
    },
  }),
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

const catalogTheme: ThemeProduct = {
  id: "live-theme",
  isFree: true,
  packSha256: "a".repeat(64),
  packSizeBytes: 100,
  packUrl: "https://example.com/live.zip",
  priceLabel: "Free",
  source: "github-catalog",
  themeId: "live-theme",
  title: "Live Theme",
  usage: "live",
};

async function renderLibrary() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={null}
        onInstallCustomTheme={async () => false}
        onInstallTheme={vi.fn()}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled={false}
        themes={[catalogTheme]}
        usage="live"
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { html: host.innerHTML, cleanup: () => root.unmount() };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ThemeLibraryScreen custom themes", () => {
  it("marks a theme the customer made and offers to delete it", async () => {
    const { html, cleanup } = await renderLibrary();

    expect(html).toContain("My Theme");
    expect(html).toContain("Custom");
    expect(html).toContain('aria-label="Delete My Theme"');
    await act(async () => cleanup());
  });

  it("keeps the catalog theme alongside it, without a delete action", async () => {
    const { html, cleanup } = await renderLibrary();

    expect(html).toContain("Live Theme");
    expect(html).not.toContain('aria-label="Delete Live Theme"');
    await act(async () => cleanup());
  });
});
