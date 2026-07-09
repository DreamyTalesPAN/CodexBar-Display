"use client";

import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AI_THEME_PROVIDERS,
  defaultProviderSettings,
  generateAiThemeDraft,
  providerById,
  readAiThemeChatHistory,
  readAiThemeSettings,
  verifyAiThemeProvider,
  writeAiThemeChatHistory,
  writeAiThemeSettings,
  type AiThemeAssetAttachment,
  type AiThemeChatAttachmentSummary,
  type AiThemeChatMessage,
  type AiThemeDraft,
  type AiThemeProgressEvent,
  type AiThemeProvider,
  type AiThemeProviderSession,
  type AiThemeProviderSettings,
  type AiThemeSettings,
} from "@/lib/ai-theme";
import type { ThemeStudioAsset, ThemeStudioSpec } from "@/lib/theme-studio";
import { ControlCenterButton } from "./control-center-button";

type AiThemePanelStatus = {
  message: string;
  tone: "attention" | "ready" | "unknown";
};

export type AiThemePanelProps = {
  modal?: boolean;
  onClose: () => void;
  onVerified: (session: AiThemeVerifiedSession) => void;
};

export type AiThemeVerifiedSession = AiThemeProviderSession & {
  verifiedAt: number;
};

export type AiThemeChatBoxProps = {
  baseAssets: Record<string, ThemeStudioAsset>;
  basePackName: string;
  baseSpec: ThemeStudioSpec;
  onApply: (draft: AiThemeDraft) => void;
  onChangeKey: () => void;
  session: AiThemeVerifiedSession;
};

export function AiThemePanel({
  modal = false,
  onClose,
  onVerified,
}: AiThemePanelProps) {
  const [settings, setSettings] = useState<AiThemeSettings>(() =>
    readAiThemeSettings(),
  );
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<AiThemePanelStatus | null>(null);

  const provider = useMemo(
    () => providerById(settings.selectedProviderId),
    [settings.selectedProviderId],
  );
  const providerSettings =
    settings.providers[provider.id] || defaultProviderSettings(provider);
  const settingsReady =
    provider.id === "openai-compatible"
      ? Boolean(providerSettings.baseUrl?.trim() && providerSettings.model.trim())
      : Boolean(providerSettings.apiKey.trim() && providerSettings.model.trim());

  function selectProvider(providerId: string) {
    const selected = providerById(providerId);
    const next = {
      ...settings,
      selectedProviderId: selected.id,
      providers: {
        ...settings.providers,
        [selected.id]:
          settings.providers[selected.id] || defaultProviderSettings(selected),
      },
    };
    setSettings(next);
    writeAiThemeSettings(next);
    setStatus(null);
  }

  function updateProviderSettings(nextSettings: Partial<AiThemeProviderSettings>) {
    setStatus(null);
    setSettings((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider.id]: {
          ...defaultProviderSettings(provider),
          ...current.providers[provider.id],
          ...nextSettings,
        },
      },
    }));
  }

  async function verifyKey() {
    if (!settingsReady) {
      setStatus({
        message: provider.needsBaseUrl
          ? "Add endpoint, model, and key first."
          : "Add API key and model first.",
        tone: "attention",
      });
      return;
    }
    const next = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider.id]: providerSettings,
      },
    };
    setVerifying(true);
    setStatus(null);
    try {
      writeAiThemeSettings(next);
      await verifyProvider({ provider, settings: providerSettings });
      setSettings(next);
      onVerified({
        provider,
        settings: providerSettings,
        verifiedAt: Date.now(),
      });
      onClose();
    } catch (error) {
      setStatus({
        message:
          error instanceof Error ? error.message : "Provider verification failed.",
        tone: "attention",
      });
    } finally {
      setVerifying(false);
    }
  }

  function removeProviderKey() {
    const next = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider.id]: {
          ...providerSettings,
          apiKey: "",
        },
      },
    };
    setSettings(next);
    writeAiThemeSettings(next);
    setStatus(null);
  }

  const content = (
    <section className="grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 text-[#1B1B1B]">
      <div className="flex justify-end">
        <button
          aria-label="Close AI theme builder"
          className="grid size-10 shrink-0 place-items-center border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] hover:bg-[#EEEEEE]"
          onClick={onClose}
          type="button"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="grid gap-3 border border-[#747A60] bg-[#EEEEEE] p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <LabeledSelect
            label="Provider"
            value={provider.id}
            onChange={selectProvider}
            options={AI_THEME_PROVIDERS.map((item) => [item.id, item.label])}
          />
          <LabeledInput
            label="Model"
            value={providerSettings.model}
            onChange={(value) => updateProviderSettings({ model: value })}
            placeholder={provider.defaultModel || "model-name"}
          />
        </div>
        {provider.needsBaseUrl ? (
          <LabeledInput
            label="Endpoint"
            value={providerSettings.baseUrl || ""}
            onChange={(value) => updateProviderSettings({ baseUrl: value })}
            placeholder="https://example.com/v1/chat/completions"
          />
        ) : null}
        <LabeledInput
          label="API key"
          value={providerSettings.apiKey}
          onChange={(value) => updateProviderSettings({ apiKey: value })}
          placeholder={provider.keyPlaceholder}
          type="password"
        />
        {status ? <StatusLine status={status} /> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <ControlCenterButton
            busy={verifying}
            busyLabel="Verifying"
            disabled={verifying || !settingsReady}
            icon={<KeyRound size={16} aria-hidden />}
            label="Verify key"
            onClick={() => void verifyKey()}
          />
          <ControlCenterButton
            icon={<Trash2 size={16} aria-hidden />}
            label="Remove key"
            onClick={removeProviderKey}
            variant="secondary"
          />
        </div>
      </div>
    </section>
  );

  if (!modal) {
    return content;
  }

  return (
    <div
      aria-label="AI theme builder"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1B1B1B]/80 p-4 sm:p-6"
      role="dialog"
    >
      <div className="w-full max-w-[720px]">{content}</div>
    </div>
  );
}

