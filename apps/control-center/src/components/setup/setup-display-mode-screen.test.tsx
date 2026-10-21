import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { displayPreviewsFor } from "./setup-display-previews";
import type { DisplayFrame } from "../live-vibetv-preview";
import {
  DisplayModeChoice,
  SetupDisplayModeScreen,
  type SetupDisplayModeProvider,
} from "./setup-display-mode-screen";

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
        pinnedFrame: { label: "Claude", weekly: 12, sessionUnavailable: true },
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

/** The two device panels, in render order: Automatic's, then Manual's. */
// Split on the slot rather than on a style value: the panel has been
// restyled once already, and a test that reads colours breaks every time.
function panels(html: string): { automatic: string; manual: string } {
  const parts = html.split('data-slot="display-mode-preview"');
  return { automatic: parts[1] ?? "", manual: parts[2] ?? "" };
}

describe("SetupDisplayModeScreen", () => {
  const companionTile = (automatic: DisplayFrame, pinned = automatic) => {
    const previews = displayPreviewsFor({ providers: [{
      id: "codex", label: "Codex", session: 91, weekly: 82, resetSecs: 60,
      usageMode: "used", collectedAt: "2026-10-20T08:00:00Z",
      windows: [{ id: "weekly", label: "A long window label with more bytes", usedPercent: 91, resetSecs: 7200 }],
    }] }, [codex], {
      generatedAt: new Date().toISOString(),
      providers: [{ id: "codex", automatic, pinned }],
    });
    return panels(render({
      automaticPreviews: previews, manualPreview: previews[0], providers: [codex],
    }));
  };

  it("uses the companion's re-anchored root reset and 24-byte window label in the plain tiles", () => {
    const label = "A long window label with";
    expect(new TextEncoder().encode(label)).toHaveLength(24);
    const { automatic, manual } = companionTile({
      resetSecs: 5400,
      usageWindows: [{ id: "weekly", label, percent: 37, resetSecs: 5400 }],
    }, {
      resetSecs: 3600,
      usageWindows: [{ id: "weekly", label, percent: 63, resetSecs: 3600 }],
    });
    expect(automatic).toContain("Reset in 1h 30m");
    expect(manual).toContain("Reset in 1h 0m");
    for (const tile of [automatic, manual]) {
      expect(tile).toContain(`${label}</span>`);
      expect(tile).not.toContain("more bytes");
      expect(tile).not.toContain("91<span");
    }
    expect(automatic).toContain("37<span");
    expect(manual).toContain("63<span");
  });

  it("keeps the companion's unavailable frame unavailable despite a populated usage snapshot", () => {
    const { automatic, manual } = companionTile({
      usageUnavailable: true, resetSecs: 0,
      sessionUnavailable: true, weeklyUnavailable: true,
    });
    for (const tile of [automatic, manual]) {
      expect(tile).toContain("Reset unavailable");
      expect(tile).toContain("--");
      expect(tile).not.toContain("91<span");
    }
  });

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

  // The row stretches both cards to one height. Centred, the card with the
  // shorter description showed its preview 9 px lower (#548).
  it("holds both previews at the top of their cards", () => {
    const cards = render().match(/<button[^>]*aria-pressed[^>]*>/g) ?? [];

    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toContain("flex-col");
      expect(card).not.toContain("items-center");
    }
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

  it("rests on the first provider of the rotation, and only that one", () => {
    const tile = panels(render()).automatic;

    expect(tile).toContain("Codex");
    expect(tile).not.toContain("Cursor");
  });

  it("takes the rotation from the previews when it gets them", () => {
    const tile = panels(
      render({
        automaticPreviews: [
          {
            providerLabel: "Claude",
            resetLabel: "Resets in 1h",
            windows: [{ label: "Session", percent: 7 }, { label: "Weekly", percent: 3 }],
          },
          {
            providerLabel: "Copilot",
            resetLabel: null,
            windows: [{ label: "Session", percent: null }, { label: "Weekly", percent: null }],
          },
        ],
        providers: [codex, cursor],
      }),
    ).automatic;

    // The rotation the caller handed over wins over the enabled providers, and
    // it starts on that list's first entry.
    expect(tile).toContain("Claude");
    expect(tile).not.toContain("Copilot");
    expect(tile).not.toContain("Cursor");
  });

  it("stands still on the first provider until motion is allowed", () => {
    // Server output is also what a reduced-motion Mac renders: the first
    // provider, held.
    const tile = panels(render()).automatic;

    expect(tile).toContain("Resets in 2h 10m");
    expect(tile).toContain("64");
    expect(tile).not.toContain("vibetv-preview-hold-sweep");
  });

  it("keeps usage it was not given visibly unavailable", () => {
    const { automatic, manual } = panels(render());

    // Codex's session was read; its week was not.
    expect(automatic).toContain("64");
    expect(automatic).toContain("--");
    // Manual's provider has no reset reading at all.
    expect(manual).toContain("Reset unknown");
  });

  it("never lends one provider's numbers to another", () => {
    // Cursor leads the rotation and has no reading of its own, so the panel it
    // holds carries no numbers - Codex's 64% waits for Codex's turn.
    const { automatic } = panels(render({ providers: [cursor, codex] }));

    expect(automatic).toContain("Cursor");
    expect(automatic).toContain("--");
    expect(automatic).not.toContain("64");
  });

  it("holds Manual on the one provider it was pinned to", () => {
    const { manual } = panels(render());

    expect(manual).toContain("Claude");
    expect(manual).not.toContain("Cursor");
    expect(manual).toContain("12%");
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


  it("draws the round mark only in Setup; Settings keeps the plain check", () => {
    const choice = (calm: boolean) =>
      renderToStaticMarkup(
        <DisplayModeChoice
          calm={calm}
          automaticPreview={null}
          manualPreview={null}
          mode="automatic"
          onSelectMode={vi.fn()}
          onSelectProvider={vi.fn()}
          providers={[codex, cursor]}
          selectedProviderId={codex.id}
        />,
      );
    expect(choice(false)).not.toContain("rounded-full");
    expect(choice(true)).toContain("rounded-full");
    expect(render()).toContain("rounded-full");
  });
});
