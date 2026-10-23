// @vitest-environment jsdom
//
// The seven looks of a provider row (states overview 644, Paul 16.10.): the
// switch stays at the right; a red action where the customer must act; a muted
// spinner while CodexBar works or retries by itself; nothing else.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupProviderRow, setupProviderRowVariant } from "./setup-provider-row";

afterEach(cleanup);

function row(props: Partial<Parameters<typeof SetupProviderRow>[0]> = {}) {
  const onShowIssue = vi.fn();
  const onToggle = vi.fn();
  const utils = render(
    <SetupProviderRow
      enabled
      health="healthy"
      label="Claude"
      onShowIssue={onShowIssue}
      onToggle={onToggle}
      {...props}
    />,
  );
  return { ...utils, onShowIssue, onToggle, item: utils.getByRole("listitem") };
}

const switchOf = (item: HTMLElement) => within(item).getByRole("switch");

describe("the seven provider row looks", () => {
  it("1 · switched on and OK: name and switch only", () => {
    const { item } = row({ label: "Codex", health: "healthy" });
    expect(within(item).getByText("Codex")).toBeTruthy();
    expect(switchOf(item).getAttribute("aria-checked")).toBe("true");
    expect(item.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(within(item).queryByRole("button")).toBeNull();
  });

  it("2 · switched on and CodexBar is fetching: a small spinner beside the switch", () => {
    const { item } = row({ label: "Cursor", health: "checking" });
    expect(item.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(within(item).queryByRole("button")).toBeNull();
    expect(switchOf(item).getAttribute("aria-checked")).toBe("true");
  });

  it.each(["auth_required", "browser_sign_in_required", "setup_required"])(
    "3 · %s: red 'Sign in needed' with an arrow, and the switch",
    (health) => {
      const onOpenSignIn = vi.fn();
      const { item } = row({ health, onOpenSignIn });
      const action = within(item).getByRole("button", { name: "Sign in needed for Claude" });
      expect(action.textContent).toBe("Sign in needed");
      expect(action.className).toContain("text-destructive");
      expect(action.querySelector("svg")).not.toBeNull();
      expect(switchOf(item)).toBeTruthy();
      expect(item.querySelector('[data-slot="spinner"]')).toBeNull();
    },
  );

  it("3 · clicking calls the sign-in when the app can start it", () => {
    const onOpenSignIn = vi.fn();
    const { item, onShowIssue } = row({ health: "auth_required", onOpenSignIn });
    fireEvent.click(within(item).getByRole("button", { name: "Sign in needed for Claude" }));
    expect(onOpenSignIn).toHaveBeenCalledTimes(1);
    expect(onShowIssue).not.toHaveBeenCalled();
  });

  it("3 · without a sign-in the app can start, clicking opens the provider's dialog", () => {
    const { item, onShowIssue } = row({ health: "setup_required" });
    fireEvent.click(within(item).getByRole("button", { name: "Sign in needed for Claude" }));
    expect(onShowIssue).toHaveBeenCalledTimes(1);
  });

  it("4 · permission missing: red 'Allow access' with an arrow; clicking opens the dialog", () => {
    const onOpenSignIn = vi.fn();
    const { item, onShowIssue } = row({ health: "permission_required", onOpenSignIn });
    const action = within(item).getByRole("button", { name: "Allow access for Claude" });
    expect(action.textContent).toBe("Allow access");
    expect(action.className).toContain("text-destructive");
    fireEvent.click(action);
    expect(onShowIssue).toHaveBeenCalledTimes(1);
    expect(onOpenSignIn).not.toHaveBeenCalled();
  });

  it.each(["stale", "timed_out", "rate_limited", "unavailable", "service_outage", "engine_error",
    "engine_incompatible", "config_error", "unknown"])(
    "5 · %s: a muted spinner, no text, no warning, no button",
    (health) => {
      const { item } = row({ health });
      const spinner = item.querySelector('[data-slot="spinner"]');
      expect(spinner).not.toBeNull();
      expect(spinner?.getAttribute("class")).toContain("text-muted-foreground");
      expect(within(item).queryByRole("button")).toBeNull();
      // The only text is the screen-reader line; nothing visible beside the name.
      expect(item.textContent).toBe("ClaudeUpdating Claude");
    },
  );

  it.each(["unsupported", "no_usage_available"])(
    "6 · %s: the name muted and 'No usage data', and the switch",
    (health) => {
      const { item } = row({ health });
      expect(within(item).getByText("No usage data")).toBeTruthy();
      expect(within(item).getByText("Claude").className).toContain("text-muted-foreground");
      expect(within(item).queryByRole("button")).toBeNull();
      expect(switchOf(item).getAttribute("aria-checked")).toBe("true");
    },
  );

  it("7 · switched off: name and switch off, nothing else", () => {
    const { item } = row({ enabled: false, health: "auth_required" });
    expect(switchOf(item).getAttribute("aria-checked")).toBe("false");
    expect(within(item).queryByRole("button")).toBeNull();
    expect(item.textContent).toBe("Claude");
  });

  it("never shows the warning icon, the retry or the round chevron", () => {
    for (const health of ["auth_required", "permission_required", "stale", "unsupported", "healthy"]) {
      const { item, unmount } = row({ health });
      expect(within(item).queryByRole("button", { name: /Show provider message/ })).toBeNull();
      expect(within(item).queryByRole("button", { name: /again/ })).toBeNull();
      expect(item.querySelector("svg.lucide-chevron-right")).toBeNull();
      unmount();
    }
  });

  it("keeps the switch usable in every look, and the row never opens a dialog itself", () => {
    for (const health of ["healthy", "checking", "auth_required", "permission_required", "stale", "unsupported"]) {
      const { item, onToggle, unmount } = row({ health });
      expect(switchOf(item).hasAttribute("disabled")).toBe(false);
      fireEvent.click(switchOf(item));
      expect(onToggle).toHaveBeenCalledWith(false);
      expect(screen.queryByRole("dialog")).toBeNull();
      unmount();
    }
  });

  it("maps every reported state onto one of the looks", () => {
    expect(setupProviderRowVariant("auth_required")).toBe("sign_in");
    expect(setupProviderRowVariant("permission_required")).toBe("permission");
    expect(setupProviderRowVariant("stale")).toBe("stale");
    expect(setupProviderRowVariant("unsupported")).toBe("unsupported");
    expect(setupProviderRowVariant("no_usage_available")).toBe("no_usage");
  });
});
