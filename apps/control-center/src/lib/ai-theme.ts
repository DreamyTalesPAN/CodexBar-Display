import {
  importThemeSpec,
  normalizeThemeSpec,
  validateThemeSpec,
  type ThemeStudioAsset,
  type ThemeStudioSpec,
} from "./theme-studio";

export type AiThemeProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "together"
  | "fireworks"
  | "cohere"
  | "openai-compatible";

export type AiThemeProvider = {
  id: AiThemeProviderId;
  label: string;
  defaultModel: string;
  keyPlaceholder: string;
  baseUrl?: string;
  needsBaseUrl?: boolean;
};

export type AiThemeProviderSettings = {
  apiKey: string;
  baseUrl?: string;
  model: string;
};

export type AiThemeSettings = {
  selectedProviderId: AiThemeProviderId;
  providers: Partial<Record<AiThemeProviderId, AiThemeProviderSettings>>;
};

export type AiThemeProviderSession = {
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
};

export type AiThemeMode = "new" | "refine";

export type AiThemeDraft = {
  assets: Record<string, ThemeStudioAsset>;
  notes: string[];
  packName: string;
  spec: ThemeStudioSpec;
};

export type AiThemeProgressEvent = {
  message: string;
};

export type AiThemePromptRequest = Pick<
  GenerateAiThemeDraftRequest,
  "attachments" | "baseAssets" | "basePackName" | "baseSpec" | "description" | "messages" | "mode"
>;

export type AiThemeChatAttachmentSummary = {
  frameCount?: number;
  fps?: number;
  height?: number;
  kind: "gif" | "sprite";
  name: string;
  path: string;
  width?: number;
};

export type AiThemeAssetAttachment = AiThemeChatAttachmentSummary & {
  asset: ThemeStudioAsset;
};

export type AiThemeChatMessage = {
  attachments?: AiThemeChatAttachmentSummary[];
  createdAt: string;
  id: string;
  role: "assistant" | "user";
  text: string;
};

export type AiThemeChatHistory = {
  messages: AiThemeChatMessage[];
  themeId: string;
  updatedAt: string;
};

export type GenerateAiThemeDraftRequest = {
  attachments?: AiThemeAssetAttachment[];
  baseAssets?: Record<string, ThemeStudioAsset>;
  basePackName?: string;
  baseSpec?: ThemeStudioSpec;
  description: string;
  messages?: AiThemeChatMessage[];
  mode: AiThemeMode;
  onProgress?: (event: AiThemeProgressEvent) => void;
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
};

export type VerifyAiThemeProviderRequest = {
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
};

type UnknownRecord = Record<string, unknown>;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type OpenAiResponsesResponse = {
  error?: unknown;
  incomplete_details?: unknown;
  output?: unknown;
  output_text?: unknown;
  status?: unknown;
};

type AnthropicResponse = {
  content?: Array<{
    text?: unknown;
    type?: unknown;
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: unknown;
      }>;
    };
  }>;
};

type CohereResponse = {
  message?: {
    content?: Array<{
      text?: unknown;
      type?: unknown;
    }>;
  };
  text?: unknown;
};

export const AI_THEME_SETTINGS_STORAGE_KEY = "vibetv.controlCenter.aiThemeSettings";
export const AI_THEME_CHAT_HISTORY_STORAGE_KEY =
  "vibetv.controlCenter.aiThemeChatHistory";

