import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InputGroup, InputGroupInput } from "./input-group";

// The classes that draw the focus ring of an input group and its invalid state.
const FOCUS_RING = "has-[[data-slot=input-group-control]:focus-visible]:ring-ring";
const INVALID_FOCUS_RING =
  "has-[[data-slot][aria-invalid=true]]:has-[[data-slot=input-group-control]:focus-visible]:ring-destructive";
// Calm redesign: a solid 1 px ring plus the border = 2 px, no faint glow.
const INVALID_RING = "has-[[data-slot][aria-invalid=true]]:ring-destructive";

// Class list of the input group's own element (the outer div).
function groupClasses(html: string): string[] {
  const opening = /<div[^>]*data-slot="input-group"[^>]*>/.exec(html);
  if (!opening) throw new Error("input group not rendered");
  const className = /class="([^"]*)"/.exec(opening[0]);
  if (!className) throw new Error("input group has no class list");
  return className[1].split(" ");
}

describe("input group focus ring", () => {
  it("shows the full red focus ring on an invalid control with keyboard focus", () => {
    const html = renderToStaticMarkup(
      <InputGroup>
        <InputGroupInput aria-invalid="true" />
      </InputGroup>,
    );
    const classes = groupClasses(html);

    expect(classes).toContain(INVALID_FOCUS_RING);
  });

  it("keeps the full red focus ring when a consumer passes its own classes", () => {
    const html = renderToStaticMarkup(
      <InputGroup className="w-40 max-w-full">
        <InputGroupInput aria-invalid="true" />
      </InputGroup>,
    );
    const classes = groupClasses(html);

    expect(classes).toContain("w-40");
    expect(classes).toContain(INVALID_FOCUS_RING);
  });

  it("keeps the red invalid ring and the normal focus ring next to it", () => {
    const html = renderToStaticMarkup(
      <InputGroup>
        <InputGroupInput aria-invalid="true" />
      </InputGroup>,
    );
    const classes = groupClasses(html);

    expect(classes).toContain(INVALID_RING);
    expect(classes).toContain(FOCUS_RING);
  });
});