export function AiThemeChatBox({
  baseAssets,
  basePackName,
  baseSpec,
  onApply,
  onChangeKey,
  session,
}: AiThemeChatBoxProps) {
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [chatText, setChatText] = useState("");
  const [historyThemeId, setHistoryThemeId] = useState(baseSpec.themeId);
  const [messages, setMessages] = useState<AiThemeChatMessage[]>(() =>
    readAiThemeChatHistory(baseSpec.themeId),
  );
  const [attachments, setAttachments] = useState<AiThemeAssetAttachment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<AiThemePanelStatus | null>(null);
  const canSend =
    (chatText.trim().length > 0 || attachments.length > 0) && !generating;

  useEffect(() => {
    if (historyThemeId === baseSpec.themeId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const storedMessages = readAiThemeChatHistory(baseSpec.themeId);
      setMessages((current) =>
        current.length === 0 && storedMessages.length > 0
          ? storedMessages
          : current,
      );
      setHistoryThemeId(baseSpec.themeId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [baseSpec.themeId, historyThemeId]);

  useEffect(() => {
    if (historyThemeId !== baseSpec.themeId) {
      return;
    }
    writeAiThemeChatHistory(baseSpec.themeId, messages);
  }, [baseSpec.themeId, historyThemeId, messages]);

  useEffect(() => {
    const container = chatHistoryRef.current;
    if (!container) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  async function addAttachmentFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }
    setStatus(null);
    try {
      const usedPaths = new Set([
        ...Object.keys(baseAssets),
        ...attachments.map((attachment) => attachment.path),
      ]);
      const nextAttachments: AiThemeAssetAttachment[] = [];
      for (const file of Array.from(fileList)) {
        nextAttachments.push(await attachmentFromFile(file, usedPaths));
      }
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch (error) {
      setStatus({
        message:
          error instanceof Error ? error.message : "Attachment could not be read.",
        tone: "attention",
      });
    } finally {
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
    }
  }

  function removeAttachment(path: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.path !== path),
    );
  }

  async function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) {
      return;
    }
    const userMessage: AiThemeChatMessage = {
      attachments: attachments.map(attachmentSummary),
      createdAt: new Date().toISOString(),
      id: cryptoRandomId(),
      role: "user",
      text:
        chatText.trim() ||
        "Use the attached assets in the current Theme Studio design.",
    };
    const assistantMessageId = cryptoRandomId();
    const assistantMessage: AiThemeChatMessage = {
      createdAt: new Date().toISOString(),
      id: assistantMessageId,
      role: "assistant",
      text: "",
    };
    let streamedText = "";
    let assistantMessageAdded = false;
    const ensureAssistantMessage = (text: string) => {
      if (!assistantMessageAdded) {
        assistantMessageAdded = true;
        setMessages((current) => [...current, { ...assistantMessage, text }]);
        return;
      }
      updateAssistantMessage(text);
    };
    const updateAssistantMessage = (text: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId ? { ...message, text } : message,
        ),
      );
    };
    const addModelText = (text: string) => {
      if (!text) {
        return;
      }
      streamedText += text;
      ensureAssistantMessage(streamedText);
    };

    setGenerating(true);
    setStatus(null);
    setMessages((current) => [...current, userMessage]);
    const pendingAttachments = attachments;
    setAttachments([]);
    setChatText("");
    try {
      const draft = await generateDraft({
        basePackName,
        baseAssets,
        baseSpec,
        attachments: pendingAttachments,
        description: userMessage.text,
        messages,
        mode: "refine",
        onStreamText: addModelText,
        provider: session.provider,
        settings: session.settings,
      });
      onApply(draft);
      ensureAssistantMessage(aiDraftSummary(draft));
      setStatus(null);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "AI theme update failed.";
      ensureAssistantMessage(`Could not build the theme.\n${errorMessage}`);
      setStatus({
        message: errorMessage,
        tone: "attention",
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="mt-8 grid w-full max-w-[720px] gap-3 bg-[#F9F9F9] p-4 text-[#1B1B1B]">
      <form className="grid gap-3" onSubmit={(event) => void sendChat(event)}>
        {messages.length > 0 ? (
          <div
            className="max-h-36 overflow-y-auto border-b border-[#747A60] pb-3 pr-1"
            ref={chatHistoryRef}
          >
            <div className="grid gap-3">
              {messages.slice(-6).map((message) => (
                <article
                  className="grid gap-1 text-xs leading-5 sm:grid-cols-[56px_minmax(0,1fr)] sm:gap-3"
                  key={message.id}
                >
                  <div
                    className={`font-black uppercase ${
                      message.role === "user"
                        ? "text-[#1B1B1B]"
                        : "text-[#5E7200]"
                    }`}
                  >
                    {message.role === "user" ? "You" : "AI"}
                  </div>
                  <div className="min-w-0">
                    <p className="whitespace-pre-wrap break-words text-[#1B1B1B]">
                      {message.text}
                    </p>
                    {message.attachments?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {message.attachments.map((attachment) => (
                          <span
                            className="bg-[#E9FF99] px-2 py-0.5 text-[11px] font-black text-[#3B5200]"
                            key={attachment.path}
                          >
                            {attachment.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
        <label className="grid gap-2">
          <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
            Chat
          </span>
          <textarea
            className="min-h-[96px] w-full resize-y border border-[#747A60] bg-[#F9F9F9] p-3 text-sm leading-6 text-[#1B1B1B] outline-none focus:border-[#5E7200]"
            onChange={(event) => setChatText(event.target.value)}
            placeholder="Mach das Theme cyberpunk: schwarzer Hintergrund, neongrüne Session-Bar, magenta Weekly-Bar, Uhrzeit oben rechts."
            value={chatText}
          />
        </label>
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <span
                className="inline-flex min-h-10 items-center gap-2 border border-[#747A60] bg-[#EEEEEE] px-3 py-1 text-xs font-black text-[#1B1B1B]"
                key={attachment.path}
              >
                <span>
                  {attachment.name} - {attachment.kind.toUpperCase()}
                </span>
                <button
                  aria-label={`Remove ${attachment.name}`}
                  className="grid size-6 place-items-center border border-[#747A60] bg-[#F9F9F9] hover:bg-[#FFE3E8]"
                  onClick={() => removeAttachment(attachment.path)}
                  type="button"
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {status ? <StatusLine status={status} /> : null}
        <input
          accept=".gif,.cbi,.cba,image/gif,text/plain"
          className="hidden"
          multiple
          onChange={(event) => void addAttachmentFiles(event.currentTarget.files)}
          ref={attachmentInputRef}
          type="file"
        />
        <div className="grid grid-cols-[minmax(0,1fr)_48px_48px] gap-2">
          <ControlCenterButton
            busy={generating}
            busyLabel="Building"
            disabled={!canSend}
            fullWidth
            icon={<Send size={16} aria-hidden />}
            label="Build theme"
            type="submit"
          />
          <button
            aria-label="Attach asset"
            className="grid h-12 w-12 place-items-center border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] outline-none hover:bg-[#EEEEEE] focus-visible:border-[#5E7200]"
            onClick={() => attachmentInputRef.current?.click()}
            title="Attach asset"
            type="button"
          >
            <Paperclip size={18} aria-hidden />
          </button>
          <button
            aria-label="Change AI key"
            className="grid h-12 w-12 place-items-center border border-[#747A60] bg-[#F9F9F9] text-[#1B1B1B] outline-none hover:bg-[#EEEEEE] focus-visible:border-[#5E7200]"
            onClick={onChangeKey}
            title="Change AI key"
            type="button"
          >
            <KeyRound size={18} aria-hidden />
          </button>
        </div>
      </form>
    </section>
  );
}

const MAX_ATTACHMENT_GIF_BYTES = 24 * 1024;
const MAX_ATTACHMENT_GIF_SIZE = 80;
const USER_THEME_ASSET_PATH_PREFIX = "/themes/u/";

async function attachmentFromFile(
  file: File,
  usedPaths: Set<string>,
): Promise<AiThemeAssetAttachment> {
  const extension = attachmentExtension(file.name);
  if (!extension) {
    throw new Error("Attach a .gif, .cbi, or .cba file.");
  }
  const path = uniqueAttachmentPath(file.name, extension, usedPaths);
  if (extension === ".gif") {
    if (file.size > MAX_ATTACHMENT_GIF_BYTES) {
      throw new Error("GIF attachments must stay under 24 KB.");
    }
    const data = await fileToBase64(file);
    const size = await gifSize(data, file.type || "image/gif");
    if (
      size.width > MAX_ATTACHMENT_GIF_SIZE ||
      size.height > MAX_ATTACHMENT_GIF_SIZE
    ) {
      throw new Error("GIF attachments must stay within 80x80.");
    }
    return {
      asset: {
        contentType: file.type || "image/gif",
        data,
        encoding: "base64",
      },
      height: size.height,
      kind: "gif",
      name: file.name,
      path,
      width: size.width,
    };
  }

  const raw = ensureTrailingNewline(await file.text());
  const metadata = spriteMetadata(raw);
  if (!metadata) {
    throw new Error("Sprite attachments must be valid CBI1 or CBA1 files.");
  }
  return {
    asset: {
      contentType: "text/plain",
      data: raw,
      encoding: "text",
    },
    frameCount: metadata.frameCount,
    fps: metadata.fps,
    height: metadata.height,
    kind: "sprite",
    name: file.name,
    path,
    width: metadata.width,
  };
}

function attachmentSummary(
  attachment: AiThemeAssetAttachment,
): AiThemeChatAttachmentSummary {
  return {
    frameCount: attachment.frameCount,
    fps: attachment.fps,
    height: attachment.height,
    kind: attachment.kind,
    name: attachment.name,
    path: attachment.path,
    width: attachment.width,
  };
}

function aiDraftSummary(draft: AiThemeDraft): string {
  const notes = draft.notes.length > 0 ? ` Notes: ${draft.notes.join(" ")}` : "";
  return `Applied ${draft.packName}.${notes}`;
}

function attachmentExtension(name: string): ".cba" | ".cbi" | ".gif" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".gif")) {
    return ".gif";
  }
  if (lower.endsWith(".cba")) {
    return ".cba";
  }
  if (lower.endsWith(".cbi")) {
    return ".cbi";
  }
  return null;
}

function uniqueAttachmentPath(
  name: string,
  extension: ".cba" | ".cbi" | ".gif",
  usedPaths: Set<string>,
): string {
  let attempt = 0;
  while (attempt < 100) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const fileName = safeAssetName(name, extension, suffix);
    const path = `${USER_THEME_ASSET_PATH_PREFIX}${fileName}`;
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    attempt += 1;
  }
  throw new Error("Attachment file name could not be made unique.");
}

function safeAssetName(
  name: string,
  extension: ".cba" | ".cbi" | ".gif",
  suffix = "",
): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withoutExtension = cleaned.replace(/\.[a-z0-9]+$/i, "");
  const maxFileNameLength = 21;
  const maxBaseLength = Math.max(
    1,
    maxFileNameLength - extension.length - suffix.length,
  );
  const base =
    withoutExtension.slice(0, maxBaseLength).replace(/[._-]+$/g, "") ||
    "asset";
  return `${base}${suffix}${extension}`;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function gifSize(
  base64: string,
  contentType: string,
): Promise<{ height: number; width: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        height: image.naturalHeight,
        width: image.naturalWidth,
      });
    image.onerror = () => reject(new Error("GIF attachment could not be read."));
    image.src = `data:${contentType};base64,${base64}`;
  });
}

function spriteMetadata(
  raw: string,
): { frameCount: number; fps: number; height: number; width: number } | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kind = lines[0];
  if (kind !== "CBI1" && kind !== "CBA1") {
    return null;
  }
  const header = (lines[1] || "").split(/\s+/).map(Number);
  const width = header[0] || 0;
  const height = header[1] || 0;
  const frameCount = kind === "CBA1" ? header[2] || 0 : 1;
  const fps = kind === "CBA1" ? header[3] || 0 : 0;
  const paletteSize = Number(lines[2] || 0);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(frameCount) ||
    !Number.isInteger(fps) ||
    !Number.isInteger(paletteSize) ||
    width <= 0 ||
    height <= 0 ||
    frameCount <= 0 ||
    paletteSize <= 0 ||
    paletteSize > 26
  ) {
    return null;
  }
  const rowStart = 3 + paletteSize;
  const rows = lines.slice(rowStart, rowStart + frameCount * height);
  if (rows.length !== frameCount * height) {
    return null;
  }
  return { frameCount, fps, height, width };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function verifyProvider({
  provider,
  settings,
}: {
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
}) {
  const proxied = await postAiThemeApi({
    action: "verify",
    providerId: provider.id,
    settings,
  });
  if (proxied.used) {
    return;
  }
  await verifyAiThemeProvider({ provider, settings });
}

async function generateDraft({
  attachments,
  baseAssets,
  basePackName,
  baseSpec,
  description,
  messages,
  mode,
  onStreamText,
  provider,
  settings,
}: {
  attachments: AiThemeAssetAttachment[];
  baseAssets: Record<string, ThemeStudioAsset>;
  basePackName: string;
  baseSpec: ThemeStudioSpec;
  description: string;
  messages: AiThemeChatMessage[];
  mode: "refine";
  onStreamText?: (text: string) => void;
  provider: AiThemeProvider;
  settings: AiThemeProviderSettings;
}) {
  const proxied = await postAiThemeApiStream(
    {
      action: "generate",
      attachments,
      baseAssets,
      basePackName,
      baseSpec,
      description,
      messages,
      mode,
      providerId: provider.id,
      settings,
      stream: true,
    },
    onStreamText,
  );
  if (proxied.used) {
    const draft = isRecord(proxied.body) ? proxied.body.draft : null;
    if (isAiThemeDraft(draft)) {
      return draft;
    }
    throw new Error("AI response did not include a theme draft.");
  }

  const legacyProxied = await postAiThemeApi({
    action: "generate",
    attachments,
    baseAssets,
    basePackName,
    baseSpec,
    description,
    messages,
    mode,
    providerId: provider.id,
    settings,
  });
  if (legacyProxied.used) {
    const draft = isRecord(legacyProxied.body) ? legacyProxied.body.draft : null;
    if (isAiThemeDraft(draft)) {
      return draft;
    }
    throw new Error("AI response did not include a theme draft.");
  }
  return generateAiThemeDraft({
    attachments,
    baseAssets,
    basePackName,
    baseSpec,
    description,
    messages,
    mode,
    onProgress: (event: AiThemeProgressEvent) => onStreamText?.(event.message),
    provider,
    settings,
  });
}

async function postAiThemeApiStream(
  body: Record<string, unknown>,
  onStreamText?: (text: string) => void,
): Promise<{
  body?: unknown;
  used: boolean;
}> {
  try {
    const response = await fetch("/api/ai-theme", {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    if (response.status === 404 || response.status === 405) {
      return { used: false };
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (!response.body || !contentType.includes("application/x-ndjson")) {
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload));
      }
      return { body: payload, used: true };
    }
    return readAiThemeStream(response, onStreamText);
  } catch (error) {
    if (error instanceof TypeError) {
      return { used: false };
    }
    throw error;
  }
}

async function readAiThemeStream(
  response: Response,
  onStreamText?: (text: string) => void,
): Promise<{
  body?: unknown;
  used: boolean;
}> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("AI provider stream could not be read.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let finalBody: unknown;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const result = readAiThemeStreamLines(buffer, onStreamText);
    buffer = result.buffer;
    if (result.body) {
      finalBody = result.body;
    }
  }
  buffer += decoder.decode();
  const result = readAiThemeStreamLines(buffer, onStreamText);
  if (result.body) {
    finalBody = result.body;
  }

  if (finalBody) {
    return { body: finalBody, used: true };
  }
  throw new Error("AI provider stream ended without a theme draft.");
}

function readAiThemeStreamLines(
  buffer: string,
  onStreamText?: (text: string) => void,
): { body?: unknown; buffer: string } {
  let rest = buffer;
  let finalBody: unknown;
  for (;;) {
    const newlineIndex = rest.indexOf("\n");
    if (newlineIndex < 0) {
      break;
    }
    const line = rest.slice(0, newlineIndex).trim();
    rest = rest.slice(newlineIndex + 1);
    if (!line) {
      continue;
    }
    const event = JSON.parse(line) as unknown;
    if (!isRecord(event) || typeof event.type !== "string") {
      continue;
    }
    if (event.type === "delta" && typeof event.text === "string") {
      onStreamText?.(event.text);
    } else if (event.type === "done") {
      finalBody = { draft: event.draft, ok: true };
    } else if (event.type === "error") {
      throw new Error(
        typeof event.error === "string" ? event.error : "AI provider request failed.",
      );
    }
  }
  return { body: finalBody, buffer: rest };
}

async function postAiThemeApi(body: Record<string, unknown>): Promise<{
  body?: unknown;
  used: boolean;
}> {
  try {
    const response = await fetch("/api/ai-theme", {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (response.status === 404 || response.status === 405) {
      return { used: false };
    }
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload));
    }
    return { body: payload, used: true };
  } catch (error) {
    if (error instanceof TypeError) {
      return { used: false };
    }
    throw error;
  }
}

