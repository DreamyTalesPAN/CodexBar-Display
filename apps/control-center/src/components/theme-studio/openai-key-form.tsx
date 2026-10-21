"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  deleteAIThemeCredential,
  fetchAIThemeCapabilities,
  saveAIThemeCredential,
  verifyAIThemeCredential,
  type AIThemeCapabilities,
} from "@/lib/ai-theme";

const CONSENT_KEY = "vibetv.aiTheme.consent";

export type OpenAIState = { enabled: boolean; configured: boolean | "pending" };

export function openAIState(capabilities: AIThemeCapabilities): OpenAIState {
  const provider = capabilities.providers.find((p) => p.id === "openai");
  return {
    enabled: capabilities.enabled,
    configured: provider?.configured ? (provider.verificationRequired ? "pending" : true) : false,
  };
}

/**
 * The OpenAI key form of Theme Studio. It is used by "Create with AI" (setup)
 * and by the Theme Studio AI row in Settings, so both connect the same way.
 */
function readConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function OpenAIKeyForm({
  inSetup, onConnectingChange, onConnected, onDisconnected,
}: {
  inSetup: boolean;
  onConnectingChange: (busy: boolean) => void;
  /** `kept` is the helper's answer on whether the key survives restarts; undefined when no new key was checked. */
  onConnected: (kept?: boolean) => void;
  onDisconnected: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState<boolean | "pending">(false);
  const [consent, setConsent] = useState(readConsent);
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetchAIThemeCapabilities(controller.signal)
      .then((capabilities) => {
        const state = openAIState(capabilities);
        setEnabled(state.enabled);
        setConfigured(state.configured);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    return () => controller.abort();
  }, []);

  function setBusy(value: boolean) {
    setConnecting(value);
    onConnectingChange(value);
  }
  function updateConsent(value: boolean) {
    setConsent(value);
    try {
      if (value) localStorage.setItem(CONSENT_KEY, "1");
      else localStorage.removeItem(CONSENT_KEY);
    } catch {
      /* Never store a key or block editing on browser storage. */
    }
  }
  async function connect() {
    const key = password.trim();
    if ((!key && configured !== "pending") || connecting || !consent) return;
    setPassword("");
    setBusy(true);
    setConnectionError("");
    try {
      if (key) {
        await saveAIThemeCredential("openai", key);
        setConfigured("pending");
      }
      const kept = await verifyAIThemeCredential("openai");
      setConfigured(true);
      onConnected(kept);
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : "Connection failed.");
      // A failed model check is not proof of a bad key. Keep it in helper
      // memory for a deliberate retry, without treating it as verified.
      const capabilities = await fetchAIThemeCapabilities().catch(() => null);
      if (capabilities) {
        const state = openAIState(capabilities);
        setEnabled(state.enabled);
        setConfigured(state.configured);
      } else setConfigured(false);
    } finally {
      setBusy(false);
    }
  }
  function disconnect() {
    setBusy(true);
    void deleteAIThemeCredential("openai")
      .then(() => {
        setConfigured(false);
        updateConsent(false);
        setPassword("");
        onDisconnected();
      })
      .catch(() => setConnectionError("Could not disconnect. Try again."))
      .finally(() => setBusy(false));
  }

  return (
    <div className="space-y-4">
      {configured !== true || !inSetup ? (
        <label className="grid gap-2 text-sm">
          {configured ? "Replace OpenAI key" : "OpenAI key"}
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            disabled={!enabled || connecting}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={configured ? "Paste a new key to replace it" : "Paste your key here"}
            aria-invalid={Boolean(connectionError)}
            aria-describedby={connectionError ? "key-error" : undefined}
          />
        </label>
      ) : null}
      {inSetup || !consent ? (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0"
            checked={consent}
            disabled={connecting}
            onChange={(e) => updateConsent(e.target.checked)}
          />
          I agree to send my prompt and design to OpenAI. Usage is billed to my account.
        </label>
      ) : null}
      {!enabled ? (
        <p role="alert" className="text-sm text-destructive">
          AI is unavailable. Try again later.
        </p>
      ) : null}
      {connectionError ? (
        <p id="key-error" role="alert" className="break-words text-sm text-destructive">
          {connectionError}
        </p>
      ) : null}
      <div className="grid gap-3">
        <Button
          className="h-12 w-full"
          disabled={
            !enabled ||
            connecting ||
            !consent ||
            (!inSetup && configured === true && !password.trim()) ||
            (!configured && !password.trim())
          }
          onClick={() => {
            if (password.trim() || configured === "pending") void connect();
            else onConnected();
          }}
        >
          {connecting
            ? "Checking…"
            : configured === "pending" && !password.trim()
              ? "Retry connection check"
              : !inSetup
                ? "Update key"
                : configured === true && !password.trim()
                  ? "Continue"
                  : "Connect and continue"}
        </Button>
        {configured ? (
          <Button className="h-12 w-full" variant="outline" disabled={connecting} onClick={disconnect}>
            Disconnect OpenAI
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The Theme Studio AI row in Settings › AI providers, with its key dialog. */
export function ThemeStudioKeyRow() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let current = true;
    void fetchAIThemeCapabilities()
      .then((capabilities) => {
        if (current) setConnected(openAIState(capabilities).configured === true);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [version]);

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm">{connected ? "Connected" : "Not connected"}</p>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {connected ? "Change key" : "Add key"}
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Theme Studio AI</DialogTitle>
            <DialogDescription>Connect OpenAI to create your design.</DialogDescription>
          </DialogHeader>
          <OpenAIKeyForm
            inSetup={false}
            onConnectingChange={setBusy}
            onConnected={() => {
              setOpen(false);
              setVersion((v) => v + 1);
            }}
            onDisconnected={() => setVersion((v) => v + 1)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