export const AI_THEME_PROVIDERS: AiThemeProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    keyPlaceholder: "sk-...",
    baseUrl: "https://api.openai.com/v1/responses",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-5",
    keyPlaceholder: "sk-ant-...",
    baseUrl: "https://api.anthropic.com/v1/messages",
  },
  {
    id: "google",
    label: "Google Gemini",
    defaultModel: "gemini-3.5-flash",
    keyPlaceholder: "AIza...",
  },
  {
    id: "xai",
    label: "xAI",
    defaultModel: "grok-4.5",
    keyPlaceholder: "xai-...",
    baseUrl: "https://api.x.ai/v1/chat/completions",
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral-medium-latest",
    keyPlaceholder: "...",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    keyPlaceholder: "sk-...",
    baseUrl: "https://api.deepseek.com/chat/completions",
  },
  {
    id: "groq",
    label: "Groq",
    defaultModel: "openai/gpt-oss-120b",
    keyPlaceholder: "gsk_...",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "openai/gpt-4.1-mini",
    keyPlaceholder: "sk-or-...",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
  },
  {
    id: "together",
    label: "Together AI",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    keyPlaceholder: "...",
    baseUrl: "https://api.together.ai/v1/chat/completions",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    keyPlaceholder: "fw_...",
    baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
  },
  {
    id: "cohere",
    label: "Cohere",
    defaultModel: "command-a-plus-05-2026",
    keyPlaceholder: "...",
    baseUrl: "https://api.cohere.com/v2/chat",
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    defaultModel: "",
    keyPlaceholder: "Optional API key",
    needsBaseUrl: true,
  },
];

const DEFAULT_PROVIDER_ID: AiThemeProviderId = "openai";

export function defaultAiThemeSettings(): AiThemeSettings {
  return {
    selectedProviderId: DEFAULT_PROVIDER_ID,
    providers: {},
  };
}

export function readAiThemeSettings(): AiThemeSettings {
  if (typeof window === "undefined") {
    return defaultAiThemeSettings();
  }
  try {
    const raw = window.localStorage.getItem(AI_THEME_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaultAiThemeSettings();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return defaultAiThemeSettings();
    }
    const selected = providerById(stringValue(parsed.selectedProviderId));
    const providers: Partial<Record<AiThemeProviderId, AiThemeProviderSettings>> = {};
    if (isRecord(parsed.providers)) {
      for (const provider of AI_THEME_PROVIDERS) {
        const value = parsed.providers[provider.id];
        if (!isRecord(value)) {
          continue;
        }
        providers[provider.id] = {
          apiKey: stringValue(value.apiKey) || "",
          baseUrl: stringValue(value.baseUrl) || provider.baseUrl || "",
          model: stringValue(value.model) || provider.defaultModel,
        };
      }
    }
    return {
      selectedProviderId: selected.id,
      providers,
    };
  } catch {
    return defaultAiThemeSettings();
  }
}

export function writeAiThemeSettings(settings: AiThemeSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    AI_THEME_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  );
}

export function readAiThemeChatHistory(themeId: string): AiThemeChatMessage[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw =
      window.localStorage.getItem(aiThemeChatHistoryStorageKey(themeId)) ||
      window.localStorage.getItem(AI_THEME_CHAT_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || stringValue(parsed.themeId) !== themeId) {
      return [];
    }
    return chatMessagesValue(parsed.messages);
  } catch {
    return [];
  }
}

