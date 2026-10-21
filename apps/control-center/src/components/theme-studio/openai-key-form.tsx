"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SetupDialog } from "@/components/setup/setup-dialog";
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

/** A key is stored while its check is still pending too, so the label follows the stored key, not the verified one. */
export function hasStoredKey(configured: boolean | "pending"): boolean {
  return Boolean(configured);
}

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
  inSetup, initialConfigured = false, onConfiguredChange, onConnectingChange, onConnected, onDisconnected, onDismiss,
}: {
  inSetup: boolean;
  /** What the opener already knows about the saved key, so the dialog has its final height from the first frame. */
  initialConfigured?: boolean | "pending";
  /** Tells the opener whenever the stored-key state changes, e.g. a key was saved but its check failed, so its label and the dialog title follow. */
  onConfiguredChange?: (configured: boolean | "pending") => void;
  onConnectingChange: (busy: boolean) => void;
  /** `kept` is the helper's answer on whether the key survives restarts; undefined when no new key was checked. */
  onConnected: (kept?: boolean) => void;
  onDisconnected: () => void;
  /** "Not now": closes the dialog the form sits in. */
  onDismiss: () => void;
}) {
  // null while the helper is still being asked: the dialog shows its final layout from the first frame, with no "unavailable" notice that vanishes again.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState<boolean | "pending">(initialConfigured);
  const [consent, setConsent] = useState(readConsent);
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  // Bumped by every read and every configured-state change: a read that a later change has overtaken is stale and must not write back.
  const generation = useRef(0);
  function changeConfigured(value: boolean | "pending") {
    generation.current += 1;
    setConfigured(value);
    onConfiguredChange?.(value);
  }
  /** The one capability read. A failed read keeps the last known state; only the mount-time read reports the helper as unavailable. */
  function readState(onFail?: () => void) {
    const current = ++generation.current;
    void fetchAIThemeCapabilities().then(
      (capabilities) => {
        if (current !== generation.current) return;
        const state = openAIState(capabilities);
        setEnabled(state.enabled);
        setConfigured(state.configured);
        // Reported even after the dialog closed: the opener keeps the answer it could not get from this form.
        onConfiguredChange?.(state.configured);
      },
      () => {
        if (current === generation.current) onFail?.();
      },
    );
  }

  useEffect(() => readState(() => setEnabled(false)), []); // eslint-disable-line react-hooks/exhaustive-deps

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
        changeConfigured("pending");
      }
      const kept = await verifyAIThemeCredential("openai");
      changeConfigured(true);
      onConnected(kept);
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : "Connection failed.");
      // A failed model check is not proof of a bad key. Keep it in helper
      // memory for a deliberate retry, without treating it as verified.
      readState();
    } finally {
      setBusy(false);
    }
  }
  function disconnect() {
    generation.current += 1; // the mount-time read is stale from here on
    setBusy(true);
    void deleteAIThemeCredential("openai")
      .then(() => {
        changeConfigured(false);
        updateConsent(false);
        setPassword("");
        onDisconnected();
      })
      .catch(() => setConnectionError("Could not disconnect. Try again."))
      .finally(() => {
        setBusy(false);
        readState();
      });
  }

  return (
    <div className="space-y-4">
      {configured !== true || !inSetup ? (
        <label className="grid gap-2 text-[13px]">
          {/* The dialog heading already says "Add OpenAI key" or "Replace OpenAI key". */}
          <span className="sr-only">{hasStoredKey(configured) ? "Replace OpenAI key" : "OpenAI key"}</span>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            disabled={enabled === false || connecting}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasStoredKey(configured) ? "Paste a new key to replace it" : "Paste your key here"}
            className="text-[13px] md:text-[13px]"
            aria-invalid={Boolean(connectionError)}
            aria-describedby={connectionError ? "key-error" : undefined}
          />
        </label>
      ) : null}
      {inSetup || !consent ? (
        <label className="flex items-start gap-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={consent}
            disabled={connecting}
            onChange={(e) => updateConsent(e.target.checked)}
          />
          I agree to send my prompt and design to OpenAI. Usage is billed to my account.
        </label>
      ) : null}
      {enabled === false ? (
        <p role="alert" className="text-sm text-destructive">
          AI is unavailable. Try again later.
        </p>
      ) : null}
      {connectionError ? (
        <p id="key-error" role="alert" className="break-words text-sm text-destructive">
          {connectionError}
        </p>
      ) : null}
      {/* One row, as in the approved dialog: Not now, then the main action; Disconnect stays quietly on the left. */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        {hasStoredKey(configured) ? (
          <Button className="mr-auto" variant="ghost" disabled={connecting} onClick={disconnect}>
            Disconnect OpenAI
          </Button>
        ) : null}
        <Button variant="ghost" disabled={connecting} onClick={onDismiss}>
          Not now
        </Button>
        <Button
          disabled={
            !enabled ||
            connecting ||
            !consent ||
            (!inSetup && configured === true && !password.trim()) ||
            (!hasStoredKey(configured) && !password.trim())
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
                ? hasStoredKey(configured)
                  ? "Update key"
                  : "Save key"
                : configured === true && !password.trim()
                  ? "Continue"
                  : "Connect and continue"}
        </Button>
      </div>
    </div>
  );
}

/** The Theme Studio AI row in Settings › AI providers, with its key dialog. */
export function ThemeStudioKeyRow() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | "pending">(false);
  // Same rule as the dialog: every change starts a fresh read, and a read that a later change overtakes is ignored.
  const generation = useRef(0);
  function readConfigured() {
    const current = ++generation.current;
    void fetchAIThemeCapabilities()
      .then((capabilities) => {
        if (current === generation.current) setConfigured(openAIState(capabilities).configured);
      })
      .catch(() => {});
  }
  useEffect(() => readConfigured(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-4 text-[13px]">
      <span className="w-[168px] shrink-0 text-muted-foreground">API key</span>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
        <span className="inline-flex items-center gap-2">
          <i aria-hidden className={`size-2 shrink-0 rounded-full ${configured === true ? "bg-[oklch(0.72_0.15_150)]" : "bg-muted-foreground/40"}`} />
          {configured === true ? "Connected" : "Not connected"}
        </span>
        <Button variant="outline" size="sm" className="px-3.5 text-[13px]" onClick={() => setOpen(true)}>
          {hasStoredKey(configured) ? "Change key" : "Add key"}
        </Button>
      </div>
      {/* The same dialog as every other overlay: no entrance animation of its own. */}
      <SetupDialog
        open={open}
        onOpenChange={(next) => { if (!busy) setOpen(next); }}
        title={hasStoredKey(configured) ? "Replace OpenAI key" : "Add OpenAI key"}
        // Calm rule 13: no X; "Not now" sits in the form's own button row.
        showCloseButton={false}
      >
        <OpenAIKeyForm
          inSetup={false}
          initialConfigured={configured}
          onConfiguredChange={(value) => {
            generation.current += 1;
            setConfigured(value);
          }}
          onConnectingChange={setBusy}
          onConnected={() => setOpen(false)}
          onDisconnected={readConfigured}
          onDismiss={() => setOpen(false)}
        />
      </SetupDialog>
    </div>
  );
}
