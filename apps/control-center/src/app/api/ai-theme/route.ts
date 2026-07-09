import {
  buildAiThemePrompt,
  generateAiThemeDraft,
  parseAiDraft,
  providerById,
  verifyAiThemeProvider,
  type AiThemeAssetAttachment,
  type AiThemeChatMessage,
  type AiThemeMode,
  type AiThemeProviderSettings,
} from "@/lib/ai-theme";
import type { ThemeStudioAsset, ThemeStudioSpec } from "@/lib/theme-studio";

export const dynamic = "force-dynamic";

type AiThemeApiRequest = {
  action?: "generate" | "verify";
  attachments?: AiThemeAssetAttachment[];
  baseAssets?: Record<string, ThemeStudioAsset>;
  basePackName?: string;
  baseSpec?: ThemeStudioSpec;
  description?: string;
  messages?: AiThemeChatMessage[];
  mode?: AiThemeMode;
  providerId?: string;
  settings?: AiThemeProviderSettings;
  stream?: boolean;
};

type AiThemeStreamEvent =
  | { text: string; type: "delta" }
  | { draft: Awaited<ReturnType<typeof generateAiThemeDraft>>; type: "done" }
  | { error: string; type: "error" };

export async function POST(request: Request) {
  let payload: AiThemeApiRequest;
  try {
    payload = (await request.json()) as AiThemeApiRequest;
  } catch {
    return Response.json(
      { ok: false, error: "AI request could not be read." },
      { status: 400 },
    );
  }

  const provider = providerById(payload.providerId);
  const settings = payload.settings;
  if (!settings || !settings.model) {
    return Response.json(
      { ok: false, error: "AI provider settings are missing." },
      { status: 400 },
    );
  }

  try {
    if (payload.action === "verify") {
      await verifyAiThemeProvider({ provider, settings });
      return Response.json({ ok: true });
    }

    if (payload.action === "generate") {
      if (payload.stream) {
        if (provider.id === "openai") {
          return streamOpenAiThemeDraft(payload, provider, settings);
        }
        return streamAiThemeDraft(payload, provider, settings);
      }

      const draft = await generateAiThemeDraft({
        attachments: payload.attachments || [],
        baseAssets: payload.baseAssets || {},
        basePackName: payload.basePackName,
        baseSpec: payload.baseSpec,
        description: payload.description || "",
        messages: payload.messages || [],
        mode: payload.mode || "new",
        provider,
        settings,
      });
      return Response.json({ ok: true, draft });
    }

    return Response.json(
      { ok: false, error: "AI action is not supported." },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "AI provider request failed.",
      },
      { status: 400 },
    );
  }
}

function streamAiThemeDraft(
  payload: AiThemeApiRequest,
  provider: ReturnType<typeof providerById>,
  settings: AiThemeProviderSettings,
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: AiThemeStreamEvent) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may have already closed the stream.
        }
      };

      void (async () => {
        try {
          const draft = await generateAiThemeDraft({
            attachments: payload.attachments || [],
            baseAssets: payload.baseAssets || {},
            basePackName: payload.basePackName,
            baseSpec: payload.baseSpec,
            description: payload.description || "",
            messages: payload.messages || [],
            mode: payload.mode || "new",
            provider,
            settings,
          });
          send({ draft, type: "done" });
        } catch (error) {
          send({
            error:
              error instanceof Error
                ? error.message
                : "AI provider request failed.",
            type: "error",
          });
        } finally {
          close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}

function streamOpenAiThemeDraft(
  payload: AiThemeApiRequest,
  provider: ReturnType<typeof providerById>,
  settings: AiThemeProviderSettings,
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: AiThemeStreamEvent) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // The browser may have already closed the stream.
        }
      };

      void (async () => {
        try {
          const { assetContext, prompt, system } = buildAiThemePrompt({
            attachments: payload.attachments || [],
            baseAssets: payload.baseAssets || {},
            basePackName: payload.basePackName,
            baseSpec: payload.baseSpec,
            description: payload.description || "",
            messages: payload.messages || [],
            mode: payload.mode || "new",
          });
          let rawText = "";
          await streamOpenAiResponses({
            onCompletedText: (text) => {
              if (text.startsWith(rawText)) {
                const missingText = text.slice(rawText.length);
                rawText = text;
                send({ text: missingText, type: "delta" });
                return;
              }
              if (!rawText) {
                rawText = text;
                send({ text, type: "delta" });
              }
            },
            onDelta: (text) => {
              rawText += text;
              send({ text, type: "delta" });
            },
            prompt,
            provider,
            settings,
            system,
          });
          const draft = parseAiDraft(rawText, assetContext);
          send({ draft, type: "done" });
        } catch (error) {
          send({
            error:
              error instanceof Error
                ? error.message
              : "AI provider request failed.",
            type: "error",
          });
        } finally {
          close();
        }
      })();
    },
    cancel() {
      // The async OpenAI request may still finish after the browser disconnects.
      // Enqueue/close calls are guarded above.
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}

async function streamOpenAiResponses({
  onCompletedText,
  onDelta,
  prompt,
  provider,
  settings,
  system,
}: {
  onCompletedText: (text: string) => void;
  onDelta: (text: string) => void;
  prompt: string;
  provider: ReturnType<typeof providerById>;
  settings: AiThemeProviderSettings;
  system: string;
}) {
  const response = await fetch(provider.baseUrl || "https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: prompt,
      instructions: system,
      max_output_tokens: 4096,
      model: settings.model,
      stream: true,
      text: { format: { type: "json_object" } },
    }),
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await openAiStreamErrorMessage(response));
  }
  if (!response.body) {
    throw new Error("OpenAI response stream could not be read.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = readOpenAiSseEvents(buffer, onDelta, onCompletedText);
  }
  buffer += decoder.decode();
  readOpenAiSseEvents(`${buffer}\n\n`, onDelta, onCompletedText);
}

function readOpenAiSseEvents(
  buffer: string,
  onDelta: (text: string) => void,
  onCompletedText: (text: string) => void,
): string {
  let rest = buffer.replace(/\r\n/g, "\n");
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary < 0) {
      break;
    }
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const dataLines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
      continue;
    }
    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(data) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      continue;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      onDelta(event.delta);
    } else if (event.type === "response.completed") {
      const completedText = textFromOpenAiResponsePayload(event.response);
      if (completedText) {
        onCompletedText(completedText);
      }
    } else if (event.type === "response.error") {
      throw new Error(errorMessageFromPayload(event));
    } else if (event.type === "error") {
      throw new Error(errorMessageFromPayload(event));
    }
  }
  return rest;
}

function textFromOpenAiResponsePayload(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
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
      return item.content.map((part) =>
        isRecord(part) ? stringValue(part.text) : "",
      );
    })
    .join("");
}

async function openAiStreamErrorMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (payload) {
    return errorMessageFromPayload(payload);
  }
  return `OpenAI request failed (${response.status}).`;
}

function errorMessageFromPayload(payload: unknown): string {
  if (isRecord(payload)) {
    if (typeof payload.error === "string") {
      return payload.error;
    }
    if (isRecord(payload.error)) {
      const message = stringValue(payload.error.message);
      if (message) {
        return message;
      }
    }
    const message = stringValue(payload.message);
    if (message) {
      return message;
    }
  }
  return "AI provider request failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
