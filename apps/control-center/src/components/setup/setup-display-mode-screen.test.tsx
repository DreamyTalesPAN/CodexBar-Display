import { displayPreviewFor } from "./setup-display-previews";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SetupDisplayModeScreen,
  type SetupDisplayModeProvider,
} from "./setup-display-mode-screen";

vi.mock("../theme-render-preview", () => ({
  ThemeRenderPreview: ({ themeId, frame }: { themeId: string; frame: import("../live-vibetv-preview").FrameData }) =>
    <span data-theme={themeId} data-provider={frame.provider} data-session={frame.session} data-week-unavailable={String(frame.weeklyUnavailable)} />,
}));

const codex: SetupDisplayModeProvider = { id: "codex", label: "Codex" };
const cursor: SetupDisplayModeProvider = { id: "cursor", label: "Cursor" };

function render(
  props: Partial<Parameters<typeof SetupDisplayModeScreen>[0]> = {},
) {
  return renderToStaticMarkup(
    <SetupDisplayModeScreen
      automaticPreview={{
        providerLabel: "Codex",
        resetLabel: "Resets in 2h 10m",
        windows: [{ label: "Session", percent: 64 }, { label: "Weekly", percent: null }],
      }}
      manualPreview={{
        providerLabel: "Claude",
        resetLabel: null,
        windows: [{ label: "Session", percent: null }, { label: "Weekly", percent: 12 }],
      }}
      mode="automatic"
      onContinue={vi.fn()}
      onSelectMode={vi.fn()}
      onSelectProvider={vi.fn()}
      providers={[codex, cursor]}
      selectedProviderId={codex.id}
      {...props}
    />,
  );
}

describe("SetupDisplayModeScreen", () => {
  it("explains both display modes", () => {
    const html = render();

    expect(html).toContain("Automatic");
    expect(html).toContain(
      "VibeTV switches between your providers based on recent activity and usage.",
    );
    expect(html).toContain("Manual");
    expect(html).toContain(
      "VibeTV always shows the one provider you pick — nothing else.",
    );
  });

  it("offers the provider list only in Manual", () => {
    const automatic = render();
    expect(automatic).not.toContain("Show this provider");

    const manual = render({ mode: "fixed" });
    expect(manual).toContain("Show this provider");
    expect(manual).toContain("Codex");
  });

  it("lists only the providers it was given", () => {
    const html = render({ mode: "fixed", providers: [codex] });

    expect(html).toContain("Codex");
    expect(html).not.toContain("Cursor");
    expect(html).not.toContain("Copilot");
  });

  it("renders the selected theme with each provider's actual frame", () => {
    const codexPreview = displayPreviewFor({ id: "codex", label: "Codex", session: 64, weekly: 0, weeklyUnavailable: true, usageMode: "used" });
    const claudePreview = displayPreviewFor({ id: "claude", label: "Claude", session: 12, weekly: 3, usageMode: "used" });
    const html = render({ previewTheme: { id: "tiny-office", name: "Tiny Office", themeSpecPath: "/themes/office.json" },
      automaticPreview: codexPreview, manualPreview: claudePreview });
    expect(html.match(/data-theme="tiny-office"/g)).toHaveLength(2);
    expect(html).toContain('data-provider="codex" data-session="64" data-week-unavailable="true"');
    expect(html).toContain('data-provider="claude" data-session="12"');
  });

  it("rotates from the caller's provider list without lending missing readings", () => {
    const html = render({ previewTheme: { id: "clippy", name: "Clippy" }, providers: [cursor, codex] });
    expect(html).toContain('data-provider="" data-session="0" data-week-unavailable="true"');
  });

  it("shows a missing theme as unavailable", () => {
    expect(render()).toContain("Theme preview unavailable");
  });

  it("offers one Continue action", () => {
    expect(render()).toContain("Continue");
  });

  // The screen used to take a second Continue, and a changed selection with
  // it, while the first write was still on its way: two writes raced, the
  // first to answer released the step, and what VibeTV kept was whichever
  // landed last rather than what the customer had chosen.
  it("takes nothing more while the choice is being written", () => {
    const html = render({
      mode: "fixed",
      providers: [codex, cursor],
      saving: true,
      selectedProviderId: "codex",
    });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
    // The mode cards and the provider rows are closed with it, so the choice
    // cannot change out from under the write that is running.
    expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*aria-pressed=/);
  });


  // A saved choice whose provider has since been switched off is what sends the
  // customer back to this step, and it arrives naming a provider the list no
  // longer has: no card drawn as chosen, and a Continue that resubmitted the
  // same provider the companion had just refused.
  it("waits for a provider that is actually on offer", () => {
    const html = render({
      mode: "fixed",
      providers: [cursor],
      selectedProviderId: "codex",
    });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
  });

});
