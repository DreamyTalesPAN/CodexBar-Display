// @vitest-environment jsdom
//
// The Themes page shows an install error as "Theme action failed". The Windows
// app words the Companion's Mac texts its own way ("App", "this computer"),
// so the same error must read the same way there, and stay unchanged on a Mac.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlankThemeSpec } from "@/lib/theme-studio";
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
            assets: {},
            packName: "My Theme",
            spec: { ...createBlankThemeSpec(), themeId: "my-theme" },
            usage: "live" as const,
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

// The install of an own theme is refused by the Companion while the Mac App
// restarts; that refusal is what the Themes page shows as its error.
async function installOwnThemeRefused(windowsHost: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={{
          connected: true,
          paired: true,
          ready: true,
          capabilities: { theme: { supportsThemeSpecV1: true } },
        }}
        onInstallCustomTheme={async () => {
          throw new Error("Mac App is restarting.");
        }}
        onInstallTheme={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled
        themes={[catalogTheme]}
        usage="live"
        windowsHost={windowsHost}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[title="Install My Theme"]')!.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { text: document.body.textContent ?? "", cleanup: () => root.unmount() };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ThemeLibraryScreen install error wording", () => {
  it("reads App on Windows", async () => {
    const { text, cleanup } = await installOwnThemeRefused(true);
    expect(text).toContain("App is restarting.");
    expect(text).not.toContain("Mac App");
    await act(async () => cleanup());
  });

  it("keeps Mac App on a Mac", async () => {
    const { text, cleanup } = await installOwnThemeRefused(false);
    expect(text).toContain("Mac App is restarting.");
    await act(async () => cleanup());
  });
});
