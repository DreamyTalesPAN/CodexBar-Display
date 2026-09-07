import { describe, expect, it } from "vitest";
import type { ControlCenterEvent } from "../control-center-types";
import { buildAiFixPrompt } from "./setup-ai-prompt";

function event(
  id: string,
  label: string,
  detail = "",
  at = "14:02:11",
): ControlCenterEvent {
  return { id, label, detail, at };
}

describe("buildAiFixPrompt", () => {
  it("repairs the local setup first and leaves a pull request to the user", () => {
    const prompt = buildAiFixPrompt({
      appVersion: "1.4.2",
      deviceSummary: "not found yet",
      events: [],
      osVersion: "15.2",
      screen: "welcome",
    });

    expect(prompt).toContain(
      "https://github.com/DreamyTalesPAN/CodexBar-Display",
    );
    expect(prompt).toContain("first and highest priority");
    expect(prompt).toContain("First diagnose and repair the local setup");
    expect(prompt).toMatch(/ask\s+whether I want a pull request/);
    expect(prompt).toContain("without my explicit approval");
    expect(prompt).toContain("Do not clone the repository");
    expect(prompt).not.toContain("Clone the repository");
    expect(prompt).not.toContain("open a pull request with the fix");
  });

  it("names the file that draws the failing screen", () => {
    expect(buildAiFixPrompt({ ...base, screen: "device" })).toContain(
      "apps/control-center/src/components/setup/setup-device-screen.tsx",
    );
    expect(buildAiFixPrompt({ ...base, screen: "providers" })).toContain(
      "apps/control-center/src/components/setup/setup-providers-screen.tsx",
    );
  });

  it("separates the Mac App version from the background service version", () => {
    const prompt = buildAiFixPrompt({
      ...base,
      appBuild: "318",
      appVersion: "1.4.2",
      companionCommit: "a1b2c3d",
      companionVersion: "9999.0.82",
      osVersion: "15.2",
    });

    expect(prompt).toContain("Mac App: 1.4.2 (318) · macOS 15.2");
    expect(prompt).toContain("Background service: 9999.0.82 (a1b2c3d)");
  });

  it("says the version is unknown rather than inventing one", () => {
    const prompt = buildAiFixPrompt(base);

    expect(prompt).toContain("Mac App: unknown version");
    expect(prompt).not.toContain("macOS");
  });

  it("carries the log the screen is showing, which the event log is not", () => {
    const prompt = buildAiFixPrompt({
      ...base,
      events: [event("1", "Control Center opened", "Browser session started.")],
      setupLog: [
        "connecting to 192.168.178.153",
        "error: connection could not be completed",
      ],
    });

    expect(prompt).toContain("--- Setup log (what the screen is showing) ---");
    expect(prompt).toContain("error: connection could not be completed");
    expect(prompt).toContain("--- App event log (last 20) ---");
    expect(prompt).toContain("Control Center opened");
  });

  it("marks an empty setup log as empty instead of leaving it out", () => {
    const prompt = buildAiFixPrompt(base);

    expect(prompt).toContain("(this screen has logged nothing)");
  });

  it("carries the error the app is holding, with its next action", () => {
    const prompt = buildAiFixPrompt({
      ...base,
      lastError: {
        code: "device_not_found",
        message: "We couldn't find your VibeTV.",
        nextAction: "Check that VibeTV is powered on, then search again.",
      },
    });

    expect(prompt).toContain(
      "Last error: device_not_found — We couldn't find your VibeTV. — next: Check that VibeTV is powered on, then search again.",
    );
  });

  it("reports every provider state, so a stuck sign-in is visible", () => {
    const prompt = buildAiFixPrompt({
      ...base,
      providers: [
        { id: "codex", state: "auth_required", message: "Sign in to Codex." },
        { id: "cursor", state: "healthy" },
      ],
    });

    expect(prompt).toContain(
      "Providers: codex=auth_required (Sign in to Codex.), cursor=healthy",
    );
  });

  it("says so when nothing has been read yet rather than claiming none exist", () => {
    expect(buildAiFixPrompt(base)).toContain("Providers: none read yet");
    expect(buildAiFixPrompt(base)).toContain("Last error: none");
  });

  it("carries at most twenty event lines, oldest first", () => {
    const events = Array.from({ length: 25 }, (_, index) =>
      event(`${index}`, `step ${index}`),
    );
    const prompt = buildAiFixPrompt({
      ...base,
      deviceSummary: "connected",
      events,
    });
    const logged = prompt.split("\n").filter((line) => line.includes("step "));

    expect(logged).toHaveLength(20);
    expect(logged[0]).toContain("step 19");
    expect(logged.at(-1)).toContain("step 0");
  });

  it("redacts a token that reached either log", () => {
    const prompt = buildAiFixPrompt({
      ...base,
      deviceSummary: "connected",
      events: [event("1", "pairing", 'deviceToken: "abc123secret"')],
      setupLog: ['pairing with deviceToken: "def456secret"'],
    });

    expect(prompt).not.toContain("abc123secret");
    expect(prompt).not.toContain("def456secret");
    expect(prompt).toContain("[redacted]");
  });

  it("cannot leak the loopback address, because it never receives it", () => {
    const prompt = buildAiFixPrompt({
      ...base,
      deviceSummary: "connected · 192.168.178.153",
      events: [event("1", "search", "found 1 VibeTV")],
    });

    expect(prompt).not.toContain("127.0.0.1");
    expect(prompt).not.toContain("47832");
  });
});

const base = {
  deviceSummary: "not found yet",
  events: [] as ControlCenterEvent[],
  screen: "device" as const,
};
