/**
 * The one place server-provided support text becomes customer words. The
 * usage engine's product name is never shown to customers.
 */
export function formatCustomerSupportText(value: string): string {
  return hideUsageEngineName(value)
    // The healthy answer of the check "Display updates" (issue #558).
    .replace("Display stream is sending usage frames.", "VibeTV is receiving your usage.")
    .replace(/\bCompanion\s+API\b/gi, "Mac App")
    .replace(/\bCompanion\b/g, "Mac App")
    .replace(/\bbridge\b/gi, "Mac App")
    .replace(/\bdaemon\b/gi, "Mac App")
    .replace(/\blocal\s+API\b/gi, "Mac App")
    .replace(/\bAPI\b/g, "app")
    .replace(/\btarget\b/gi, "VibeTV address")
    .replace(/\bCOMPANION_UNREACHABLE\b/g, "Mac App needs setup")
    .replace(/\bCLIENT_ERROR\b/g, "Something needs attention")
    .replace(/\bHTTP_\d+\b/g, "Connection failed")
    .replace(/https?:\/\/\S+/g, "saved link");
}

/** Replaces the engine's product name, and only that. */
export function hideUsageEngineName(value: string): string {
  return value
    // The engine words its Gemini remedy for its own app. Inside VibeTV the
    // provider is switched on by its name alone.
    .replace(/\b(?:Win-)?CodexBar's Antigravity provider\b/gi, "Antigravity")
    // No word boundary: "CodexBarCLI" and "CodexBar.app" must go too.
    .replace(/codexbar(?:cli)?/gi, "usage engine")
    .replace(/(^|[.!?]\s+)usage engine/g, "$1Usage engine");
}

/**
 * An unknown server key (check name, stage, source) as customer words.
 * Capitalizes before formatting so "companion_api" is caught as "Companion".
 */
export function humanize(value?: string): string {
  const text = (value ?? "").replace(/[_-]+/g, " ").trim();
  return text
    ? formatCustomerSupportText(text.charAt(0).toUpperCase() + text.slice(1))
    : "Not available";
}
