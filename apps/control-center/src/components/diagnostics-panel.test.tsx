// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupportDiagnostics } from "./control-center-types";
import {
  formatCustomerPath,
  formatCustomerSupportText,
  humanize,
} from "./customer-support-text";
import { DiagnosticsPanel } from "./diagnostics-panel";

afterEach(cleanup);

const report: SupportDiagnostics = {
  ok: true,
  schemaVersion: 2,
  usageEngine: {
    name: "CodexBar",
    status: "ready",
    version: "0.63.0",
    minimumVersion: "0.23.0",
    source: "app_managed",
    path: "/Users/marcus/Library/Application Support/VibeTV/CodexBar/0.63.0/codexbar",
  },
  providerSetup: {
    status: "ready",
    engine: {
      status: "ready",
      version: "0.63.0",
      minimumVersion: "0.23.0",
      source: "app_managed",
      path: "/Users/marcus/Library/Application Support/VibeTV/CodexBar/0.63.0/codexbar",
    },
  },
  checks: [
    { name: "companion_api", status: "pass", detail: "Companion API is running." },
    { name: "usage_engine", status: "pass", detail: "Usage engine 0.63.0 is ready." },
    {
      name: "device_hello",
      status: "attention",
      detail: "VibeTV target did not answer.",
      nextAction: "Check that VibeTV is on.",
    },
    {
      name: "display_stream",
      status: "fail",
      detail: "CodexBar returned no usage.",
      errorCode: "provider_setup_required",
      nextAction: "Open CodexBar and sign in.",
    },
    { name: "mystery_check", status: "pass" },
  ],
};

function show(diagnostics: SupportDiagnostics | null, props = {}) {
  render(<DiagnosticsPanel diagnostics={diagnostics} onRun={vi.fn()} {...props} />);
  return document.body.textContent ?? "";
}

describe("DiagnosticsPanel", () => {
  it("runs from a keyboard-reachable button and announces progress", () => {
    const run = vi.fn();
    render(<DiagnosticsPanel onRun={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Run diagnostics" }));
    expect(run).toHaveBeenCalledTimes(1);
    cleanup();

    render(<DiagnosticsPanel onRun={run} running />);
    const button = screen.getByRole("button", { name: "Running diagnostics" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Running diagnostics");
  });

  it("shows each check with a label, text state, detail and next action", () => {
    const text = show(report);
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows[0]).toContain("Mac App");
    expect(rows[0]).toContain("Pass");
    expect(rows[1]).toContain("Usage engine");
    expect(rows[2]).toContain("VibeTV reachable");
    expect(rows[2]).toContain("Needs attention");
    expect(rows[2]).toContain("VibeTV address did not answer.");
    expect(rows[2]).toContain("Check that VibeTV is on.");
    expect(rows[3]).toContain("Display updates");
    expect(rows[3]).toContain("Failed");
    expect(rows[4]).toContain("Mystery check");
    expect(text).not.toContain("Some checks could not run");
  });

  it("shows the selected usage engine with its home folder abbreviated", () => {
    const text = show(report);
    const engine = screen.getByRole("region", { name: "Usage engine" }).textContent;
    expect(engine).toContain("0.63.0");
    expect(engine).toContain("0.23.0");
    expect(engine).toContain("Managed by VibeTV");
    expect(engine).toContain("~/Library/Application Support/VibeTV/usage-engine/0.63.0/usage-engine");
    expect(text).not.toContain("/Users/marcus");
  });

  it.each([
    ["bundled", "Built into VibeTV"],
    ["override", "Custom location"],
    ["system", "Installed app"],
    ["path", "Command line install"],
  ])("names the %s source in plain words", (source, words) => {
    show({ providerSetup: { engine: { status: "ready", version: "0.63.0", source } } });
    expect(screen.getByRole("region", { name: "Usage engine" }).textContent).toContain(words);
  });

  it("falls back to the diagnostics engine identity without its name", () => {
    show({ usageEngine: { name: "CodexBar", status: "ready", version: "0.63.0", path: "C:\\Users\\marcus\\AppData\\codexbar.exe" } });
    const engine = screen.getByRole("region", { name: "Usage engine" }).textContent;
    expect(engine).toContain("0.63.0");
    expect(engine).toContain("~\\AppData\\usage-engine.exe");
  });

  it("says an old engine is too old and offers the repair", () => {
    const repair = vi.fn();
    const text = show(
      {
        providerSetup: {
          status: "setup_required",
          engine: { status: "engine_incompatible", version: "0.17.0", minimumVersion: "0.23.0", source: "system", path: "/Applications/CodexBar.app/Contents/Helpers/codexbar" },
        },
      },
      { onRepairUsageEngine: repair },
    );
    expect(text).toContain("Usage engine 0.17.0 is too old. Version 0.23.0 or newer is required.");
    expect(text).toContain("Too old");
    fireEvent.click(screen.getByRole("button", { name: "Repair" }));
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("names the next action when no repair is reachable", () => {
    const text = show({ providerSetup: { engine: { status: "engine_incompatible", version: "0.17.0", minimumVersion: "0.23.0" } } });
    expect(text).toContain("Repair the usage engine, then check again.");
    expect(screen.queryByRole("button", { name: "Repair" })).toBeNull();
  });

  it("renders what a partial report has and says some checks did not run", () => {
    const text = show({
      ok: false,
      reportType: "control_center_fallback",
      collectionErrors: [{ source: "Mac App diagnostics", message: "unreachable" }],
      checks: [{ name: "companion_api", status: "fail", detail: "The Mac App diagnostics endpoint could not be reached.", nextAction: "Attach this report so support can inspect the setup state." }],
    });
    expect(text).toContain("Some checks could not run.");
    expect(text).toContain("Mac App");
    expect(text).toContain("Failed");
    expect(text).toContain("Attach this report");
  });

  it("never renders the engine's product name, whatever the payload says", () => {
    const text = show(report);
    expect(text).not.toMatch(/codexbar/i);
    expect(text).toContain("Open usage engine and sign in.");
    expect(text).toContain("Usage engine returned no usage.");
  });
});

describe("customer support text", () => {
  it("hides internal naming in unknown keys, whatever their case", () => {
    expect(humanize("companion")).toBe("Mac App");
    expect(humanize("companion_api_target")).toBe("Mac App VibeTV address");
    expect(humanize("codexbar_probe")).toBe("Usage engine probe");
    expect(humanize(undefined)).toBe("Not available");
  });

  it("maps the engine name to usage engine in every spelling", () => {
    expect(formatCustomerSupportText("CodexBar failed. Run codexbar again")).toBe(
      "Usage engine failed. Run usage engine again",
    );
  });

  it("abbreviates only the home folder", () => {
    expect(formatCustomerPath("/Users/anna/bin/tool")).toBe("~/bin/tool");
    expect(formatCustomerPath("/opt/homebrew/bin/tool")).toBe("/opt/homebrew/bin/tool");
    expect(formatCustomerPath("C:\\Users\\anna\\tool.exe")).toBe("~\\tool.exe");
    expect(
      formatCustomerPath("/Users/anna/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI"),
    ).not.toMatch(/codexbar/i);
    expect(formatCustomerSupportText("CodexBarCLI failed")).toBe("Usage engine failed");
  });
});
