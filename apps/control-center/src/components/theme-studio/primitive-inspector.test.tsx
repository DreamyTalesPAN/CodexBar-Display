// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PrimitiveInspector } from "./primitive-inspector";
import { normalizeThemeSpec, type ThemeStudioPrimitive } from "@/lib/theme-studio";

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
    primitive, onDelete: () => {}, onInsertToken: () => {},
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
