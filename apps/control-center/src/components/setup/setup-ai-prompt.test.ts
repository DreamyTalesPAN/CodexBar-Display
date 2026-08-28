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
  it("names the screen, the app and the device so the AI has the context", () => {
    const prompt = buildAiFixPrompt({
      appVersion: "1.4.2",
      deviceSummary: "not found yet",
      events: [],
      osVersion: "15.2",
      screen: "Welcome",
    });

    expect(prompt).toContain("Current screen: Welcome");
    expect(prompt).toContain("App: VibeTV Control Center 1.4.2 · macOS 15.2");
    expect(prompt).toContain("Device: not found yet");
    expect(prompt).toContain("(no activity recorded yet)");
  });

  it("says the version is unknown rather than inventing one", () => {
    const prompt = buildAiFixPrompt({
      deviceSummary: "not found yet",
      events: [],
      screen: "Welcome",
    });

    expect(prompt).toContain("App: VibeTV Control Center unknown version");
    expect(prompt).not.toContain("macOS");
  });

  it("carries at most twenty log lines, oldest first", () => {
    const events = Array.from({ length: 25 }, (_, index) =>
      event(`${index}`, `step ${index}`),
    );
    const prompt = buildAiFixPrompt({
      deviceSummary: "connected",
      events,
      screen: "Choose your VibeTV",
    });
    const logged = prompt
      .split("\n")
      .filter((line) => line.includes("step "));

    expect(logged).toHaveLength(20);
    expect(logged[0]).toContain("step 19");
    expect(logged.at(-1)).toContain("step 0");
  });

  it("redacts a token that reached the log", () => {
    const prompt = buildAiFixPrompt({
      deviceSummary: "connected",
      events: [event("1", "pairing", 'deviceToken: "abc123secret"')],
      screen: "Choose your VibeTV",
    });

    expect(prompt).not.toContain("abc123secret");
    expect(prompt).toContain("[redacted]");
  });

  it("cannot leak the loopback address, because it never receives it", () => {
    const prompt = buildAiFixPrompt({
      deviceSummary: "connected · 192.168.178.153",
      events: [event("1", "search", "found 1 VibeTV")],
      screen: "Choose your VibeTV",
    });

    expect(prompt).not.toContain("127.0.0.1");
    expect(prompt).not.toContain("47832");
  });
});
