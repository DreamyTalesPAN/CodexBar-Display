// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBlankThemeSpec, type ThemeStudioPrimitive } from "@/lib/theme-studio";
import type { ThemeRenderPack } from "../live-vibetv-preview";
import { EditableThemePreview } from "./editable-theme-preview";

vi.mock("../live-vibetv-preview", () => ({ ThemeSpecPreview: () => null }));
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.setPointerCapture = vi.fn();
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

function renderCafe() {
  const primitives: ThemeStudioPrimitive[] = [
    { type: "sprite", assetPath: "/themes/u/ai-screen.cbi", x: 0, y: 0, width: 240, height: 240 },
    { type: "sprite", assetPath: "/themes/u/ai-pet-1.cba", x: 38, y: 142, width: 48, height: 48 },
    { type: "sprite", assetPath: "/themes/u/ai-pet-2.cba", x: 154, y: 105, width: 48, height: 48 },
  ];
  const props = {
    spec: { ...createBlankThemeSpec(), primitives }, pack: {} as ThemeRenderPack,
    selectedIndex: -1, selectedIndices: [] as number[],
    onSelect: vi.fn(), onSelectMany: vi.fn(), onResize: vi.fn(), onMoveMany: vi.fn(),
    onInteractionStart: vi.fn(), onInteractionCommit: vi.fn(), onInteractionCancel: vi.fn(),
  };
  const view = render(<EditableThemePreview {...props} />);
  const svg = view.getByLabelText("Editable 240x240 preview");
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 240, 240));
  return { props, view, svg, background: view.getByRole("button", { name: "Select sprite 1" }) };
}

it("draws a marquee over background artwork and moves both selected cats together", () => {
  const { props, view, svg, background } = renderCafe();
  fireEvent.pointerDown(background, { clientX: 20, clientY: 90 });
  fireEvent.pointerMove(svg, { clientX: 210, clientY: 200 });
  expect(props.onMoveMany).not.toHaveBeenCalled();
  expect(view.queryByTestId("selection-box")).not.toBeNull();
  fireEvent.pointerUp(svg, { clientX: 210, clientY: 200 });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([1, 2]);
  expect(props.onInteractionStart).not.toHaveBeenCalled();
  view.rerender(<EditableThemePreview {...props} selectedIndex={2} selectedIndices={[1, 2]} />);
  fireEvent.pointerDown(view.getByRole("button", { name: "Select sprite 2" }), { clientX: 50, clientY: 160 });
  fireEvent.pointerMove(svg, { clientX: 60, clientY: 165 });
  fireEvent.pointerUp(svg, { clientX: 60, clientY: 165 });
  expect(props.onMoveMany).toHaveBeenLastCalledWith([{ index: 1, x: 48, y: 147 }, { index: 2, x: 164, y: 110 }]);
  expect(props.onInteractionStart).toHaveBeenCalledOnce();
  expect(props.onInteractionCommit).toHaveBeenCalledOnce();
});

it("selects in reverse direction using the release position and leaves the background out", () => {
  const { props, svg, background } = renderCafe();
  fireEvent.pointerDown(background, { clientX: 210, clientY: 200 });
  fireEvent.pointerUp(svg, { clientX: 20, clientY: 90 });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([1, 2]);
});

it("still selects the background on a click, including additive selection", () => {
  const { props, svg, background } = renderCafe();
  fireEvent.pointerDown(background, { clientX: 20, clientY: 20, metaKey: true });
  fireEvent.pointerUp(svg, { clientX: 20, clientY: 20, metaKey: true });
  expect(props.onSelect).toHaveBeenLastCalledWith(0, true);
});

it("can extend a selection with a marquee while excluding locked elements", () => {
  const { props, view, svg, background } = renderCafe();
  view.rerender(<EditableThemePreview {...props} selectedIndex={1} selectedIndices={[1]} />);
  fireEvent.pointerDown(background, { clientX: 150, clientY: 100, shiftKey: true });
  fireEvent.pointerUp(svg, { clientX: 210, clientY: 160, shiftKey: true });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([1, 2]);
  view.rerender(<EditableThemePreview {...props} nonInteractiveIndices={[2]} />);
  fireEvent.pointerDown(background, { clientX: 20, clientY: 90 });
  fireEvent.pointerUp(svg, { clientX: 210, clientY: 200 });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([1]);
});

it("starts a visible marquee outside the display and moves the enclosed elements", () => {
  const { props, view, svg } = renderCafe();
  const surface = view.getByLabelText("Selection workspace");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 400));
  vi.mocked(svg.getBoundingClientRect).mockReturnValue(new DOMRect(80, 80, 240, 240));
  fireEvent.pointerDown(surface, { clientX: 40, clientY: 40, button: 0 });
  fireEvent.pointerMove(surface, { clientX: 350, clientY: 350 });
  const box = view.getByTestId("selection-box");
  expect(box.style.left).toBe("40px");
  expect(box.style.top).toBe("40px");
  expect(box.style.width).toBe("310px");
  fireEvent.pointerUp(surface, { clientX: 350, clientY: 350 });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([1, 2]);
  expect(props.onMoveMany).not.toHaveBeenCalled();
  fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.pointerUp(surface, { clientX: 40, clientY: 40 });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([]);
});

