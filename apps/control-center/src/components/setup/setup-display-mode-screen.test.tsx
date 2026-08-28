import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
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
        sessionPercent: 64,
        weeklyPercent: null,
      }}
      manualPreview={{
        providerLabel: "Claude",
        resetLabel: null,
        sessionPercent: null,
        weeklyPercent: 12,
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
function panels(html: string): { automatic: string; manual: string } {
  const parts = html.split('bg-[#161616]');
  return { automatic: parts[1] ?? "", manual: parts[2] ?? "" };
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

  it("names every provider Automatic moves through", () => {
    const tile = panels(render()).automatic;

    expect(tile).toContain("Codex");
    expect(tile).toContain("Cursor");
  });

  it("takes the rotation from the previews when it gets them", () => {
    const tile = panels(
      render({
        automaticPreviews: [
          {
            providerLabel: "Claude",
            resetLabel: "Resets in 1h",
            sessionPercent: 7,
            weeklyPercent: 3,
          },
          {
            providerLabel: "Copilot",
            resetLabel: null,
            sessionPercent: null,
            weeklyPercent: null,
          },
        ],
        providers: [codex, cursor],
      }),
    ).automatic;

    expect(tile).toContain("Claude");
    expect(tile).toContain("Copilot");
    expect(tile).not.toContain("Cursor");
  });

  it("stands still on the first provider until motion is allowed", () => {
    // Server output is also what a reduced-motion Mac renders: one provider is
    // held, and the strip still names the whole rotation.
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
    expect(manual).toContain("Reset unavailable");
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
});
