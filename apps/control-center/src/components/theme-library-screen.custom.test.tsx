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
import {
  buildThemePack,
  createBlankThemeSpec,
  validateThemeSpec,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";
import { rememberSentOwnThemePath } from "@/lib/sent-own-theme-paths";
import type { ThemeProduct } from "@/lib/themes";
import {
  ThemeLibraryScreen,
  type ThemeInstallStatus,
  type ThemeLibraryScreenProps,
} from "./theme-library-screen";

// The customer's own screensaver as it is saved in the library.
const ownScreensaver = {
  assets: {},
  packName: "My Screensaver",
  spec: { ...createBlankThemeSpec(), themeId: "my-screensaver" },
  usage: "screensaver" as const,
};

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
        { id: "u-2", updatedAt: "2026-07-01T00:00:00Z", document: ownScreensaver },
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

async function renderLibrary(
  themes: ThemeProduct[] = [catalogTheme],
  props: Partial<ThemeLibraryScreenProps> = {},
) {
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
        {...props}
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

  // Both rows share the id, so only the file VibeTV holds tells them apart.
  // Judged by the id alone, installing one marked both as installed and the
  // customer could not switch to the other.
  it("marks only the row whose file VibeTV holds when an own and a catalog theme share an id", async () => {
    const namesake: ThemeProduct = {
      ...catalogTheme,
      id: "my-theme",
      themeId: "my-theme",
      themeSpecPath: "/themes/u/mt-4-abcdef.json",
      title: "Catalog Namesake",
    };
    const ownPath = validateThemeSpec({
      themeId: "my-theme",
      usage: "live",
    } as unknown as ThemeStudioSpec).themeSpecPath;
    const installTitle = (title: string) =>
      document
        .querySelector(`[aria-label="Preview ${title}"]`)!
        .closest('[role="listitem"]')!
        .querySelector<HTMLButtonElement>('button[title*="nstall"]')!.title;
    const render = (path: string, props: Partial<ThemeLibraryScreenProps> = {}) =>
      renderLibrary([catalogTheme, namesake], {
        device: {
          activeTheme: "my-theme",
          capabilities: { theme: { supportsThemeSpecV1: true } },
          connected: true,
          display: { themeSpec: { path } },
          paired: true,
          ready: true,
        },
        themeInstallEnabled: true,
        ...props,
      });

    const own = await render(ownPath);
    expect(installTitle("My Theme")).toBe("Theme is already installed.");
    expect(installTitle("Catalog Namesake")).toBe("Install Catalog Namesake");
    await act(async () => own.cleanup());
    document.body.innerHTML = "";

    const catalog = await render(namesake.themeSpecPath!);
    expect(installTitle("My Theme")).toBe("Install My Theme");
    expect(installTitle("Catalog Namesake")).toBe("Theme is already installed.");
    await act(async () => catalog.cleanup());
    document.body.innerHTML = "";

    // An install from here is known before VibeTV reports it.
    const justInstalled = await render(namesake.themeSpecPath!, {
      lastInstall: {
        activePath: ownPath,
        name: "My Theme",
        packId: "my-theme-1",
        themeId: "my-theme",
        themeRev: 1,
      },
    });
    expect(installTitle("My Theme")).toBe("Theme is already installed.");
    expect(installTitle("Catalog Namesake")).toBe("Install Catalog Namesake");
    await act(async () => justInstalled.cleanup());
    document.body.innerHTML = "";

    // The own theme's file from before it was changed and saved again is
    // neither row's; an older revision of the catalog theme is the catalog's.
    const earlierOwn = await render("/themes/u/my-them-1-0a1b2c.json");
    expect(installTitle("My Theme")).toBe("Install My Theme");
    expect(installTitle("Catalog Namesake")).toBe("Install Catalog Namesake");
    await act(async () => earlierOwn.cleanup());
    document.body.innerHTML = "";

    const olderCatalog = await render("/themes/u/mt-3-123456.json");
    expect(installTitle("My Theme")).toBe("Install My Theme");
    expect(installTitle("Catalog Namesake")).toBe("Theme is already installed.");
    await act(async () => olderCatalog.cleanup());
  });

  // The customer's theme had the id of a later catalog theme, was sent, and
  // then edited and saved under another id. VibeTV still reports the shared id
  // and the file that was sent, whose name starts like the catalog theme's.
  it("offers Install for a catalog theme while VibeTV holds a file this app sent for an own theme", async () => {
    window.localStorage.clear();
    const miniClassic: ThemeProduct = {
      ...catalogTheme,
      id: "mini-classic",
      themeId: "mini-classic",
      themeSpecPath: "/themes/u/mini-cl-9-6d1af3.json",
      title: "Mini Classic",
    };
    const sentPath = "/themes/u/mini-cl-1-0a1b2c.json";
    const render = () =>
      renderLibrary([miniClassic], {
        device: {
          activeTheme: "mini-classic",
          capabilities: { theme: { supportsThemeSpecV1: true } },
          connected: true,
          display: { themeSpec: { path: sentPath } },
          paired: true,
          ready: true,
        },
        themeInstallEnabled: true,
      });

    // Not known as sent from here, the file passes for an old revision.
    const unknown = await render();
    expect(unknown.html).toContain("Theme is already installed.");
    await act(async () => unknown.cleanup());
    document.body.innerHTML = "";

    rememberSentOwnThemePath(sentPath);
    const own = await render();
    expect(own.html).toContain('title="Install Mini Classic"');
    expect(own.html).not.toContain("Theme is already installed.");
    await act(async () => own.cleanup());
    window.localStorage.clear();
  });

  it("shows the install progress only in the row that was installed when two rows share an id", async () => {
    const namesake: ThemeProduct = {
      ...catalogTheme,
      id: "my-theme",
      themeId: "my-theme",
      themeSpecPath: "/themes/my-them-4-abcdef.json",
      title: "Catalog Namesake",
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    // The app answers once the install is through, and with whether it worked.
    let finishInstall: (installed: boolean) => void = () => {};
    const install = () =>
      new Promise<boolean>((resolve) => {
        finishInstall = resolve;
      });
    const screen = (installStatus?: ThemeInstallStatus, heldPath?: string) => (
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={{
          activeTheme: heldPath ? "my-theme" : "live-theme",
          capabilities: { theme: { supportsThemeSpecV1: true } },
          connected: true,
          display: { themeSpec: { path: heldPath } },
          paired: true,
          ready: true,
        }}
        installStatus={installStatus}
        onInstallCustomTheme={async () => false}
        onInstallTheme={install}
        onSaveStandby={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled
        themes={[catalogTheme, namesake]}
        usage="live"
      />
    );
    const row = (title: string) =>
      document
        .querySelector(`[aria-label="Preview ${title}"]`)!
        .closest<HTMLElement>('[role="listitem"]')!;
    await act(async () => {
      root.render(screen());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      row("Catalog Namesake")
        .querySelector<HTMLButtonElement>('button[title="Install Catalog Namesake"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      root.render(
        screen({
          logs: [],
          phase: "installing",
          startedAt: "10:00:00",
          themeId: "my-theme",
          title: "Catalog Namesake",
        }),
      );
    });

    expect(row("Catalog Namesake").textContent).toContain("Installing");
    expect(row("My Theme").textContent).not.toContain("Installing");

    // A later install that no row started, here Send to VibeTV in Theme
    // Studio, is not the pressed row's; the automatic update is another. While
    // it runs nothing tells which of the two it installs; finished, it is
    // shown in the row whose file VibeTV holds.
    await act(async () => finishInstall(true));
    const fromElsewhere: ThemeInstallStatus = {
      logs: [],
      phase: "installing",
      startedAt: "10:05:00",
      themeId: "my-theme",
      title: "My Theme",
    };
    await act(async () => root.render(screen(fromElsewhere)));
    expect(row("My Theme").textContent).toContain("Installing");

    const ownPath = validateThemeSpec({
      themeId: "my-theme",
      usage: "live",
    } as unknown as ThemeStudioSpec).themeSpecPath;
    await act(async () =>
      root.render(screen({ ...fromElsewhere, phase: "complete" }, ownPath)),
    );
    expect(row("My Theme").textContent).toContain("Theme is active on VibeTV.");
    expect(row("Catalog Namesake").textContent).not.toContain(
      "Theme is active on VibeTV.",
    );
    await act(async () => root.unmount());
  });

  // VibeTV names its screensaver only by the path of the theme file. For the
  // customer's own screensaver that is the path its file is sent under.
  it("keeps the customer's own screensaver installed after a theme was installed", async () => {
    const sentPath = buildThemePack(
      ownScreensaver.spec,
      ownScreensaver.packName,
      ownScreensaver.assets,
      "screensaver",
    ).manifest.themeSpec.path;
    const render = (screensaverPath: string) =>
      renderLibrary([catalogTheme], {
        device: { connected: true, paired: true, ready: true, standby: { screensaverPath } },
        lastInstall: {
          activePath: "/themes/u/live-th-3-1a2b3c.json",
          name: "Live Theme",
          packId: "live-theme-3",
          themeId: "live-theme",
          themeRev: 3,
        },
        standby: { enabled: true, timeoutMinutes: 10, brightnessPercent: 20 },
        themeInstallEnabled: true,
        usage: "screensaver",
      });

    const installed = await render(sentPath);
    expect(installed.html).toContain("My Screensaver");
    expect(installed.html).toContain("Theme is already installed.");
    await act(async () => installed.cleanup());

    const other = await render("/themes/s/other-1-abc123.json");
    expect(other.html).not.toContain("Theme is already installed.");
    await act(async () => other.cleanup());
  });
});
