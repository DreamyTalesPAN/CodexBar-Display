// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupDialog } from "./setup-dialog";

afterEach(cleanup);

// The grey backdrop of a dialog is found by its class (the scrim is aria-hidden).
const backdropOf = (container: HTMLElement) =>
  container.ownerDocument.querySelector<HTMLElement>("div[aria-hidden].bg-black\\/10");

describe("SetupDialog backdrop", () => {
  it("holds the screen behind when a scrim is asked for", () => {
    render(
      <SetupDialog onOpenChange={vi.fn()} open primaryAction={{ label: "OK", onSelect: vi.fn() }} title="Held">
        <p>text</p>
      </SetupDialog>,
    );
    const backdrop = backdropOf(document.body);
    expect(backdrop?.className).toContain("opacity-100");
    expect(backdrop?.className).not.toContain("pointer-events-none");
  });

  it("shows the grey backdrop without scrim, but it takes no clicks", () => {
    render(
      <SetupDialog
        onOpenChange={vi.fn()}
        open
        primaryAction={{ label: "OK", onSelect: vi.fn() }}
        scrim={false}
        title="Announcement"
      >
        <p>text</p>
      </SetupDialog>,
    );
    const backdrop = backdropOf(document.body);
    expect(backdrop).not.toBeNull();
    expect(backdrop?.className).toContain("bg-black/10");
    expect(backdrop?.className).toContain("opacity-100");
    expect(backdrop?.className).toContain("pointer-events-none");
  });
});
