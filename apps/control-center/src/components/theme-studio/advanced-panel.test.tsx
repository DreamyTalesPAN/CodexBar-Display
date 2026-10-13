// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AdvancedPanel } from "./advanced-panel";

afterEach(cleanup);

it("lets the tab list grow with its two rows of tabs", () => {
  render(createElement(AdvancedPanel, {
    activeTab: "project", onTabChange: () => {},
    panels: { assets: null, device: null, json: null, project: "Project panel" },
  }));
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  expect(screen.getAllByRole("tab")).toHaveLength(4);
  // A fixed height here leaves JSON and Device lying on top of the panel.
  const classes = screen.getByRole("tablist").className.split(" ");
  expect(classes).toContain("group-data-horizontal/tabs:h-auto");
  expect(classes.filter(name => /(^|:)h-\d/.test(name))).toEqual([]);
});
