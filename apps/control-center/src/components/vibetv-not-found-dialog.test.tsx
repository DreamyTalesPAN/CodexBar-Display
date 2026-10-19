// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VibeTVNotFoundDialog, vibetvNotFound } from "./vibetv-not-found-dialog";

afterEach(() => {
  cleanup();
});

describe("VibeTVNotFoundDialog", () => {
  it("shows the lime primary, Not now and no close button", () => {
    const onRunSetupAgain = vi.fn();
    const onDismiss = vi.fn();
    render(
      <VibeTVNotFoundDialog onDismiss={onDismiss} onRunSetupAgain={onRunSetupAgain} />,
    );

    const dialog = screen.getByRole("dialog", { name: "We couldn't find your VibeTV" });
    expect(dialog.textContent).toContain(
      "Check that VibeTV is plugged in and on the same WiFi as this Mac.",
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run setup again" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Not now" }).className).not.toContain("bg-primary");

    fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));
    expect(onRunSetupAgain).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls onDismiss from Not now", () => {
    const onDismiss = vi.fn();
    render(<VibeTVNotFoundDialog onDismiss={onDismiss} onRunSetupAgain={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("says computer on Windows", () => {
    render(
      <VibeTVNotFoundDialog onDismiss={vi.fn()} onRunSetupAgain={vi.fn()} windowsHost />,
    );

    expect(screen.getByRole("dialog").textContent).toContain("on the same WiFi as this computer.");
  });

  it("is the not-found state only while VibeTV is missing on its cable", () => {
    expect(
      vibetvNotFound({ active: true, connected: false, paired: true, ready: false, stream: { errorCode: "device_not_found" } } as never),
    ).toBe(true);
    expect(
      vibetvNotFound({ active: true, connected: true, paired: true, ready: true, stream: { errorCode: "device_not_found" } } as never),
    ).toBe(false);
    expect(vibetvNotFound({ active: true, connected: false, paired: true, ready: false } as never)).toBe(false);
  });
});
