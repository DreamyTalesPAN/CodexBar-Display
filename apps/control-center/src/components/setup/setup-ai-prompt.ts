import type { ApiError, ControlCenterEvent } from "../control-center-types";
import { redactSensitiveValues } from "../support-report";
import type { SetupStep } from "./setup-step";

const RECENT_EVENT_COUNT = 20;

const REPOSITORY = "https://github.com/DreamyTalesPAN/CodexBar-Display";

/**
 * Where each step is drawn, so the agent opens a file instead of guessing from
 * a step id. Paths are relative to the repository root.
 */
const SCREEN_SOURCE: Record<SetupStep, string> = {
  welcome: "apps/control-center/src/components/setup/setup-welcome-screen.tsx",
  device: "apps/control-center/src/components/setup/setup-device-screen.tsx",
  providers:
    "apps/control-center/src/components/setup/setup-providers-screen.tsx",
  display:
    "apps/control-center/src/components/setup/setup-display-mode-screen.tsx",
  theme: "apps/control-center/src/components/setup/setup-theme-screen.tsx",
  live: "apps/control-center/src/components/setup/setup-live-screen.tsx",
};

export type AiFixProviderState = {
  id: string;
  state?: string;
  message?: string;
};

export type AiFixPromptInput = {
  /** The Mac App's own version, not the background service's. */
  appVersion?: string;
  appBuild?: string;
  companionVersion?: string;
  companionCommit?: string;
  deviceSummary: string;
  /** Newest first, the way the app's event log stores them. */
  events: ControlCenterEvent[];
  lastError?: ApiError | null;
  osVersion?: string;
  providers?: AiFixProviderState[];
  screen: SetupStep;
  /** The log the failing screen is showing, which is not the event log. */
  setupLog?: string[];
};

/**
 * Builds the prompt the Help menu copies to the clipboard.
 *
 * It asks for a fix rather than for advice, and carries what a fix needs: the
 * repository, the file that draws the failing screen, both version numbers,
 * the error the app is holding, the provider states, and — separately — the
 * two logs. They are separate because they are separate stores: the wizard's
 * connect log is what the customer is looking at, while the app event log is
 * mostly empty during setup, and merging them made an empty event log read as
 * "nothing happened".
 *
 * It is assembled from named fields rather than from the support report, so
 * the loopback address the app deliberately keeps out of customer-visible
 * payloads cannot travel along by accident. Every field still goes through the
 * report's redaction on the way out.
 */
export function buildAiFixPrompt(input: AiFixPromptInput): string {
  const setupLog = (input.setupLog || [])
    .map((line) => clean(line))
    .filter(Boolean);
  const lines = [
    "You are an AI coding agent. Fix this VibeTV setup failure in the source",
    "repository below — do not just tell me what to check.",
    "",
    `Repository: ${REPOSITORY}`,
    `Failing screen: ${input.screen} — ${SCREEN_SOURCE[input.screen]}`,
    `Mac App: ${versionLabel(input.appVersion, input.appBuild)}${
      input.osVersion ? ` · macOS ${clean(input.osVersion)}` : ""
    }`,
    `Background service: ${versionLabel(
      input.companionVersion,
      input.companionCommit,
    )}`,
    `Device: ${clean(input.deviceSummary)}`,
    `Last error: ${errorLine(input.lastError)}`,
    `Providers: ${providerLine(input.providers)}`,
    "",
    "--- Setup log (what the screen is showing) ---",
    ...(setupLog.length > 0 ? setupLog : ["(this screen has logged nothing)"]),
    "",
    `--- App event log (last ${RECENT_EVENT_COUNT}) ---`,
    ...recentEventLines(input.events),
    "",
    "Clone the repository, reproduce the failure from the logs above, find the",
    "root cause in the code, and open a pull request with the fix.",
  ];
  return lines.join("\n");
}

function versionLabel(version?: string, suffix?: string): string {
  const base = clean(version) || "unknown version";
  const extra = clean(suffix);
  return extra ? `${base} (${extra})` : base;
}

function errorLine(error: ApiError | null | undefined): string {
  if (!error) {
    return "none";
  }
  return (
    [
      clean(error.code),
      clean(error.message),
      error.nextAction ? `next: ${clean(error.nextAction)}` : "",
    ]
      .filter(Boolean)
      .join(" — ") || "none"
  );
}

function providerLine(providers: AiFixProviderState[] | undefined): string {
  if (!providers || providers.length === 0) {
    return "none read yet";
  }
  return providers
    .map((provider) => {
      const state = clean(provider.state) || "unknown";
      const message = clean(provider.message);
      return `${clean(provider.id)}=${state}${message ? ` (${message})` : ""}`;
    })
    .join(", ");
}

function recentEventLines(events: ControlCenterEvent[]): string[] {
  if (events.length === 0) {
    return ["(no activity recorded yet)"];
  }
  return events
    .slice(0, RECENT_EVENT_COUNT)
    .reverse()
    .map((event) =>
      clean([event.at, event.label, event.detail].filter(Boolean).join(" · ")),
    );
}

function clean(value: string | undefined): string {
  return typeof value === "string"
    ? (redactSensitiveValues(value) as string).trim()
    : "";
}
