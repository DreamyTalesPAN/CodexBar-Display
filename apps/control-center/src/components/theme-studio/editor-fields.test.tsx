// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { COLOR_PALETTE, ColorField } from "./editor-fields";

afterEach(cleanup);

// 7197 review, point 6: the palette opens directly below the field, inside Details.
describe("ColorField", () => {
  it("shows the colour and opens a palette of twelve colours right below the field", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ColorField label="Color" onChange={onChange} value="#E0723F" />,
    );
    expect(screen.queryByTestId("color-palette")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Color palette" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    const palette = screen.getByTestId("color-palette");
    // Anchored in the field's own wrapper (not a floating layer elsewhere), so it scrolls with Details.
    expect(container.contains(palette)).toBe(true);
    // In the normal flow: it pushes the rows below it down instead of covering them or being cut off.
    expect(palette.className).not.toMatch(/\b(absolute|fixed|sticky)\b/);
    expect(palette.className).not.toMatch(/\b(top|bottom|left|right)-\[/);
    expect(palette.parentElement?.className).not.toContain("overflow");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(palette.querySelectorAll("button[aria-label^='#']")).toHaveLength(12);
    expect(COLOR_PALETTE).toHaveLength(12);
    expect(screen.getByRole("button", { name: "#E0723F" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "More colours…" })).toBeTruthy();
    await expectNoAxeViolations(container.innerHTML);
  });

  it("has no blue in the palette", () => {
    for (const hex of COLOR_PALETTE) {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(b > r + 24 && b > g + 24, hex).toBe(false);
    }
  });

  it("changes the colour from the palette and closes it", () => {
    const onChange = vi.fn();
    render(<ColorField label="Color" onChange={onChange} value="#E0723F" />);
    fireEvent.click(screen.getByRole("button", { name: "Color palette" }));
    fireEvent.click(screen.getByRole("button", { name: "#9DBA4C" }));
    expect(onChange).toHaveBeenCalledWith("#9DBA4C");
    expect(screen.queryByTestId("color-palette")).toBeNull();
  });

  it("closes the palette with Escape and keeps typing the hex code", () => {
    const onChange = vi.fn();
    render(<ColorField label="Color" onChange={onChange} value="#E0723F" />);
    fireEvent.click(screen.getByRole("button", { name: "Color palette" }));
    fireEvent.keyDown(screen.getByTestId("color-palette"), { key: "Escape" });
    expect(screen.queryByTestId("color-palette")).toBeNull();

    const text = screen.getByLabelText("Color");
    fireEvent.change(text, { target: { value: "#112233" } });
    fireEvent.blur(text);
    expect(onChange).toHaveBeenCalledWith("#112233");
  });

  it("opens the system picker from More colours…", () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      configurable: true,
      value: showPicker,
    });
    render(<ColorField label="Color" onChange={vi.fn()} value="#E0723F" />);
    fireEvent.click(screen.getByRole("button", { name: "Color palette" }));
    fireEvent.click(screen.getByRole("button", { name: "More colours…" }));
    expect(showPicker).toHaveBeenCalledTimes(1);
    delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker;
  });
});

const COLOR_ERROR = "Use a 6-digit hex color, like #FFAA00.";

function renderColorField() {
  const onChange = vi.fn();
  render(<ColorField label="Accent" onChange={onChange} value="#FFAA00" />);
  return { input: screen.getByLabelText("Accent") as HTMLInputElement, onChange };
}

describe("ColorField invalid value", () => {
  afterEach(cleanup);

  it.each(["red", "#F00"])("explains an invalid color %s and links the text to the field", (draft) => {
    const { input } = renderColorField();
    fireEvent.change(input, { target: { value: draft } });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const description = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe(COLOR_ERROR);
  });

  it("removes the explanation once the draft is valid again", () => {
    const { input } = renderColorField();
    fireEvent.change(input, { target: { value: "red" } });
    fireEvent.change(input, { target: { value: "#00FF00" } });

    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText(COLOR_ERROR)).toBeNull();
  });

  it("commits a valid color on blur and does not show the explanation", () => {
    const { input, onChange } = renderColorField();
    fireEvent.change(input, { target: { value: "#00ff00" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith("#00FF00");
    expect(screen.queryByText(COLOR_ERROR)).toBeNull();
  });
});
