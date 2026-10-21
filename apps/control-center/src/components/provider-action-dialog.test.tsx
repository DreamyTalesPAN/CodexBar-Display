// @vitest-environment jsdom
//
// Frame 3A (16.10.2026): one provider overlay at a time, closed stays closed
// while the provider stays in that state, and it comes back once it was healthy
// and broke again.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";

import {
  ProviderActionDialog,
  useProviderActionDismissal,
} from "./provider-action-dialog";
import { providerUnresolvedIds } from "./setup/setup-providers-screen";
import { SystemBusyDialog, systemBusyCopy } from "./system-busy-dialog";
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

it("uses the access text for permission_required; setup_required uses the sign-in copy", () => {
  const { unmount } = render(<Overlay actions={claude("permission_required")} />);
  expect(dialog("Claude needs access")?.textContent).toContain(
    "VibeTV can't show Claude until you allow access on this computer.",
  );
  expect(screen.getByRole("button", { name: "Open AI providers" })).toBeTruthy();
  unmount();
  render(<Overlay actions={claude("setup_required")} />);
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Sign in to Claude" })).toBeTruthy();
});

it("shows a failed sign-in start in this dialog's description", () => {
  render(
    <Overlay
      actions={claude()}
      error={{ code: "x", message: "Could not open Claude.", nextAction: "Try again later." }}
    />,
  );
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude.");
  expect(dialog("Claude needs a new sign-in")?.textContent).not.toContain("Try again later.");
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

it("comes before the busy notice: the notice waits for it, not the other way round", async () => {
  render(
    <div>
      <SystemBusyDialog onClose={() => {}} />
      <Overlay actions={claude()} />
    </div>,
  );
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name: systemBusyCopy.title })).toBeNull();
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});

function ReportingOverlay({ actions }: { actions: Record<string, UsageProviderAction> }) {
  const [shown, dismiss, report, start] = useProviderActionDismissal(actions);
  return (
    <div>
      <button
        onClick={() =>
          report(
            "claude",
            "auth_required",
            { code: "x", message: "Could not open Claude.", nextAction: "Try again later." },
            true,
            start("claude"),
          )
        }
        type="button"
      >
        report
      </button>
      <button
        onClick={() =>
          report(
            "claude",
            "auth_required",
            { code: "x", message: "Could not open Claude.", nextAction: "Try again later." },
            false,
            start("claude"),
          )
        }
        type="button"
      >
        report settings
      </button>
      {shown ? (
        <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} />
      ) : null}
    </div>
  );
}

it("a failed start reopens a closed overlay with its error, cleared once the provider is healthy", async () => {
  const { rerender } = render(<ReportingOverlay actions={claude()} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "report" }));
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude.");
  expect(dialog("Claude needs a new sign-in")?.textContent).not.toContain("Try again later.");
  await act(async () => rerender(<ReportingOverlay actions={{}} />));
  await act(async () => rerender(<ReportingOverlay actions={claude()} />));
  const again = dialog("Claude needs a new sign-in");
  expect(again?.textContent).toContain("VibeTV can't show Claude until you sign in again.");
  expect(again?.textContent).not.toContain("Could not open Claude.");
});

it("a late sign-in failure does not revive an action that already ended", async () => {
  const { rerender } = render(<ReportingOverlay actions={claude()} />);
  await act(async () => rerender(<ReportingOverlay actions={{}} />));
  fireEvent.click(screen.getByRole("button", { name: "report" }));
  await act(async () => rerender(<ReportingOverlay actions={claude()} />));
  expect(dialog("Claude needs a new sign-in")?.textContent).not.toContain("Could not open Claude.");
});

it("a failure from Settings does not reopen a closed overlay", () => {
  render(<ReportingOverlay actions={claude()} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent.click(screen.getByRole("button", { name: "report settings" }));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
});

function SettingsAware({ actions, onSettings }: { actions: Record<string, UsageProviderAction>; onSettings: boolean }) {
  const [shown, dismiss] = useProviderActionDismissal(actions, onSettings);
  return shown ? <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} /> : null;
}

