// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { expectNoAxeViolations } from "@/test/axe";
import { ThemeStudioScreen } from "../theme-studio-screen";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("has no accessibility violations on the first screen of Theme Studio", async () => {
  render(
    <SidebarProvider>
      <ThemeStudioScreen />
    </SidebarProvider>,
  );
  expect(document.body.textContent?.length).toBeGreaterThan(0);
  // jsdom loads no CSS, so the `hidden` class of the three file pickers (opened
  // by buttons; display: none in the browser) does not hide them for axe. Mark
  // them hidden as the browser does, so axe skips them as it does there.
  for (const picker of document.querySelectorAll(".hidden")) picker.setAttribute("hidden", "");
  await expectNoAxeViolations(document.body.innerHTML);
});