export function writeAiThemeChatHistory(
  themeId: string,
  messages: AiThemeChatMessage[],
) {
  if (typeof window === "undefined") {
    return;
  }
  const history: AiThemeChatHistory = {
    messages: messages.slice(-20),
    themeId,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(
    aiThemeChatHistoryStorageKey(themeId),
    JSON.stringify(history),
  );
}

function aiThemeChatHistoryStorageKey(themeId: string): string {
  const safeThemeId = themeId.replace(/[^a-z0-9_-]+/gi, "-") || "draft";
  return `${AI_THEME_CHAT_HISTORY_STORAGE_KEY}.${safeThemeId}`;
}

export function providerById(value: unknown): AiThemeProvider {
  return (
    AI_THEME_PROVIDERS.find((provider) => provider.id === value) ||
    AI_THEME_PROVIDERS[0]
  );
}

export function defaultProviderSettings(
  provider: AiThemeProvider,
): AiThemeProviderSettings {
  return {
    apiKey: "",
    baseUrl: provider.baseUrl || "",
    model: provider.defaultModel,
  };
}

export function readReadyAiThemeProviderSession(): AiThemeProviderSession | null {
  const settings = readAiThemeSettings();
  const provider = providerById(settings.selectedProviderId);
  const providerSettings = {
    ...defaultProviderSettings(provider),
    ...settings.providers[provider.id],
  };
  const ready =
    provider.id === "openai-compatible"
      ? Boolean(providerSettings.baseUrl?.trim() && providerSettings.model.trim())
      : Boolean(providerSettings.apiKey.trim() && providerSettings.model.trim());
  return ready ? { provider, settings: providerSettings } : null;
}

export async function generateAiThemeDraft({
  attachments = [],
  baseAssets = {},
  basePackName,
  baseSpec,
  description,
  messages = [],
  mode,
  onProgress,
  provider,
  settings,
}: GenerateAiThemeDraftRequest): Promise<AiThemeDraft> {
  const { assetContext, prompt, system } = buildAiThemePrompt({
    attachments,
    baseAssets,
    basePackName,
    baseSpec,
    description,
    messages,
    mode,
  });

  let rawText: string;
  if (provider.id === "anthropic") {
    rawText = await generateAnthropic({ prompt, provider, settings, system });
  } else if (provider.id === "google") {
    rawText = await generateGemini({ prompt, settings, system });
  } else if (provider.id === "cohere") {
    rawText = await generateCohere({ prompt, provider, settings, system });
  } else if (provider.id === "openai") {
    rawText = await generateOpenAiResponses({ prompt, provider, settings, system });
  } else {
    rawText = await generateOpenAiCompatible({ prompt, provider, settings, system });
  }

  const draft = parseAiDraft(rawText, assetContext);
  emitAiThemeProgress(onProgress, `Applied ${draft.packName}.`);
  return draft;
}

function emitAiThemeProgress(
  onProgress: GenerateAiThemeDraftRequest["onProgress"],
  message: string,
) {
  onProgress?.({ message });
}

export function buildAiThemePrompt({
  attachments = [],
  baseAssets = {},
  basePackName,
  baseSpec,
  description,
  messages = [],
  mode,
}: AiThemePromptRequest): {
  assetContext: Record<string, ThemeStudioAsset>;
  prompt: string;
  system: string;
} {
  return {
    assetContext: {
      ...baseAssets,
      ...Object.fromEntries(
        attachments.map((attachment) => [attachment.path, attachment.asset]),
      ),
    },
    prompt: buildThemePrompt({
      attachments,
      basePackName,
      baseSpec,
      description,
      messages,
      mode,
    }),
    system: [
      "You generate valid VibeTV Theme Studio JSON only.",
      "Return exactly one JSON object and no markdown.",
      "The JSON object must match the requested shape.",
    ].join(" "),
  };
}

export async function verifyAiThemeProvider({
  provider,
  settings,
}: VerifyAiThemeProviderRequest): Promise<void> {
  const system = "Return exactly one JSON object and no markdown.";
  const prompt = "Return this JSON object exactly: {\"ok\":true}";
  let rawText: string;
  if (provider.id === "anthropic") {
    rawText = await generateAnthropic({ prompt, provider, settings, system, maxTokens: 40 });
  } else if (provider.id === "google") {
    rawText = await generateGemini({ prompt, settings, system });
  } else if (provider.id === "cohere") {
    rawText = await generateCohere({ prompt, provider, settings, system, maxTokens: 40 });
  } else if (provider.id === "openai") {
    rawText = await generateOpenAiResponses({ prompt, provider, settings, system, maxTokens: 256 });
  } else {
    rawText = await generateOpenAiCompatible({ prompt, provider, settings, system, maxTokens: 40 });
  }
  const parsed = parseJsonObject(rawText);
  if (!isRecord(parsed) || parsed.ok !== true) {
    throw new Error("Provider answered, but verification JSON was invalid.");
  }
}

function buildThemePrompt({
  attachments,
  basePackName,
  baseSpec,
  description,
  messages,
  mode,
}: {
  attachments: AiThemeAssetAttachment[];
  basePackName?: string;
  baseSpec?: ThemeStudioSpec;
  description: string;
  messages: AiThemeChatMessage[];
  mode: AiThemeMode;
}) {
  const base = baseSpec
    ? `\nCurrent theme name: ${basePackName || baseSpec.themeId}\nCurrent ThemeSpec JSON:\n${JSON.stringify(baseSpec)}\n`
    : "";
  const intent =
    mode === "refine" && baseSpec
      ? "Refine the current theme while keeping its basic information hierarchy."
      : "Create a new theme.";
  const history = messages.length
    ? `\nPrevious chat messages, oldest first:\n${messages
        .slice(-10)
        .map((message) => {
          const attached = message.attachments?.length
            ? ` Attachments: ${message.attachments
                .map((attachment) => `${attachment.name} at ${attachment.path}`)
                .join(", ")}.`
            : "";
          return `${message.role.toUpperCase()}: ${message.text}${attached}`;
        })
        .join("\n")}\n`
    : "";
  const attachmentList = attachments.length
    ? `\nNewly attached assets you may place in the theme:\n${attachments
        .map((attachment) => {
          const size =
            attachment.width && attachment.height
              ? `, ${attachment.width}x${attachment.height}`
              : "";
          const frames = attachment.frameCount
            ? `, ${attachment.frameCount} frames`
            : "";
          const fps = attachment.fps ? `, ${attachment.fps} fps` : "";
          return `- ${attachment.name}: ${attachment.kind}${size}${frames}${fps}, assetPath "${attachment.path}"`;
        })
        .join("\n")}\n`
    : "";

  return `${intent}
${history}

User description:
${description}
${base}
${attachmentList}
Return JSON with this exact top-level shape:
{
  "packName": "Human readable name",
  "spec": {
    "themeSpecVersion": 1,
    "themeId": "lowercase-id",
    "themeRev": 1,
    "fallbackTheme": "mini",
    "bgColor": "#000000",
    "primitives": []
  },
  "assets": {},
  "notes": []
}

Hard rules:
- Display is exactly 240 by 240 pixels.
- Use only these primitive types: rect, text, progress, gif, sprite.
- Use gif or sprite only for current theme assets or newly attached assets listed above.
- For gif/sprite primitives, set assetPath to the exact listed path. Do not invent asset paths.
- Do not put base64, sprite text, external URLs, markdown, image, or pixels in the JSON.
- Keep the ThemeSpec small: ideally 8-14 primitives, never more than 16.
- Every primitive x and y must be whole numbers >= 0.
- Every rect and progress primitive needs width and height.
- Every gif primitive needs width and height.
- Sprite primitives should include width, height, frameCount, and fps when known.
- Keep every primitive inside the 240x240 display.
- Validator warnings are fatal. The theme is rejected if any primitive sits outside 240x240.
- Use colors only as #RRGGBB.
- themeSpecVersion must be 1, themeRev must be 1, fallbackTheme must be "mini".
- themeId must be lowercase and match letters, numbers, hyphens, or underscores, 3-64 chars.
- Include dynamic usage data:
  - one session progress primitive with binding "session"
  - one weekly progress primitive with binding "weekly"
  - visible text using {session}% and {weekly}%
  - a label or title text
- Allowed text tokens: {label}, {session}, {weekly}, {reset}, {usageMode}, {time}, {date}.
- Font sizes should be 1-5, with most text at 2-4.
- Good layouts leave breathing room and do not overlap text.
- notes should contain at most 3 short strings explaining the design choices.

Layout quality rules:
- Use an 8px safe margin. Prefer x/y between 8 and 224.
- Estimate text width as text.length * fontSize * 6 and text height as fontSize * 8.
- For every text primitive, ensure x + estimatedTextWidth <= 232 and y + estimatedTextHeight <= 232.
- Keep titles short: max 16 visible characters, fontSize 3 or 4, x 10-24, y 8-20.
- Do not use fontSize 5 unless the text is under 8 visible characters.
- Progress bars should usually use x 14-24, width 180-210, height 8-14.
- Two metric layouts should use these safe zones:
  - title: x 14 y 10 fontSize 3
  - session label/value: x 14 y 44 fontSize 2 or 3
  - session progress: x 14 y 72 width 202 height 10
  - weekly label/value: x 14 y 102 fontSize 2 or 3
  - weekly progress: x 14 y 130 width 202 height 10
  - reset/time footer: x 14 y 210 fontSize 2
- Decorative rects must stay behind text and controls, never cover labels or progress bars.
- Avoid skinny off-edge decoration. Do not place decorative rectangles with x > 200 or y > 200 unless width/height <= 24.
- Prefer simple, readable dashboard composition over scenic illustration when dynamic usage data is required.

Return only parseable JSON.`;
}

async function generateOpenAiResponses({
  maxTokens = 4096,
  prompt,
  provider,
  settings,
  system,
}: {
  maxTokens?: number;
  prompt: string;
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
  system: string;
}) {
  const body: Record<string, unknown> = {
    input: prompt,
    instructions: system,
    max_output_tokens: maxTokens,
    model: settings.model,
    text: { format: { type: "json_object" } },
  };

  const response = await fetch(provider.baseUrl || "https://api.openai.com/v1/responses", {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await readProviderJson(response)) as OpenAiResponsesResponse;
  const text = textFromOpenAiResponses(payload);
  if (text) {
    return text;
  }
  throw new Error(openAiMissingTextMessage(payload));
}

async function generateOpenAiCompatible({
  maxTokens = 1800,
  prompt,
  provider,
  settings,
  system,
}: {
  maxTokens?: number;
  prompt: string;
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
  system: string;
}) {
  const endpoint = settings.baseUrl || provider.baseUrl;
  if (!endpoint) {
    throw new Error("Add an OpenAI-compatible endpoint URL.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://app.vibetv.shop";
    headers["X-OpenRouter-Title"] = "VibeTV Theme Studio";
  }

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      messages: [
        { content: system, role: "system" },
        { content: prompt, role: "user" },
      ],
      max_tokens: maxTokens,
      model: settings.model,
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
    headers,
    method: "POST",
  });
  const payload = (await readProviderJson(response)) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => textFromContentPart(part)).join("");
  }
  throw new Error("Provider response did not include text.");
}

