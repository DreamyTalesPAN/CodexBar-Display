import { describe, expect, it, vi } from "vitest";

import {
  buildSupportChatMetadata,
  buildSupportChatMountOptions,
  clearSupportChatSession,
  logSupportAgentMessage,
  loadSupportChatEmail,
  normalizeSupportChatEmail,
  resolveSupportChatConfig,
  storeSupportChatEmail,
  SUPPORT_CHAT_COPY,
  SUPPORT_CHAT_EMAIL_STORAGE_KEY,
  SUPPORT_CHAT_SESSION_STORAGE_KEY,
} from "./support-chat";

describe("resolveSupportChatConfig", () => {
  it("keeps the feature disabled without both the flag and webhook", () => {
    expect(
      resolveSupportChatConfig({
        enabled: "0",
        streamingEnabled: "1",
        webhookUrl: "https://n8n.example.com/webhook/support",
      }).enabled,
    ).toBe(false);
    expect(resolveSupportChatConfig({ enabled: "1" }).enabled).toBe(false);
  });

  it("accepts HTTPS and loopback development webhooks only", () => {
    expect(
      resolveSupportChatConfig({
        enabled: "1",
        webhookUrl: "https://n8n.example.com/webhook/support",
        logWebhookUrl: "https://n8n.example.com/webhook/support-log",
      }),
    ).toMatchObject({
      enabled: true,
      logWebhookUrl: "https://n8n.example.com/webhook/support-log",
      webhookUrl: "https://n8n.example.com/webhook/support",
    });
    expect(
      resolveSupportChatConfig({
        enabled: "1",
        webhookUrl: "http://127.0.0.1:4567/chat",
      }).enabled,
    ).toBe(true);
    expect(
      resolveSupportChatConfig({
        enabled: "1",
        webhookUrl: "http://n8n.example.com/webhook/support",
      }).enabled,
    ).toBe(false);
    expect(
      resolveSupportChatConfig({
        enabled: "1",
        webhookUrl: "https://user:secret@n8n.example.com/webhook/support",
      }).enabled,
    ).toBe(false);
  });

  it("defaults streaming on and permits an explicit non-streaming build", () => {
    const base = {
      enabled: "1",
      webhookUrl: "https://n8n.example.com/webhook/support",
    };

    expect(resolveSupportChatConfig(base).streamingEnabled).toBe(true);
    expect(
      resolveSupportChatConfig({ ...base, streamingEnabled: "0" })
        .streamingEnabled,
    ).toBe(false);
  });
});

