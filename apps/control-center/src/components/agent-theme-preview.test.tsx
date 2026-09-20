// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ThemeSpecPreview,
  THEME_CATALOG_PREVIEW_FRAME,
  type ThemeRenderPack,
} from "./live-vibetv-preview";

const cancel = vi.fn();
const animate = vi.fn<
  (
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => { cancel: typeof cancel }
>(() => ({ cancel }));
const pack: ThemeRenderPack = {
  spec: { id: "fallback", p: [{ t: "tx", x: 0, y: 0, b: "l" }] },
  assets: {},
};
function view(
  activity: string,
  extra = {},
  selectedPack = pack,
  themeId = "fallback",
) {
  return (
    <ThemeSpecPreview
      themeId={themeId}
      status="ready"
      pack={selectedPack}
      animate
      frame={{
        ...THEME_CATALOG_PREVIEW_FRAME,
        provider: "claude",
        agentName: "Codex",
        activity,
        ...extra,
      }}
    />
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  Element.prototype.animate =
    animate as unknown as typeof Element.prototype.animate;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("agent theme announcements", () => {
  it("uses the observed agent, with two hard pulses only on grouped state changes", () => {
    const result = render(view("idle"));
    expect(animate).not.toHaveBeenCalled();
    result.rerender(view("working"));
    expect(result.container.textContent).toContain("Codex is working");
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]).toEqual([
      [
        { filter: "invert(1)", offset: 0, easing: "step-end" },
        { filter: "invert(0)", offset: 200 / 550, easing: "step-end" },
        { filter: "invert(1)", offset: 350 / 550, easing: "step-end" },
        { filter: "invert(0)", offset: 1 },
      ],
      { duration: 550 },
    ]);
    result.rerender(view("tool_use", { session: 99, label: "Claude" }));
    expect(animate).toHaveBeenCalledTimes(1);
    result.rerender(view("waiting_for_answer"));
    expect(animate).toHaveBeenCalledTimes(2);
    result.rerender(view("waiting_for_review"));
    expect(animate).toHaveBeenCalledTimes(2);
    result.rerender(view("unavailable"));
    expect(result.container.textContent).toContain("Agent status unavailable");
    expect(animate).toHaveBeenCalledTimes(2);
  });
  it("cancels on animation-off and does not replay on re-enable or theme switch", () => {
    const result = render(view("idle"));
    result.rerender(view("working"));
    result.rerender(view("working", { animationsDisabled: true }));
    expect(cancel).toHaveBeenCalled();
    result.rerender(view("working"));
    result.rerender(view("done", {}, pack, "other-theme"));
    expect(animate).toHaveBeenCalledTimes(1);
  });
  it("keeps dedicated sprites and reduced motion quiet", () => {
    const dedicated: ThemeRenderPack = {
      ...pack,
      spec: {
        ...pack.spec,
        p: [...pack.spec!.p!, { t: "sp", sa: { done: "/done.cbi" } }],
      },
    };
    const result = render(view("idle", {}, dedicated));
    result.rerender(view("done", {}, dedicated));
    expect(animate).not.toHaveBeenCalled();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
    } as MediaQueryList);
    result.rerender(view("error"));
    expect(animate).not.toHaveBeenCalled();
  });
});
