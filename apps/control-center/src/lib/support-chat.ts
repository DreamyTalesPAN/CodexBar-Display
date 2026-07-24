export const SUPPORT_CHAT_SESSION_STORAGE_KEY = "n8n-chat/sessionId";
export const SUPPORT_CHAT_EMAIL_STORAGE_KEY = "vibetv-support/customerEmail";

export const SUPPORT_CHAT_COPY = {
  fallback:
    "Support is temporarily unavailable. Please try again or email hello@vibetv.shop.",
  greeting: "Hi! I’m the VibeTV support assistant. How can I help?",
  notice:
    "AI-assisted support. Don’t share passwords, API keys, or payment details.",
  placeholder: "Type your question…",
  title: "VibeTV Support",
} as const;

export type SupportChatSurface =
  | "local-control-center"
  | "hosted-setup"
  | "recovery";

export type SupportChatPlatform =
  | "macos"
  | "windows"
  | "web"
  | "unknown";

export type SupportChatMetadata = {
  appVersion?: string;
  companionVersion?: string;
  customerEmail?: string;
  deviceConnected: boolean;
  platform: SupportChatPlatform;
  source: "vibetv-control-center";
  surface: SupportChatSurface;
};

export type SupportChatConfig = {
  enabled: boolean;
  logWebhookUrl: string | null;
  streamingEnabled: boolean;
  webhookUrl: string | null;
};

type PublicSupportChatEnvironment = {
  enabled?: string;
  logWebhookUrl?: string;
  streamingEnabled?: string;
  webhookUrl?: string;
};

type SupportChatMetadataInput = {
  appVersion?: string | null;
  companionVersion?: string | null;
  customerEmail?: string | null;
  deviceConnected: boolean;
  platformHint?: string;
  surface: SupportChatSurface;
  userAgent?: string;
};

export type SupportChatMountOptions = {
  afterMessageSent?: (
    message: string,
    response?: SupportChatSendMessageResponse,
  ) => void | Promise<void>;
  allowFileUploads: false;
  defaultLanguage: "en";
  enableMessageActions: false;
  enableStreaming: boolean;
  i18n: {
    en: {
      closeButtonTooltip: string;
      footer: string;
      getStarted: string;
      inputPlaceholder: string;
      subtitle: string;
      title: string;
    };
  };
  initialMessages: string[];
  loadPreviousSession: true;
  metadata: SupportChatMetadata;
  mode: "fullscreen";
  showWelcomeScreen: false;
  showWindowCloseButton: false;
  target: Element;
  webhookConfig: {
    headers: Record<string, never>;
    method: "POST";
  };
  webhookUrl: string;
};

type SupportChatSendMessageResponse = {
  hasReceivedChunks?: boolean;
  message?: string | SupportChatAgentMessage;
};

export type SupportChatAgentMessage = {
  id: string;
  sender: "bot";
  text: string;
};

export function resolveSupportChatConfig(
  environment: PublicSupportChatEnvironment,
): SupportChatConfig {
  const webhookUrl = normalizeSupportChatWebhookUrl(environment.webhookUrl);

  return {
    enabled: environment.enabled === "1" && webhookUrl !== null,
    logWebhookUrl: normalizeSupportChatWebhookUrl(environment.logWebhookUrl),
    streamingEnabled: environment.streamingEnabled !== "0",
    webhookUrl,
  };
}

export const supportChatConfig = resolveSupportChatConfig({
  enabled: process.env.NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_ENABLED,
  logWebhookUrl:
    process.env.NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_LOG_WEBHOOK_URL,
  streamingEnabled:
    process.env.NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_STREAMING_ENABLED,
  webhookUrl: process.env.NEXT_PUBLIC_VIBETV_SUPPORT_CHAT_WEBHOOK_URL,
});

export function buildSupportChatMetadata({
  appVersion,
  companionVersion,
  customerEmail,
  deviceConnected,
  platformHint = "",
  surface,
  userAgent = "",
}: SupportChatMetadataInput): SupportChatMetadata {
  return {
    ...(nonEmptyVersion(appVersion) ? { appVersion: appVersion.trim() } : {}),
    ...(nonEmptyVersion(companionVersion)
      ? { companionVersion: companionVersion.trim() }
      : {}),
    ...(normalizeSupportChatEmail(customerEmail)
      ? { customerEmail: normalizeSupportChatEmail(customerEmail)! }
      : {}),
    deviceConnected,
    platform: detectSupportChatPlatform(userAgent, platformHint, surface),
    source: "vibetv-control-center",
    surface,
  };
}

