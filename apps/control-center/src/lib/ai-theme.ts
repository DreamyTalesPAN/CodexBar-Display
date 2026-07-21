import { companionOrigin } from "@/components/control-center-runtime";
import {
  importThemeSpec,
  validateThemeSpec,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";

export type AIThemeProviderId = "openai" | "anthropic";
export type AIThemeMode = "create" | "improve";
export type AIThemeMessage = {
  content: string;
  createdAt: string;
  role: "assistant" | "user";
};
export type AIThemeCandidate = {
  notes: string;
  packName: string;
  spec: ThemeStudioSpec;
};
export type AIThemeCapabilities = {
  enabled: boolean;
  providers: Array<{ configured: boolean; id: AIThemeProviderId }>;
};

const HISTORY_PREFIX = "vibetv.aiTheme.history.v1.";
export const AI_THEME_LOCAL_HISTORY_LIMIT = 20;
export const AI_THEME_TRANSMITTED_HISTORY_LIMIT = 10;

export async function fetchAIThemeCapabilities(
  signal?: AbortSignal,
): Promise<AIThemeCapabilities> {
  return aiRequest<AIThemeCapabilities>("/v1/ai-theme/capabilities", {
    method: "GET",
    signal,
  });
}

export async function saveAIThemeCredential(
  provider: AIThemeProviderId,
  apiKey: string,
): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/credential`, {
    body: JSON.stringify({ apiKey }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

export async function deleteAIThemeCredential(
  provider: AIThemeProviderId,
): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/credential`, {
    method: "DELETE",
  });
}

export async function verifyAIThemeCredential(
  provider: AIThemeProviderId,
): Promise<void> {
  await aiRequest(`/v1/ai-theme/providers/${provider}/verify`, {
    method: "POST",
  });
}

export async function generateAITheme(
  input: {
    baseSpec?: ThemeStudioSpec;
    history: AIThemeMessage[];
    mode: AIThemeMode;
    prompt: string;
    providerId: AIThemeProviderId;
  },
  signal?: AbortSignal,
): Promise<AIThemeCandidate> {
  const payload = await aiRequest<{ notes: string; packName: string; spec: unknown }>(
    "/v1/ai-theme/generations",
    {
      body: JSON.stringify({
        ...input,
        history: input.history
          .slice(-AI_THEME_TRANSMITTED_HISTORY_LIMIT)
          .map(({ content, role }) => ({ content, role })),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    },
  );
  const spec = importThemeSpec(payload.spec);
  const validation = validateThemeSpec(spec);
  if (validation.errors.length > 0 || validation.primitiveCount > 16) {
    throw new Error(validation.errors[0] || "AI returned too many elements.");
  }
  return { notes: payload.notes, packName: payload.packName, spec };
}

export function loadAIThemeHistory(
  themeId: string,
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): AIThemeMessage[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(historyKey(themeId)) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is AIThemeMessage =>
          item &&
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          typeof item.createdAt === "string",
      )
      .slice(-AI_THEME_LOCAL_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveAIThemeHistory(
  themeId: string,
  history: AIThemeMessage[],
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): void {
  if (!storage) return;
  const sanitized = history
    .map((message) => ({
      content: message.content.slice(0, 2000),
      createdAt: message.createdAt,
      role: message.role,
    }))
    .slice(-AI_THEME_LOCAL_HISTORY_LIMIT);
  storage.setItem(historyKey(themeId), JSON.stringify(sanitized));
}

function historyKey(themeId: string): string {
  return `${HISTORY_PREFIX}${themeId.replace(/[^a-z0-9_-]/gi, "_")}`;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

async function aiRequest<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${companionOrigin()}${path}`, init);
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string } }
    | T
    | null;
  if (!response.ok) {
    const code =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error?.code
        : undefined;
    throw new Error(aiErrorMessage(code));
  }
  return payload as T;
}

function aiErrorMessage(code?: string): string {
  switch (code) {
    case "credential_missing": return "Add and verify your provider key first.";
    case "provider_auth_failed": return "The provider rejected this key.";
    case "provider_rate_limited": return "The provider rate limit was reached. Try again later.";
    case "rate_limited_or_busy": return "One generation is already running or the local limit was reached.";
    case "feature_disabled": return "AI Theme Builder is not enabled in this build.";
    case "provider_timeout": return "The provider took too long. Try again.";
    case "provider_invalid_response": return "The provider returned an invalid theme.";
    default: return "AI Theme Builder could not complete this request.";
  }
}
