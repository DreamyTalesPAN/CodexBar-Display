// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderDisplaySelection, UsageSnapshot } from "./control-center-types";
import { DisplayLimitsSettings } from "./display-limits-settings";

afterEach(cleanup);

// Marcus's Mac on 9 Oct: Claude reports three limits, Codex one.
const usage: UsageSnapshot = {
  providers: [
    {
      id: "claude",
      label: "Claude",
      session: 13,
      weekly: 72,
      usageMode: "used",
      windows: [
        { id: "session", label: "Session", usedPercent: 13 },
        { id: "weekly", label: "Weekly", usedPercent: 72 },
        { id: "claude-weekly-scoped-fable", label: "Fable only", usedPercent: 0 },
      ],
    },
    {
      id: "codex",
      label: "Codex",
      session: 0,
      weekly: 32,
      usageMode: "used",
      windows: [{ id: "weekly", label: "Weekly", usedPercent: 32 }],
    },
  ],
};
const providers = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

function show(display: Partial<ProviderDisplaySelection>, onChange = vi.fn()) {
  render(
    <DisplayLimitsSettings
      display={{ configured: true, mode: "fixed", providerIds: ["claude"], valid: true, ...display }}
      onChange={onChange}
      providers={providers}
      theme={{ limits: 2, name: "Pace Meter" }}
      usage={usage}
    />,
  );
  return onChange;
}

const row = (provider: string, limit: string) =>
  screen.getByRole("group", { name: `${provider} limits` }).querySelector(
    `[id="vibetv-limit-${provider.toLowerCase()}-${limit}"]`,
  ) as HTMLElement;

describe("DisplayLimitsSettings", () => {
  it("takes an unticked limit off VibeTV and leaves the rest as they are", () => {
    const onChange = show({});

    fireEvent.click(row("Claude", "session"));

    const change = onChange.mock.calls[0][0];
    expect(change({})).toEqual({ claude: ["session"] });
    expect(change({ codex: ["weekly"] })).toEqual({ claude: ["session"], codex: ["weekly"] });
  });

  it("keeps the last ticked limit of a provider", () => {
    show({ hiddenWindows: { claude: ["session", "claude-weekly-scoped-fable"] } });

    expect(row("Claude", "weekly")).toHaveProperty("disabled", true);
    expect(row("Codex", "weekly")).toHaveProperty("disabled", true);
    expect(row("Claude", "session")).toHaveProperty("disabled", false);
  });

  it("keeps the last visible limit when two unticks drain from the save queue", () => {
    const hidden = { claude: ["claude-weekly-scoped-fable"] };
    const onChange = show({ hiddenWindows: hidden });

    // Both clicks see the same render while an earlier save is pending.
    fireEvent.click(row("Claude", "session"));
    fireEvent.click(row("Claude", "weekly"));

    const afterFirst = onChange.mock.calls[0][0](hidden);
    const afterSecond = onChange.mock.calls[1][0](afterFirst);
    expect(afterFirst).toEqual({ claude: ["session", "claude-weekly-scoped-fable"] });
    expect(afterSecond).toEqual(afterFirst);
  });

  it("keeps a hidden limit unticked and editable after the chosen source disappears", () => {
    const onChange = vi.fn();
    render(<DisplayLimitsSettings
      display={{ configured: true, mode: "fixed", providerIds: ["claude"], valid: true, hiddenWindows: { claude: ["weekly"] } }}
      onChange={onChange} providers={providers} theme={null}
      usage={{ providers: [{ ...usage.providers[0], windows: [usage.providers[0].windows![1]] }] }}
    />);
    const weekly = row("Claude", "weekly");
    expect(weekly.getAttribute("aria-checked")).toBe("false");
    expect(weekly).toHaveProperty("disabled", false);
    fireEvent.click(weekly);
    expect(onChange.mock.calls[0][0]({ claude: ["weekly"] })).toEqual({});
  });

  it("says which ticked limits the theme has room for", () => {
    show({});
    const claude = screen.getByRole("group", { name: "Claude limits" }).textContent;

    expect(claude).toMatch(/Session13%on screen/);
    expect(claude).toMatch(/Weekly72%on screen/);
    expect(claude).toMatch(/Fable only0%no room in this theme/);
  });

  it("shows the first ticked limit of each provider in Two at once", () => {
    show({ hiddenWindows: { claude: ["session"] }, mode: "pair", providerIds: ["claude", "codex"] });
    const claude = screen.getByRole("group", { name: "Claude limits" }).textContent;

    expect(claude).toMatch(/Weekly72%on screen/);
    expect(claude).toMatch(/Fable only0%not in Two at once/);
    expect(screen.getByRole("group", { name: "Codex limits" }).textContent).toMatch(/on screen/);
  });
});
