// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

afterEach(cleanup);

// 7197 review point 5: the dropdown is our own list, the chosen item is ink on
// grey (bolder, a check mark), and nothing in it is blue.
describe("Select list", () => {
  it("marks the chosen item as ink on grey with a check mark", () => {
    render(
      <Select value="claude">
        <SelectTrigger aria-label="Show this provider"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="claude">Claude</SelectItem>
          <SelectItem value="codex">Codex</SelectItem>
        </SelectContent>
      </Select>,
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Show this provider" }), { key: "Enter" });
    const chosen = screen.getByRole("option", { name: "Claude" });
    expect(chosen.className).toContain("data-[state=checked]:bg-foreground/9");
    expect(chosen.className).toContain("data-[state=checked]:font-semibold");
    expect(chosen.querySelector("svg")).not.toBeNull();
    const list = document.querySelector("[data-slot=select-content]") as HTMLElement;
    expect(`${list.className} ${chosen.className}`).not.toMatch(/blue|accent|sky|indigo/);
  });

  it("is a native-free dropdown: the trigger is a combobox button, not a <select>", () => {
    const { container } = render(
      <Select value="a">
        <SelectTrigger aria-label="Pick"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="a">A</SelectItem></SelectContent>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Pick" }).tagName).toBe("BUTTON");
    // Radix keeps a hidden native select only for forms; it is not shown.
    expect(container.querySelector("select:not([aria-hidden])")).toBeNull();
  });
});