async function generateAnthropic({
  maxTokens = 1800,
  prompt,
  provider,
  settings,
  system,
}: {
  maxTokens?: number;
  prompt: string;
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
  system: string;
}) {
  const response = await fetch(provider.baseUrl || "", {
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages: [{ content: prompt, role: "user" }],
      model: settings.model,
      system,
    }),
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": settings.apiKey.trim(),
    },
    method: "POST",
  });
  const payload = (await readProviderJson(response)) as AnthropicResponse;
  const text = payload.content
    ?.map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
  if (text) {
    return text;
  }
  throw new Error("Provider response did not include text.");
}

async function generateGemini({
  prompt,
  settings,
  system,
}: {
  prompt: string;
  settings: AiThemeProviderSettings;
  system: string;
}) {
  const key = encodeURIComponent(settings.apiKey.trim());
  const model = encodeURIComponent(settings.model);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }], role: "user" }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.7,
        },
        system_instruction: { parts: [{ text: system }] },
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  const payload = (await readProviderJson(response)) as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  if (text) {
    return text;
  }
  throw new Error("Provider response did not include text.");
}

async function generateCohere({
  maxTokens = 1800,
  prompt,
  provider,
  settings,
  system,
}: {
  maxTokens?: number;
  prompt: string;
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
  system: string;
}) {
  const response = await fetch(provider.baseUrl || "", {
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages: [
        { content: system, role: "system" },
        { content: prompt, role: "user" },
      ],
      model: settings.model,
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await readProviderJson(response)) as CohereResponse;
  const text =
    payload.message?.content
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("") || (typeof payload.text === "string" ? payload.text : "");
  if (text) {
    return text;
  }
  throw new Error("Provider response did not include text.");
}

async function readProviderJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(providerErrorMessage(payload, response.status));
  }
  return payload;
}

