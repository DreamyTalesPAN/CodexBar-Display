import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompanionReleaseInfo } from "@/lib/companion-release";
import { MacAppDownloadScreen } from "./mac-app-download-screen";

const available = {
  status: "available",
  dmgDownloadStatus: "available",
  dmgDownloadUrl: "https://app.vibetv.shop/VibeTV.dmg",
} as CompanionReleaseInfo;

describe("MacAppDownloadScreen", () => {
  it("links the signed download when the release has one", () => {
    const html = renderToStaticMarkup(
      <MacAppDownloadScreen release={available} />,
    );

    expect(html).toContain('href="https://app.vibetv.shop/VibeTV.dmg"');
    expect(html).toContain("Open the downloaded DMG.");
  });

  it("says so instead of offering a dead link when no build is published", () => {
    const html = renderToStaticMarkup(<MacAppDownloadScreen release={null} />);

    expect(html).not.toContain("<a ");
    expect(html).toContain("The signed download is not ready yet.");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("does not offer a way back from the first page a customer sees", () => {
    expect(
      renderToStaticMarkup(<MacAppDownloadScreen release={available} />),
    ).not.toContain(">Back<");
  });
});
