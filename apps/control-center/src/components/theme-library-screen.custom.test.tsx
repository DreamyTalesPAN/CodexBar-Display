// @vitest-environment jsdom
//
// The customer's own themes only appear after the storage read in an effect,
// which renderToStaticMarkup never runs. Their row carried the two controls
// that used to be hidden in setup mode -- the Custom badge and Delete -- so
// without this the Appearance tab's custom rows had no coverage at all.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
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

async function renderLibrary(themes: ThemeProduct[] = [catalogTheme]) {
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
        themes={themes}
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

  it("has no accessibility violations with the delete question open, and focus returns from it", async () => {
    const { html, cleanup } = await renderLibrary();
    await expectNoAxeViolations(html);
    const opener = document.querySelector<HTMLButtonElement>('[aria-label="Delete My Theme"]')!;
    opener.focus();
    await act(async () => opener.click());
    const question = document.querySelector('[role="alertdialog"]')!;
    expect(question.contains(document.activeElement)).toBe(true);
    await expectNoAxeViolations(document.body.innerHTML);
    // Cancel has focus.
    await act(async () => {
      (document.activeElement as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(opener);
    await act(async () => cleanup());
  });

  // Issue #551: Save keeps a new theme's id clear of the catalog, but a later
  // catalog can add a theme under an id the customer already used. Both rows
  // were then listed under the same React key.
  it("lists an own theme and a later catalog theme with the same id as two rows", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { html, cleanup } = await renderLibrary([
      catalogTheme,
      { ...catalogTheme, id: "my-theme", themeId: "my-theme", title: "Catalog Namesake" },
    ]);

    expect(html).toContain('aria-label="Preview My Theme"');
    expect(html).toContain('aria-label="Preview Catalog Namesake"');
    expect(errors.mock.calls.flat().join(" ")).not.toContain("same key");
    errors.mockRestore();
    await act(async () => cleanup());
  });
});
