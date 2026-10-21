import { type ControlCenterEvent, type UsageSnapshot } from "./control-center-types";
import { hostDateTimeFormat } from "./control-center-runtime";

// The Help menu hands the last 20 of these to an AI along with the current
// screen, so the log has to be at least that deep.
export const RECENT_EVENT_LIMIT = 20;

/**
 * Recent activity, newest first. An entry that says the same as an earlier one
 * takes its place instead of standing beside it, so the Support page does not
 * list the same entry again after every other one (issues #548, #558). The
 * entry carries the time of the latest occurrence, so a failure that repeats
 * does not look like an old one.
 */
export function recentEventsWith(
  events: ControlCenterEvent[],
  event: ControlCenterEvent,
): ControlCenterEvent[] {
  return [
    event,
    ...events.filter(
      (earlier) => earlier.label !== event.label || earlier.detail !== event.detail,
    ),
  ].slice(0, RECENT_EVENT_LIMIT);
}

export function usageRefreshEvent(payload: UsageSnapshot): {
  label: string;
  detail: string;
  tone: "ready" | "attention";
} {
  switch (payload.refresh?.state) {
    case "refreshing":
      return {
        label: "Usage refresh started",
        detail: "VibeTV is waiting for a new usage snapshot.",
        tone: "attention",
      };
    case "unavailable":
      return {
        label: "Usage is still loading",
        detail: "VibeTV will update automatically when usage is ready.",
        tone: "attention",
      };
    default:
      return {
        label: "Usage refreshed",
        detail: `${payload.providers?.length || 0} provider tiles loaded.`,
        tone: payload.providers?.length ? "ready" : "attention",
      };
  }
}

export function formatTime(): string {
  return hostDateTimeFormat({
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}