export function buildSupportChatMountOptions({
  metadata,
  onAgentMessage,
  streamingEnabled,
  target,
  webhookUrl,
}: {
  metadata: SupportChatMetadata;
  onAgentMessage?: (message: SupportChatAgentMessage) => void | Promise<void>;
  streamingEnabled: boolean;
  target: Element;
  webhookUrl: string;
}): SupportChatMountOptions {
  let pendingAgentMessage: SupportChatAgentMessage | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const loggedMessageIds = new Set<string>();

  const flushAgentMessage = () => {
    if (!pendingAgentMessage || !onAgentMessage) {
      return;
    }
    const message = pendingAgentMessage;
    pendingAgentMessage = null;
    if (loggedMessageIds.has(message.id)) {
      return;
    }
    loggedMessageIds.add(message.id);
    void Promise.resolve(onAgentMessage(message)).catch(() => undefined);
  };

  return {
    ...(onAgentMessage
      ? {
          afterMessageSent: (_message, response) => {
            if (isAgentMessage(response?.message)) {
              pendingAgentMessage = response.message;
              if (flushTimer) {
                clearTimeout(flushTimer);
              }
              flushTimer = setTimeout(flushAgentMessage, 0);
              return;
            }
            if (response?.hasReceivedChunks && response.message === "") {
              if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              flushAgentMessage();
            }
          },
        }
      : {}),
    allowFileUploads: false,
    defaultLanguage: "en",
    enableMessageActions: false,
    enableStreaming: streamingEnabled,
    i18n: {
      en: {
        closeButtonTooltip: "Close support chat",
        footer: "",
        getStarted: "New conversation",
        inputPlaceholder: SUPPORT_CHAT_COPY.placeholder,
        subtitle: "",
        title: SUPPORT_CHAT_COPY.title,
      },
    },
    initialMessages: [SUPPORT_CHAT_COPY.greeting],
    loadPreviousSession: true,
    metadata,
    mode: "fullscreen",
    showWelcomeScreen: false,
    showWindowCloseButton: false,
    target,
    webhookConfig: {
      headers: {},
      method: "POST",
    },
    webhookUrl,
  };
}

export async function logSupportAgentMessage({
  fetcher = fetch,
  logWebhookUrl,
  message,
  sessionId,
}: {
  fetcher?: typeof fetch;
  logWebhookUrl: string;
  message: SupportChatAgentMessage;
  sessionId: string;
}): Promise<boolean> {
  if (!sessionId || !message.text.trim()) {
    return false;
  }

  try {
    const response = await fetcher(logWebhookUrl, {
      body: JSON.stringify({
        message: message.text,
        messageId: `${sessionId}:agent:${message.id}`,
        sessionId,
        ticketId: `VT-${sessionId}`,
      }),
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function clearSupportChatSession(
  storage: Pick<Storage, "removeItem">,
): void {
  storage.removeItem(SUPPORT_CHAT_SESSION_STORAGE_KEY);
  storage.removeItem(SUPPORT_CHAT_EMAIL_STORAGE_KEY);
}

export function loadSupportChatEmail(
  storage: Pick<Storage, "getItem">,
): string {
  return normalizeSupportChatEmail(
    storage.getItem(SUPPORT_CHAT_EMAIL_STORAGE_KEY),
  ) ?? "";
}

export function storeSupportChatEmail(
  storage: Pick<Storage, "removeItem" | "setItem">,
  value: string,
): string {
  const email = normalizeSupportChatEmail(value);
  if (email) {
    storage.setItem(SUPPORT_CHAT_EMAIL_STORAGE_KEY, email);
    return email;
  }
  storage.removeItem(SUPPORT_CHAT_EMAIL_STORAGE_KEY);
  return "";
}

export function normalizeSupportChatEmail(value?: string | null): string | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
    return null;
  }
  return candidate;
}

function normalizeSupportChatWebhookUrl(value?: string): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    const isLoopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]";
    const protocolAllowed =
      url.protocol === "https:" || (url.protocol === "http:" && isLoopback);

    if (!protocolAllowed || url.username || url.password) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function detectSupportChatPlatform(
  userAgent: string,
  platformHint: string,
  surface: SupportChatSurface,
): SupportChatPlatform {
  const platformIdentity = `${userAgent} ${platformHint}`;
  if (/windows|win32|win64/i.test(platformIdentity)) {
    return "windows";
  }
  if (/macintosh|mac os x|macos|macintel/i.test(platformIdentity)) {
    return "macos";
  }
  if (surface === "hosted-setup") {
    return "web";
  }
  return "unknown";
}

function nonEmptyVersion(value?: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAgentMessage(
  value?: string | SupportChatAgentMessage,
): value is SupportChatAgentMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    value.sender === "bot" &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    value.text.trim().length > 0
  );
}
