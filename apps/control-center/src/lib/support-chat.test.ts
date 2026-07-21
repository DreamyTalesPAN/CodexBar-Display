import { describe, expect, it, vi } from "vitest";

import {
  buildSupportChatMetadata,
  buildSupportChatMountOptions,
  clearSupportChatSession,
  resolveSupportChatConfig,
  SUPPORT_CHAT_COPY,
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
      }),
    ).toMatchObject({
      enabled: true,
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
      deviceConnected: true,
      surface: "local-control-center",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    });

    expect(metadata).toEqual({
      appVersion: "2.4.0",
      companionVersion: "1.8.1",
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
});

describe("clearSupportChatSession", () => {
  it("removes only the official n8n chat session key", () => {
    const removeItem = vi.fn();

    clearSupportChatSession({ removeItem });

    expect(removeItem).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledWith(
      SUPPORT_CHAT_SESSION_STORAGE_KEY,
    );
  });
});
