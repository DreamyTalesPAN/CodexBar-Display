// @vitest-environment jsdom
//
// Slider thumb ring (Codex review of #784): the olive ring-ring colour is for
// keyboard focus only. Hover and drag show the neutral grey ring.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Slider } from "@/components/ui/slider";

it("shows the olive thumb ring only for keyboard focus, grey on hover and drag", () => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<Slider defaultValue={[50]} aria-label="Brightness" />);

  const thumb = host.querySelector('[role="slider"]') as HTMLElement;
  expect(thumb.classList).toContain("focus-visible:border-ring");
  expect(thumb.classList).toContain("focus-visible:ring-1");
  expect(thumb.classList).toContain("focus-visible:ring-ring");
  expect(thumb.classList).not.toContain("focus-visible:ring-3");
  expect(thumb.classList).not.toContain("ring-ring");
  expect(thumb.classList).not.toContain("hover:ring-ring");
  expect(thumb.classList).not.toContain("active:ring-ring");
  expect(thumb.classList).not.toContain("ring-foreground/10");
  expect(thumb.classList).toContain("hover:ring-foreground/10");
  expect(thumb.classList).toContain("active:ring-foreground/10");
  expect(thumb.classList).toContain("hover:ring-3");
  expect(thumb.classList).toContain("active:ring-3");
});
