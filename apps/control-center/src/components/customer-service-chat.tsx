"use client";

import "@n8n/chat/style.css";

import { MessageCircle, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  buildSupportChatMetadata,
  buildSupportChatMountOptions,
  clearSupportChatSession,
  supportChatConfig,
  SUPPORT_CHAT_COPY,
  type SupportChatMetadata,
  type SupportChatSurface,
} from "@/lib/support-chat";

type CustomerServiceChatProps = {
  appVersion?: string;
  companionVersion?: string;
  deviceConnected: boolean;
  surface: SupportChatSurface;
};

type ChatApp = {
  unmount: () => void;
};

export function CustomerServiceChat({
  appVersion,
  companionVersion,
  deviceConnected,
  surface,
}: CustomerServiceChatProps) {
  const [open, setOpen] = useState(false);
  const [mountVersion, setMountVersion] = useState(0);
  const [mountState, setMountState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [requestFailed, setRequestFailed] = useState(false);
  const [sessionMetadata, setSessionMetadata] =
    useState<SupportChatMetadata | null>(null);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      !open ||
      !sessionMetadata ||
      !supportChatConfig.enabled ||
      !supportChatConfig.webhookUrl
    ) {
      return;
    }

    if (!target) {
      return;
    }
    const webhookUrl = supportChatConfig.webhookUrl;

    let cancelled = false;
    let chatApp: ChatApp | null = null;
    let mountTimer: number | null = null;

    const observer = new MutationObserver(() => {
      if (target.textContent?.includes("Error: Failed to receive response")) {
        setRequestFailed(true);
      }
    });
    observer.observe(target, { childList: true, subtree: true });

    void import("@n8n/chat")
      .then(({ createChat }) => {
        if (cancelled) {
          return;
        }
        mountTimer = window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          try {
            chatApp = createChat(
              buildSupportChatMountOptions({
                metadata: sessionMetadata,
                streamingEnabled: supportChatConfig.streamingEnabled,
                target,
                webhookUrl,
              }),
            );
            setMountState("ready");
          } catch {
            setMountState("error");
          }
        }, 0);
      })
      .catch(() => {
        if (!cancelled) {
          setMountState("error");
        }
      });

    return () => {
      cancelled = true;
      if (mountTimer !== null) {
        window.clearTimeout(mountTimer);
      }
      observer.disconnect();
      chatApp?.unmount();
      target.replaceChildren();
    };
  }, [mountVersion, open, sessionMetadata, target]);

  if (!supportChatConfig.enabled || !supportChatConfig.webhookUrl) {
    return null;
  }

  const showFallback = mountState === "error" || requestFailed;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setMountState("loading");
          setRequestFailed(false);
          setSessionMetadata(
            buildSupportChatMetadata({
              appVersion,
              companionVersion,
              deviceConnected,
              platformHint: window.navigator.platform,
              surface,
              userAgent: window.navigator.userAgent,
            }),
          );
        }
        setOpen(nextOpen);
      }}
    >
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-4 right-4 z-40 h-12 rounded-full bg-[#1B1B1B] px-5 text-[#CCFF00] shadow-lg hover:bg-[#343434] sm:bottom-6 sm:right-6"
          type="button"
        >
          <MessageCircle aria-hidden />
          Customer Service
        </Button>
      </SheetTrigger>
      <SheetContent
        aria-label={SUPPORT_CHAT_COPY.title}
        className="vibetv-support-chat h-dvh !w-screen !max-w-none gap-0 overflow-hidden border-[#D5D5D5] bg-[#F9F9F9] p-0 sm:!w-[28rem] sm:!max-w-[28rem]"
        side="right"
      >
        <SheetHeader className="border-b border-[#D5D5D5] bg-white px-5 py-4 pr-12">
          <div className="flex items-center justify-between gap-4">
            <SheetTitle className="text-lg font-black text-[#1B1B1B]">
              {SUPPORT_CHAT_COPY.title}
            </SheetTitle>
            <Button
              aria-label="Start a new support conversation"
              className="shrink-0"
              onClick={() => {
                clearSupportChatSession(window.localStorage);
                setMountState("loading");
                setRequestFailed(false);
                setMountVersion((version) => version + 1);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw aria-hidden />
              New conversation
            </Button>
          </div>
          <SheetDescription className="sr-only">
            Chat with the VibeTV support assistant.
          </SheetDescription>
        </SheetHeader>

        <div className="relative min-h-0 flex-1">
          {mountState === "loading" ? (
            <div
              aria-live="polite"
              className="absolute inset-0 z-10 grid place-items-center bg-[#F9F9F9] px-6 text-center text-sm text-[#444933]"
            >
              Connecting to VibeTV Support…
            </div>
          ) : null}
          <div className="h-full" data-support-chat-target ref={setTarget} />
        </div>

        <SheetFooter className="gap-2 border-t border-[#D5D5D5] bg-white px-5 py-3 text-xs text-[#444933]">
          {showFallback ? (
            <p aria-live="polite" className="font-medium text-[#7D2633]" role="alert">
              Support is temporarily unavailable. Please try again or email{" "}
              <a className="underline" href="mailto:service@dreamytales.com">
                service@dreamytales.com
              </a>
              .
            </p>
          ) : null}
          <p>{SUPPORT_CHAT_COPY.notice}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <a className="underline" href="mailto:service@dreamytales.com">
              Email support
            </a>
            <a
              className="underline"
              href="https://vibetv.shop/policies/privacy-policy"
              rel="noreferrer"
              target="_blank"
            >
              Privacy Policy
            </a>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
