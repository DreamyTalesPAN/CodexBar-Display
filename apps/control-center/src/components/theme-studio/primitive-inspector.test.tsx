// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PrimitiveInspector } from "./primitive-inspector";
import { normalizeThemeSpec, type ThemeStudioPrimitive } from "@/lib/theme-studio";
import { keySpriteColor } from "@/lib/theme-studio-assets";

const initial: ThemeStudioPrimitive = {
  type: "progress", x: 0, y: 0, width: 100, height: 20,
  binding: "session", color: "#FFFFFF",
  colorStops: [
    { gte: 75, color: "#22C55E" }, { gte: 50, color: "#FACC15" },
    { gte: 25, color: "#F97316" }, { gte: 0, color: "#EF4444" },
  ],
};
function Harness() {
  const [primitive, setPrimitive] = useState(initial);
  return createElement(PrimitiveInspector, {
    primitive, onDelete: () => {}, onInsertToken: () => {}, onKeySpriteColor: () => {},
    onChange: (field, value) => setPrimitive(p => normalizeThemeSpec({
      themeId: "focus-test", themeRev: 1, themeSpecVersion: 1,
      primitives: [{ ...p, [field]: value }],
    }).primitives[0]),
  });
}
afterEach(cleanup);

it("keeps focus and the same color row while typing across other thresholds", () => {
  render(createElement(Harness));
  const input = screen.getByRole("spinbutton", { name: "At remaining ≥" });
  input.focus();
  for (const value of ["", "4", "40"]) {
    fireEvent.change(input, { target: { value } });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("spinbutton", { name: "At remaining ≥" })).toBe(input);
  }
  expect(screen.getByRole("textbox", { name: "Threshold color" }).getAttribute("value")).toBe("#22C55E");
  expect(screen.getByRole("button", { name: "Remove remaining threshold 40" })).toBeTruthy();
});

it("can remove a threshold, add one, and return to a solid color", () => {
  render(createElement(Harness));
  fireEvent.click(screen.getByRole("button", { name: "Remove remaining threshold 50" }));
  fireEvent.click(screen.getByRole("button", { name: "Add threshold" }));
  expect(screen.getByRole("button", { name: "Remove remaining threshold 50" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use solid bar color" }));
  expect(screen.queryByRole("button", { name: /Remove remaining threshold/ })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Bar color" })).toBeTruthy();
});

function SpriteHarness({ type }: { type: "gif" | "sprite" }) {
  const [spriteData, setSpriteData] = useState(
    "CBI1\n3 1\n3\n#000000\n#FF0000\n#FFFFFF\nabc\n",
  );
  return createElement(PrimitiveInspector, {
    primitive: { type, x: 0, y: 0, width: 3, height: 1, assetPath: "/themes/u/a.cbi" },
    onChange: () => {}, onDelete: () => {}, onInsertToken: () => {},
    onKeySpriteColor: color => setSpriteData(data => keySpriteColor(data, color)),
    spriteData,
  });
}

it("makes the picked sprite color transparent", () => {
  render(createElement(SpriteHarness, { type: "sprite" }));
  const swatches = () => screen.getByRole("group", { name: "Transparent color" });
  expect(swatches().querySelectorAll("[aria-pressed]")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Make transparent" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "#000000" }));
  fireEvent.click(screen.getByRole("button", { name: "Make transparent" }));
  expect(screen.queryByRole("button", { name: "#000000" })).toBeNull();
  expect(swatches().querySelectorAll("[aria-pressed='false']")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Make transparent" })).toBeNull();
});

it("offers no transparent color for a GIF", () => {
  render(createElement(SpriteHarness, { type: "gif" }));
  expect(screen.queryByRole("group", { name: "Transparent color" })).toBeNull();
});
