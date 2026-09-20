export function agentThemeState(phase: string): string {
  if (
    ["coding", "working", "thinking", "tool_use", "compacting"].includes(phase)
  )
    return "coding";
  if (
    [
      "waiting_for_permission",
      "waiting_for_answer",
      "waiting_for_review",
    ].includes(phase)
  )
    return "needs_you";
  if (["idle", "done", "error"].includes(phase)) return phase;
  return "unavailable";
}

export function agentStatusText(phase: string, name: string): string {
  switch (agentThemeState(phase)) {
    case "coding":
      return `${name} is working`;
    case "needs_you":
      return `${name} needs you`;
    case "done":
      return `${name} is done`;
    case "error":
      return `${name} hit an error`;
    case "idle":
      return "Nothing running";
    default:
      return "Agent status unavailable";
  }
}