function providerErrorMessage(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (typeof error === "string") {
      return error;
    }
    if (isRecord(error)) {
      const message = stringValue(error.message) || stringValue(error.type);
      if (message) {
        return message;
      }
    }
    const message = stringValue(payload.message);
    if (message) {
      return message;
    }
  }
  return `Provider request failed (${status}).`;
}

export function parseAiDraft(
  rawText: string,
  assetContext: Record<string, ThemeStudioAsset> = {},
): AiThemeDraft {
  const parsed = parseJsonObject(rawText);
  const specValue = isRecord(parsed) ? parsed.spec : null;
  if (!specValue) {
    throw new Error("AI response did not include a ThemeSpec.");
  }
  const spec = normalizeThemeSpec(importThemeSpec(specValue));
  const assets: Record<string, ThemeStudioAsset> = { ...assetContext };
  const validation = validateThemeSpec(spec, assets);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0]);
  }
  if (validation.warnings.length > 0) {
    throw new Error(validation.warnings[0]);
  }
  return {
    assets,
    notes: stringArrayValue(isRecord(parsed) ? parsed.notes : undefined).slice(0, 3),
    packName:
      stringValue(isRecord(parsed) ? parsed.packName : undefined) ||
      titleFromThemeId(spec.themeId),
    spec,
  };
}