it("counts the overlay as seen on Settings, whichever way the page was opened", async () => {
  const { rerender } = render(<SettingsAware actions={claude()} onSettings />);
  expect(dialog("Claude needs a new sign-in")).toBeNull();
  await act(async () => rerender(<SettingsAware actions={claude()} onSettings={false} />));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
});

it("marks many actions seen on Settings in one update", async () => {
  const many = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [
      `p${i}`,
      { name: `P${i}`, state: "setup_required", label: "Set up", onAction: vi.fn() },
    ]),
  );
  const { rerender } = render(<SettingsAware actions={many} onSettings />);
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
  await act(async () => rerender(<SettingsAware actions={many} onSettings={false} />));
  expect(screen.queryAllByRole("dialog")).toHaveLength(0);
});

function CheckingOverlay({ actions, checking }: { actions: Record<string, UsageProviderAction>; checking: string[] }) {
  const [shown, dismiss] = useProviderActionDismissal(actions, false, checking);
  return shown ? <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} /> : null;
}

it("a checking read does not end a dismissal; only a healthy result does", async () => {
  const { rerender } = render(<CheckingOverlay actions={claude()} checking={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await act(async () => rerender(<CheckingOverlay actions={{}} checking={["claude"]} />));
  await act(async () => rerender(<CheckingOverlay actions={claude()} checking={[]} />));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
  await act(async () => rerender(<CheckingOverlay actions={{}} checking={[]} />));
  await act(async () => rerender(<CheckingOverlay actions={claude()} checking={[]} />));
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});

it("a failed sign-in is kept while its provider is checking", async () => {
  function Reporting({ actions, checking }: { actions: Record<string, UsageProviderAction>; checking: string[] }) {
    const [shown, dismiss, report, start] = useProviderActionDismissal(actions, false, checking);
    return (
      <div>
        <button
          onClick={() => report("claude", "auth_required", { code: "x", message: "Could not open Claude.", nextAction: "" }, true, start("claude"))}
          type="button"
        >
          report
        </button>
        {shown ? <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} /> : null}
      </div>
    );
  }
  const { rerender } = render(<Reporting actions={claude()} checking={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await act(async () => rerender(<Reporting actions={{}} checking={["claude"]} />));
  fireEvent.click(screen.getByRole("button", { name: "report" }));
  await act(async () => rerender(<Reporting actions={claude()} checking={["claude"]} />));
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude.");
});

it("a healthy result after a checking read ends the dismissal", async () => {
  const { rerender } = render(<CheckingOverlay actions={claude()} checking={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await act(async () => rerender(<CheckingOverlay actions={{}} checking={["claude"]} />));
  await act(async () => rerender(<CheckingOverlay actions={{}} checking={[]} />));
  await act(async () => rerender(<CheckingOverlay actions={claude()} checking={[]} />));
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});

it("a failure shown before a checking read is still there when the need returns", async () => {
  function Reporting({ actions, checking }: { actions: Record<string, UsageProviderAction>; checking: string[] }) {
    const [shown, dismiss, report, start] = useProviderActionDismissal(actions, false, checking);
    return (
      <div>
        <button
          onClick={() => report("claude", "auth_required", { code: "x", message: "Could not open Claude.", nextAction: "" }, true, start("claude"))}
          type="button"
        >
          report
        </button>
        {shown ? <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} /> : null}
      </div>
    );
  }
  const { rerender } = render(<Reporting actions={claude()} checking={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "report" }));
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude.");
  await act(async () => rerender(<Reporting actions={{}} checking={["claude"]} />));
  await act(async () => rerender(<Reporting actions={claude()} checking={["claude"]} />));
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude.");
});

// A sign-in reply counts only for the latest sign-in of its provider (#679): a
// reply from a superseded one does not reopen or clear the newer one.
type SignInHook = ReturnType<typeof useProviderActionDismissal>;

function GenerationOverlay({
  actions,
  onHook,
}: {
  actions: Record<string, UsageProviderAction>;
  onHook: (hook: SignInHook) => void;
}) {
  const result = useProviderActionDismissal(actions);
  useEffect(() => onHook(result));
  const [shown, dismiss] = result;
  return shown ? (
    <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} />
  ) : null;
}

const signInFailure = { code: "x", message: "Could not open Claude.", nextAction: "" };

it("an older failure does not reopen the overlay after a newer sign-in started", () => {
  let hook!: SignInHook;
  render(<GenerationOverlay actions={claude()} onHook={(value) => { hook = value; }} />);
  const older = hook[3]("claude");
  hook[3]("claude");
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  act(() => hook[2]("claude", "auth_required", signInFailure, true, older));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
});

it("an older success does not clear a newer failure", () => {
  let hook!: SignInHook;
  render(<GenerationOverlay actions={claude()} onHook={(value) => { hook = value; }} />);
  const older = hook[3]("claude");
  const newer = hook[3]("claude");
  act(() => hook[2]("claude", "auth_required", signInFailure, true, newer));
  act(() => hook[2]("claude", "auth_required", null, true, older));
  expect(dialog("Claude needs a new sign-in")?.textContent).toContain("Could not open Claude.");
});

it("a reply from before the provider left does not show for its return", async () => {
  let hook!: SignInHook;
  const onHook = (value: SignInHook) => {
    hook = value;
  };
  const { rerender } = render(<GenerationOverlay actions={claude()} onHook={onHook} />);
  const before = hook[3]("claude");
  await act(async () => rerender(<GenerationOverlay actions={{}} onHook={onHook} />));
  await act(async () => rerender(<GenerationOverlay actions={claude()} onHook={onHook} />));
  act(() => hook[2]("claude", "auth_required", signInFailure, true, before));
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
  expect(dialog("Claude needs a new sign-in")?.textContent).not.toContain("Could not open Claude.");
});

it("a sign-in left while its provider was checking is forgotten once the check is healthy", async () => {
  let hook!: SignInHook;
  function Checking({ actions, checking }: { actions: Record<string, UsageProviderAction>; checking: string[] }) {
    const result = useProviderActionDismissal(actions, false, checking);
    useEffect(() => {
      hook = result;
    });
    const [shown, dismiss] = result;
    return shown ? (
      <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} />
    ) : null;
  }
  const { rerender } = render(<Checking actions={claude()} checking={[]} />);
  const before = hook[3]("claude");
  await act(async () => rerender(<Checking actions={{}} checking={["claude"]} />));
  await act(async () => rerender(<Checking actions={{}} checking={[]} />));
  await act(async () => rerender(<Checking actions={claude()} checking={[]} />));
  act(() => hook[2]("claude", "auth_required", signInFailure, true, before));
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
  expect(dialog("Claude needs a new sign-in")?.textContent).not.toContain("Could not open Claude.");
});

it("names Settings on the button when the sign-in cannot start from here", () => {
  render(<Overlay actions={claude("auth_required", vi.fn(), true)} />);
  expect(screen.getByRole("button", { name: "Open AI providers" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Sign in to Claude" })).toBeNull();
});

function ProviderHealthOverlay({
  actions,
  states,
}: {
  actions: Record<string, UsageProviderAction>;
  states: string[];
}) {
  const providers = states.map((state) => ({
    providerId: "claude",
    value: true,
    health: { state, service: "unknown", message: "" },
  }));
  const [shown, dismiss] = useProviderActionDismissal(
    actions,
    false,
    providerUnresolvedIds(providers),
  );
  return shown ? <ProviderActionDialog action={shown.action} error={shown.error} onDismiss={dismiss} /> : null;
}

it("a dismissed sign-in stays closed through a timeout read of the same incident", async () => {
  const { rerender } = render(<ProviderHealthOverlay actions={claude()} states={["auth_required"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await act(async () => rerender(<ProviderHealthOverlay actions={{}} states={["timeout"]} />));
  await act(async () => rerender(<ProviderHealthOverlay actions={claude()} states={["auth_required"]} />));
  expect(dialog("Claude needs a new sign-in")).toBeNull();
});

it("a dismissed sign-in opens again once the provider was healthy", async () => {
  const { rerender } = render(<ProviderHealthOverlay actions={claude()} states={["auth_required"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  await act(async () => rerender(<ProviderHealthOverlay actions={{}} states={["healthy"]} />));
  await act(async () => rerender(<ProviderHealthOverlay actions={claude()} states={["auth_required"]} />));
  expect(dialog("Claude needs a new sign-in")).not.toBeNull();
});