it("clears an empty marquee and cancels an unfinished one without changing the design", () => {
  const { props, view, svg, background } = renderCafe();
  fireEvent.pointerDown(background, { clientX: 5, clientY: 5 });
  fireEvent.pointerUp(svg, { clientX: 20, clientY: 20 });
  expect(props.onSelectMany).toHaveBeenLastCalledWith([]);
  props.onSelectMany.mockClear();
  fireEvent.pointerDown(background, { clientX: 20, clientY: 90 });
  fireEvent.pointerMove(svg, { clientX: 210, clientY: 200 });
  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.pointerUp(svg, { clientX: 210, clientY: 200 });
  expect(props.onSelectMany).not.toHaveBeenCalled();
  expect(props.onMoveMany).not.toHaveBeenCalled();
  expect(view.queryByTestId("selection-box")).toBeNull();
});


it("starts selection in the full workspace above and below the preview", () => {
  const { props, view, svg } = renderCafe();
  const surface = view.getByLabelText("Selection workspace");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 600, 800));
  vi.mocked(svg.getBoundingClientRect).mockReturnValue(new DOMRect(280, 380, 240, 240));
  // Both starts are far beyond the old 32px preview padding.
  for (const [startX, startY, endX, endY] of [[110, 110, 650, 800], [650, 890, 110, 110]]) {
    fireEvent.pointerDown(surface, { clientX: startX, clientY: startY, button: 0 });
    fireEvent.pointerMove(surface, { clientX: endX, clientY: endY });
    const box = view.getByTestId("selection-box");
    expect(box.style.left).toBe("10px");
    expect(box.style.top).toBe("10px");
    fireEvent.pointerUp(surface, { clientX: endX, clientY: endY });
    expect(props.onSelectMany).toHaveBeenLastCalledWith([1, 2]);
  }
  expect(props.onMoveMany).not.toHaveBeenCalled();
});

it("keeps toolbar buttons and element fields usable without starting selection", () => {
  const { props, view } = renderCafe();
  const onUndo = vi.fn();
  view.rerender(<EditableThemePreview {...props} toolbar={<button onClick={onUndo}>Undo</button>}>
    <div data-selection-controls><label>Width<input defaultValue="48" /></label></div>
  </EditableThemePreview>);
  for (const target of [view.getByRole("button", { name: "Undo" }), view.getByLabelText("Width"), view.getByText("Width")]) {
    fireEvent.pointerDown(target, { clientX: 20, clientY: 20, button: 0 });
    fireEvent.pointerMove(target, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(target, { clientX: 200, clientY: 200 });
    expect(view.queryByTestId("selection-box")).toBeNull();
  }
  fireEvent.click(view.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledOnce();
  expect(props.onSelectMany).not.toHaveBeenCalled();
  expect(props.onMoveMany).not.toHaveBeenCalled();
});

it("gives the preview frame no coloured ring, also while the canvas has focus after a drag", () => {
  const { svg } = renderCafe();
  const frame = svg.parentElement!.parentElement!;
  expect(frame.className).toContain("bg-muted");
  expect(frame.className).not.toMatch(/ring-ring|focus|outline|border-(?!transparent)/);
});

it("puts the details in their own row below the preview, never over it and never moving it", () => {
  const { props, view, svg } = renderCafe();
  const surface = view.getByLabelText("Selection workspace");
  const wrapper = svg.parentElement!.parentElement!.parentElement!;
  const before = wrapper.className;
  // Free space above and below the preview is the same, and the details row is as high as that space.
  expect(surface.className).toContain("grid-rows-[minmax(0,1fr)_auto_minmax(3rem,1fr)_98px]");
  expect(before).toContain("row-start-2");
  // Below the wide layout the column scrolls, so the details take the height they need.
  expect(surface.className).toContain("max-lg:grid-rows-[auto_auto_auto]");
  view.rerender(<EditableThemePreview {...props} selectedIndex={2} selectedIndices={[2]}><p>Details</p></EditableThemePreview>);
  const details = view.getByText("Details").parentElement!;
  expect(details.parentElement).toBe(surface);
  expect(details.className).toContain("row-start-3");
  expect(details.className).toContain("min-h-0");
  expect(details.className).not.toMatch(/absolute|fixed/);
  expect(wrapper.contains(details)).toBe(false);
  expect(wrapper.className).toBe(before);
});
