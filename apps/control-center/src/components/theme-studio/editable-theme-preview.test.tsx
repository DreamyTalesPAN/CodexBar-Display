// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import type { ThemeRenderPack } from "../live-vibetv-preview";
import { EditableThemePreview } from "./editable-theme-preview";

vi.mock("../live-vibetv-preview", () => ({ ThemeSpecPreview: () => null }));
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  SVGElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("does not turn a canvas layout shift into element movement", () => {
  const onMoveMany = vi.fn();
  const view = render(<EditableThemePreview
    spec={{ ...createBlankThemeSpec(), primitives: [{type:"progress", x:12, y:154, width:216, height:13}] }}
    pack={{} as ThemeRenderPack} selectedIndex={-1} selectedIndices={[]}
    onSelect={vi.fn()} onSelectMany={vi.fn()} onResize={vi.fn()}
    onInteractionStart={vi.fn()} onInteractionCommit={vi.fn()} onInteractionCancel={vi.fn()}
    onMoveMany={onMoveMany}
  />);
  const svg = view.getByLabelText("Editable 240x240 preview");
  const rect = vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 100, 320, 320));
  fireEvent.pointerDown(view.getByRole("button", {name:"Select progress 1"}), {clientX:200, clientY:310});
  rect.mockReturnValue(new DOMRect(50, 80, 305, 305));
  fireEvent.pointerMove(svg, {clientX:200, clientY:310});
  expect(onMoveMany).toHaveBeenLastCalledWith([{index:0, x:12, y:154}]);
  fireEvent.pointerMove(svg, {clientX:216, clientY:326});
  expect(onMoveMany).toHaveBeenLastCalledWith([{index:0, x:24, y:166}]);
  fireEvent.pointerUp(svg);
});
