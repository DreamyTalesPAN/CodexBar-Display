// @vitest-environment jsdom
//
// Paul, 20.10.2026: every invalid field shows the same clearly visible RED
// focus ring under the keyboard (full strength, same width as the normal
// ring), and keeps its red border. One shared style, no special cases.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Textarea } from "./textarea";

const RED_FOCUS = ["aria-invalid:focus-visible:ring-destructive", "aria-invalid:focus-visible:border-destructive"];

afterEach(cleanup);

describe("invalid fields under keyboard focus", () => {
  it.each([
    ["Input", () => render(<Input aria-invalid="true" />).container.querySelector("input")],
    ["Textarea", () => render(<Textarea aria-invalid="true" />).container.querySelector("textarea")],
    ["Checkbox", () => render(<Checkbox aria-invalid="true" />).container.querySelector("button")],
  ])("%s shows the full red focus ring and keeps its red border", (_name, mount) => {
    const classes = (mount()?.getAttribute("class") || "").split(/\s+/);
    for (const name of RED_FOCUS) {
      expect(classes).toContain(name);
    }
    expect(classes.some((name) => /^aria-invalid:focus-visible:ring-ring/.test(name))).toBe(false);
  });
});
