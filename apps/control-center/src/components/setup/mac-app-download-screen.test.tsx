import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import { MacAppDownloadScreen } from "./mac-app-download-screen";

const available = {
  status: "available",
  dmgDownloadStatus: "available",
  dmgDownloadUrl: "https://app.vibetv.shop/VibeTV.dmg",
} as CompanionReleaseInfo;

const bothAvailable = {
  status: "available",
  dmgDownloadStatus: "available",
  dmgDownloadUrl: "https://app.vibetv.shop/VibeTV.dmg",
  windowsSetupDownloadStatus: "available",
  windowsSetupDownloadUrl: "https://app.vibetv.shop/VibeTV-Setup.exe",
} as CompanionReleaseInfo;

describe("MacAppDownloadScreen", () => {
  it("links the signed download when the release has one", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="macos" release={available} />,
    );

    expect(html).toContain('href="https://app.vibetv.shop/VibeTV.dmg"');
    expect(html).toContain("Open the downloaded DMG.");
  });

  it("says so instead of offering a dead link when no build is published", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="macos" release={null} />,
    );

    expect(html).not.toContain("<a ");
    expect(html).toContain("The signed download is not ready yet.");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("does not offer a way back from the first page a customer sees", () => {
    expect(
      renderToStaticMarkup(
        <MacAppDownloadScreen platform="macos" release={available} />,
      ),
    ).not.toContain(">Back<");
  });
});

describe("MacAppDownloadScreen on a recognised system", () => {
  it("keeps the Mac screen exactly as it is when macOS is recognised", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="macos" release={bothAvailable} />,
    );

    expect(html).toContain('href="https://app.vibetv.shop/VibeTV.dmg"');
    expect(html).toContain("Get the Mac App, then it takes you through the rest.");
    expect(html).toContain("Open the downloaded DMG.");
    expect(html).not.toContain("VibeTV-Setup.exe");
    expect(html).not.toContain("Windows");
  });

  it("offers the Windows installer with its own steps and a quiet Mac link", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="windows" release={bothAvailable} />,
    );

    expect(html).toContain('href="https://app.vibetv.shop/VibeTV-Setup.exe"');
    expect(html).toContain("Download for Windows");
    expect(html).toContain("Open the downloaded installer.");
    expect(html).not.toContain("Open the downloaded DMG.");
    expect(html).toContain("Using a Mac? Download for macOS");
    expect(html).toContain('href="https://app.vibetv.shop/VibeTV.dmg"');
  });

  it("keeps the existing not-ready state when no Windows build is published", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="windows" release={available} />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("The signed download is not ready yet.");
    expect(html).toContain("Download for Windows");
  });

  it("offers both ways when the browser says nothing usable", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="unknown" release={bothAvailable} />,
    );

    expect(html).toContain('href="https://app.vibetv.shop/VibeTV.dmg"');
    expect(html).toContain('href="https://app.vibetv.shop/VibeTV-Setup.exe"');
  });

  it("gives the Windows screen exactly one primary action", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen platform="windows" release={bothAvailable} />,
    );
    const macLinkIsQuiet = /<a[^>]*text-muted-foreground[^>]*VibeTV\.dmg|VibeTV\.dmg[^>]*>\s*Using a Mac/.test(
      html,
    );

    expect(macLinkIsQuiet || html.includes("Using a Mac? Download for macOS")).toBe(
      true,
    );
    expect(html.match(/Download for Windows/g)).toHaveLength(1);
  });
});