function errorMessageFromPayload(payload: unknown): string {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }
  return "AI provider request failed.";
}

function isAiThemeDraft(value: unknown): value is AiThemeDraft {
  return (
    isRecord(value) &&
    isRecord(value.spec) &&
    typeof value.packName === "string" &&
    isRecord(value.assets) &&
    Array.isArray(value.notes)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function LabeledInput({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "password" | "text";
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <input
        className="h-11 min-w-0 border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function LabeledSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <select
        className="h-11 min-w-0 border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusLine({ status }: { status: AiThemePanelStatus }) {
  const attention = status.tone === "attention";
  const ready = status.tone === "ready";
  return (
    <div
      className={`flex gap-2 border p-3 text-sm leading-6 ${
        attention
          ? "border-[#7D2633] bg-[#FFE3E8] text-[#7D2633]"
          : ready
            ? "border-[#5E7200] bg-[#E9FF99] text-[#1B1B1B]"
            : "border-[#747A60] bg-[#EEEEEE] text-[#444933]"
      }`}
    >
      {attention ? (
        <AlertTriangle className="mt-1 shrink-0" size={16} aria-hidden />
      ) : ready ? (
        <CheckCircle2 className="mt-1 shrink-0" size={16} aria-hidden />
      ) : (
        <Sparkles className="mt-1 shrink-0" size={16} aria-hidden />
      )}
      <span>{status.message}</span>
    </div>
  );
}