function parseJsonObject(rawText: string): unknown {
  const clean = rawText.trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
}

function textFromContentPart(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return stringValue(value.text) || stringValue(value.content) || "";
}

function textFromOpenAiResponses(payload: OpenAiResponsesResponse): string {
  const direct = stringValue(payload.output_text);
  if (direct) {
    return direct;
  }
  if (!Array.isArray(payload.output)) {
    return "";
  }
  return payload.output
    .flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.content)) {
        return [];
      }
      return item.content.map(textFromContentPart);
    })
    .join("");
}

function openAiMissingTextMessage(payload: OpenAiResponsesResponse): string {
  const apiError = isRecord(payload.error) ? stringValue(payload.error.message) : "";
  if (apiError) {
    return apiError;
  }
  const incompleteReason = isRecord(payload.incomplete_details)
    ? stringValue(payload.incomplete_details.reason)
    : "";
  if (incompleteReason === "max_output_tokens") {
    return "OpenAI used the output budget before it returned theme JSON. Try again or use a shorter prompt.";
  }
  const status = stringValue(payload.status);
  return status
    ? `OpenAI response did not include text. Status: ${status}.`
    : "OpenAI response did not include text.";
}

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function chatMessagesValue(value: unknown): AiThemeChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const role = item.role === "assistant" || item.role === "user" ? item.role : null;
    const text = stringValue(item.text);
    if (!role || !text) {
      return [];
    }
    return [{
      attachments: attachmentSummariesValue(item.attachments),
      createdAt: stringValue(item.createdAt) || new Date().toISOString(),
      id: stringValue(item.id) || cryptoRandomId(),
      role,
      text,
    }];
  });
}

function attachmentSummariesValue(value: unknown): AiThemeChatAttachmentSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const kind = item.kind === "gif" || item.kind === "sprite" ? item.kind : null;
    const name = stringValue(item.name);
    const path = stringValue(item.path);
    if (!kind || !name || !path) {
      return [];
    }
    return [{
      frameCount: numberValue(item.frameCount),
      fps: numberValue(item.fps),
      height: numberValue(item.height),
      kind,
      name,
      path,
      width: numberValue(item.width),
    }];
  });
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
