import type { ControlCenterEvent } from "../control-center-types";
import { redactSensitiveValues } from "../support-report";

const RECENT_EVENT_COUNT = 20;

export type AiFixPromptInput = {
  appVersion?: string;
  deviceSummary: string;
  events: ControlCenterEvent[];
  osVersion?: string;
  screen: string;
};

/**
 * Builds the prompt the Help menu copies to the clipboard.
 *
 * It is assembled from named fields rather than from the support report, so
 * the loopback address the app deliberately keeps out of customer-visible
 * payloads cannot travel along by accident. Every field still goes through the
 * report's redaction on the way out.
 */
export function buildAiFixPrompt(input: AiFixPromptInput): string {
  const lines = [
    "I need help with my VibeTV setup.",
    `Current screen: ${clean(input.screen)}`,
    `App: VibeTV Control Center ${clean(input.appVersion) || "unknown version"}${
      input.osVersion ? ` · macOS ${clean(input.osVersion)}` : ""
    }`,
    `Device: ${clean(input.deviceSummary)}`,
    `--- Support log (last ${RECENT_EVENT_COUNT} lines) ---`,
    ...recentEventLines(input.events),
    "What should I check to finish setting up my VibeTV?",
  ];
  return lines.join("\n");
}

function recentEventLines(events: ControlCenterEvent[]): string[] {
  if (events.length === 0) {
    return ["(no activity recorded yet)"];
  }
  return events
    .slice(0, RECENT_EVENT_COUNT)
    .reverse()
    .map((event) =>
      clean(
        [event.at, event.label, event.detail].filter(Boolean).join(" · "),
      ),
    );
}

function clean(value: string | undefined): string {
  return typeof value === "string"
    ? (redactSensitiveValues(value) as string).trim()
    : "";
}
