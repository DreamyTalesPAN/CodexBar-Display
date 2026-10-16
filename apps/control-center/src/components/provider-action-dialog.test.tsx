// @vitest-environment jsdom
//
// Frame 3A (16.10.2026): one provider overlay at a time, closed stays closed
// while the provider stays in that state, and it comes back once it was healthy
// and broke again.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  ProviderActionDialog,
  useProviderActionDismissal,
} from "./provider-action-dialog";
import type { UsageProviderAction } from "./usage-screen";

afterEach(cleanup);

const claude = (
  state = "auth_required",
  onAction = vi.fn(),
  inSettings = false,
): Record<string, UsageProviderAction> => ({
  claude: { name: "Claude", state, inSettings, label: "Sign in needed", onAction },
});

function Overlay({
  actions,
  error = null,
}: {
  actions: Record<string, UsageProviderAction>;
  error?: { code: string; message: string; nextAction: string } | null;
}) {
  const [shown, dismiss] = useProviderActionDismissal(actions);
  return shown ? (
    <ProviderActionDialog action={shown.action} error={error} onDismiss={dismiss} />
  ) : null;
}

const dialog = (name: string) => screen.queryByRole("dialog", { name });

it("shows the sign-in overlay with the frame's exact texts", () => {
  render(<Overlay actions={claude()} />);
  const d = dialog("Claude needs a new sign-in");
  expect(d).not.toBeNull();
  expect(d?.textContent).toContain("VibeTV can't show Claude until you sign in again.");
  expect(screen.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
});

it("Not now dismisses, and it stays dismissed while the state stays", async () => {
  const { rerender } = render(<Overlay actions={claude()} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
  await act(async () => rerender(<Overlay actions={claude()} />));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
});

it("returns after the provider was healthy and broke again", async () => {
  const { rerender } = render(<Overlay actions={claude()} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await act(async () => rerender(<Overlay actions={{}} />));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
  await act(async () => rerender(<Overlay actions={claude()} />));
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});

it("keeps the sign-in action open for the sign-in to finish", () => {
  const onAction = vi.fn();
  render(<Overlay actions={claude("auth_required", onAction)} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign in to Claude" }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});

it("closes when its primary action opens Settings", () => {
  const onAction = vi.fn();
  render(<Overlay actions={claude("permission_required", onAction, true)} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI providers" }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(dialog("Claude needs access")).toBeNull();
});

it("uses the permission and setup texts for those states", () => {
  const { unmount } = render(<Overlay actions={claude("permission_required")} />);
  expect(dialog("Claude needs access")?.textContent).toContain(
    "VibeTV can't show Claude until you allow access on this computer.",
  );
  expect(screen.getByRole("button", { name: "Open AI providers" })).toBeTruthy();
  unmount();
  render(<Overlay actions={claude("setup_required")} />);
  expect(dialog("Claude needs setup")?.textContent).toContain(
    "VibeTV can't show Claude until it is set up.",
  );
  expect(screen.getByRole("button", { name: "Set up Claude" })).toBeTruthy();
});

it("shows a failed sign-in start in this dialog's description", () => {
  render(
    <Overlay
      actions={claude()}
      error={{ code: "x", message: "Could not open Claude.", nextAction: "Try again later." }}
    />,
  );
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude. Try again later.");
});

it("waits while another dialog is open", async () => {
  const { rerender } = render(
    <div>
      <div role="alertdialog">Delete this theme?</div>
      <Overlay actions={claude()} />
    </div>,
  );
  expect(dialog("Claude needs a new sign-in")).toBeNull();
  await act(async () =>
    rerender(
      <div>
        <Overlay actions={claude()} />
      </div>,
    ),
  );
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});
