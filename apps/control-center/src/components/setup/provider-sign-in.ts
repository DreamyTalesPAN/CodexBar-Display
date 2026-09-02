/**
 * Where a customer actually signs a provider in.
 *
 * This is knowledge the Mac App would rather not hold — the usage service owns
 * provider behaviour — but it publishes no sign-in destination in any released
 * version (checked against the pinned 0.46.0 and against 0.56.2, whose error
 * object is still `code` / `kind` / `message` and nothing more). Its prose is
 * forwarded where it helps, and it is measurably not enough on its own:
 *
 *   - For 36 of 69 providers it answers "No available fetch strategy for <id>."
 *     That means every route it tried was unavailable, not that the provider
 *     cannot be signed into — Copilot and Grok both have working ones.
 *   - For Cursor and Augment it says to sign in "via the CodexBar menu", and
 *     that is wrong on the merits: both are read out of browser cookies, so the
 *     provider's own website is what fixes them.
 *   - For Codex and Claude it names no destination at all, though the engine's
 *     own help documents them: the OpenAI web dashboard and the claude.ai API.
 *
 * Entries are only added for a destination that has been checked against the
 * bundled engine. A provider that is missing here shows the engine's sentence
 * and no control, which is the honest answer when we do not know where to send
 * anyone.
 */
export type ProviderSignIn =
  | { kind: "url"; url: string }
  | { kind: "command"; command: string }
  | { kind: "full-disk-access" };

/**
 * Providers the engine reads out of a browser session, with the page a login
 * there actually writes that session on.
 */
const SIGN_IN_URLS: Record<string, string> = {
  amp: "https://ampcode.com",
  augment: "https://app.augmentcode.com",
  claude: "https://claude.ai",
  codex: "https://chatgpt.com",
  cursor: "https://cursor.com",
  deepseek: "https://platform.deepseek.com",
  factory: "https://app.factory.ai",
  grok: "https://grok.com",
  ollama: "https://ollama.com/signin",
  windsurf: "https://windsurf.com",
};

/**
 * Providers whose credential lives on disk, written by their own CLI. A web
 * address here would be the page that cannot help: signing in with a browser
 * puts nothing where the engine looks.
 */
const SIGN_IN_COMMANDS: Record<string, string> = {
  antigravity: "agy",
  gemini: "gemini",
  kilo: "kilo login",
};

/**
 * The engine cannot read Safari's cookie file without Full Disk Access, and
 * says so in the message. That is the top blocker on a Mac whose customer is
 * already signed in everywhere — sending them to a login page would be the
 * second-most useless thing the screen could do.
 */
function needsFullDiskAccess(reported: string | undefined): boolean {
  const message = (reported || "").toLowerCase();
  return (
    message.includes("full disk access") ||
    message.includes("browser cookie access denied")
  );
}

export function providerSignInFor(
  providerId: string,
  reported?: string,
): ProviderSignIn | null {
  if (needsFullDiskAccess(reported)) {
    return { kind: "full-disk-access" };
  }
  const url = SIGN_IN_URLS[providerId];
  if (url) {
    return { kind: "url", url };
  }
  const command = SIGN_IN_COMMANDS[providerId];
  if (command) {
    return { kind: "command", command };
  }
  return null;
}

/** What the control says it will do. */
export function providerSignInLabel(
  signIn: ProviderSignIn,
  label: string,
): string {
  switch (signIn.kind) {
    case "url":
      return `Sign in to ${label}`;
    case "command":
      return `Copy the ${label} sign-in command`;
    case "full-disk-access":
      return "Open Full Disk Access settings";
  }
}