describe("support chat request contract", () => {
  it("builds the approved metadata without sensitive device fields", () => {
    const metadata = buildSupportChatMetadata({
      appVersion: " 2.4.0 ",
      companionVersion: " 1.8.1 ",
      customerEmail: " Test@Example.com ",
      deviceConnected: true,
      surface: "local-control-center",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    });

    expect(metadata).toEqual({
      appVersion: "2.4.0",
      companionVersion: "1.8.1",
      customerEmail: "test@example.com",
      deviceConnected: true,
      platform: "windows",
      source: "vibetv-control-center",
      surface: "local-control-center",
    });
    expect(metadata).not.toHaveProperty("deviceId");
    expect(metadata).not.toHaveProperty("target");
    expect(metadata).not.toHaveProperty("logs");
    expect(metadata).not.toHaveProperty("usage");
    expect(metadata).not.toHaveProperty("apiKey");
  });

  it("distinguishes macOS, hosted web, and unknown runtime platforms", () => {
    expect(
      buildSupportChatMetadata({
        deviceConnected: false,
        platformHint: "MacIntel",
        surface: "recovery",
        userAgent: "VibeTVControlCenter/2.4.0+42",
      }).platform,
    ).toBe("macos");
    expect(
      buildSupportChatMetadata({
        deviceConnected: false,
        surface: "hosted-setup",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      }).platform,
    ).toBe("web");
    expect(
      buildSupportChatMetadata({
        deviceConnected: false,
        surface: "local-control-center",
      }).platform,
    ).toBe("unknown");
  });

  it("configures the official client without uploads, retries, or auth headers", () => {
    const target = {} as Element;
    const metadata = buildSupportChatMetadata({
      deviceConnected: false,
      surface: "hosted-setup",
    });
    const options = buildSupportChatMountOptions({
      metadata,
      streamingEnabled: false,
      target,
      webhookUrl: "https://n8n.example.com/webhook/support",
    });

    expect(options).toMatchObject({
      allowFileUploads: false,
      enableMessageActions: false,
      enableStreaming: false,
      initialMessages: [SUPPORT_CHAT_COPY.greeting],
      loadPreviousSession: true,
      metadata,
      mode: "fullscreen",
      showWelcomeScreen: false,
      showWindowCloseButton: false,
      target,
      webhookConfig: { headers: {}, method: "POST" },
      webhookUrl: "https://n8n.example.com/webhook/support",
    });
    expect(options.i18n.en.inputPlaceholder).toBe(
      SUPPORT_CHAT_COPY.placeholder,
    );
    expect(options.webhookConfig.headers).not.toHaveProperty("Authorization");
  });

  it("emits the final streamed bot message once", async () => {
    const onAgentMessage = vi.fn();
    const options = buildSupportChatMountOptions({
      metadata: buildSupportChatMetadata({
        deviceConnected: false,
        surface: "local-control-center",
      }),
      onAgentMessage,
      streamingEnabled: true,
      target: {} as Element,
      webhookUrl: "https://n8n.example.com/webhook/support",
    });
    const message = {
      id: "message-1",
      sender: "bot" as const,
      text: "Final streamed answer",
    };

    await options.afterMessageSent?.("question", {
      hasReceivedChunks: true,
      message,
    });
    await options.afterMessageSent?.("question", {
      hasReceivedChunks: true,
      message: "",
    });
    await options.afterMessageSent?.("question", {
      hasReceivedChunks: true,
      message,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAgentMessage).toHaveBeenCalledTimes(1);
    expect(onAgentMessage).toHaveBeenCalledWith(message);
  });
});

describe("logSupportAgentMessage", () => {
  it("posts an idempotent Airtable logging payload", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      logSupportAgentMessage({
        fetcher,
        logWebhookUrl: "https://n8n.example.com/webhook/support-log",
        message: {
          id: "message-7",
          sender: "bot",
          text: "A complete streamed answer.",
        },
        sessionId: "session-4",
      }),
    ).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(
      "https://n8n.example.com/webhook/support-log",
      expect.objectContaining({
        body: JSON.stringify({
          message: "A complete streamed answer.",
          messageId: "session-4:agent:message-7",
          sessionId: "session-4",
          ticketId: "VT-session-4",
        }),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        method: "POST",
      }),
    );
  });

  it("does not throw when logging is unavailable", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      logSupportAgentMessage({
        fetcher,
        logWebhookUrl: "https://n8n.example.com/webhook/support-log",
        message: { id: "message-8", sender: "bot", text: "Answer" },
        sessionId: "session-5",
      }),
    ).resolves.toBe(false);
  });
});

describe("clearSupportChatSession", () => {
  it("removes the n8n session and conversation email", () => {
    const removeItem = vi.fn();

    clearSupportChatSession({ removeItem });

    expect(removeItem).toHaveBeenCalledTimes(2);
    expect(removeItem).toHaveBeenCalledWith(
      SUPPORT_CHAT_SESSION_STORAGE_KEY,
    );
    expect(removeItem).toHaveBeenCalledWith(SUPPORT_CHAT_EMAIL_STORAGE_KEY);
  });
});

describe("support chat email", () => {
  it("normalizes valid addresses and rejects invalid input", () => {
    expect(normalizeSupportChatEmail(" Test@Example.com ")).toBe("test@example.com");
    expect(normalizeSupportChatEmail("not-an-email")).toBeNull();
  });

  it("stores, loads, and clears the conversation email", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(storeSupportChatEmail(storage, " Test@Example.com ")).toBe("test@example.com");
    expect(loadSupportChatEmail(storage)).toBe("test@example.com");
    expect(storeSupportChatEmail(storage, "invalid")).toBe("");
    expect(loadSupportChatEmail(storage)).toBe("");
  });
});
