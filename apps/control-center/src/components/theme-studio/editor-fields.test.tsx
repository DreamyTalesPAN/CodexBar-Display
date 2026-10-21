// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorField } from "./editor-fields";

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
