"use client";

import { Bot, Check, KeyRound, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteAIThemeCredential,
  fetchAIThemeCapabilities,
  generateAITheme,
  loadAIThemeHistory,
  saveAIThemeCredential,
  saveAIThemeHistory,
  verifyAIThemeCredential,
  type AIThemeCandidate,
  type AIThemeMessage,
  type AIThemeMode,
  type AIThemeProviderId,
} from "@/lib/ai-theme";
import type { ThemeStudioSpec } from "@/lib/theme-studio";

type CredentialFeedback = {
  message: string;
  state: "stored" | "testing" | "verified" | "error";
};

type GenerationAction = "creating" | "improving" | "refining" | "regenerating";

const generationLabels: Record<GenerationAction, string> = {
  creating: "Creating…",
  improving: "Improving…",
  refining: "Refining…",
  regenerating: "Regenerating…",
};

export function AIThemePanel({
  candidate,
  currentSpec,
  onApply,
  onCandidateChange,
}: {
  candidate: AIThemeCandidate | null;
  currentSpec: ThemeStudioSpec;
  onApply: (candidate: AIThemeCandidate) => void;
  onCandidateChange: (candidate: AIThemeCandidate | null) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AIThemeProviderId>("openai");
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [credentialFeedback, setCredentialFeedback] = useState<
    Partial<Record<AIThemeProviderId, CredentialFeedback>>
  >({});
  const [credentialAction, setCredentialAction] = useState<
    "storing" | "testing" | "removing" | null
  >(null);
  const [apiKey, setAPIKey] = useState("");
  const [mode, setMode] = useState<AIThemeMode>("create");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<AIThemeMessage[]>(() =>
    loadAIThemeHistory(currentSpec.themeId),
  );
  const [generationAction, setGenerationAction] =
    useState<GenerationAction | null>(null);
  const [generationStatus, setGenerationStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchAIThemeCapabilities(controller.signal)
      .then((caps) => {
        setEnabled(caps.enabled);
        setConfigured(Object.fromEntries(caps.providers.map((item) => [item.id, item.configured])));
        setCredentialFeedback(
          Object.fromEntries(
            caps.providers
              .filter((item) => item.configured)
              .map((item) => [
                item.id,
                { message: "Key stored securely. Test it before generating.", state: "stored" },
              ]),
          ),
        );
      })
      .catch(() => setEnabled(false));
    return () => controller.abort();
  }, []);

  useEffect(() => saveAIThemeHistory(currentSpec.themeId, history), [currentSpec.themeId, history]);

  if (!enabled) return null;

  const credentialBusy = credentialAction !== null;
  const generationBusy = generationAction !== null;
  const primaryAction: GenerationAction = candidate
    ? "refining"
    : mode === "create"
      ? "creating"
      : "improving";
  const primaryLabel = candidate ? "Refine" : mode === "create" ? "Create" : "Improve";
  const providerFeedback = credentialFeedback[provider];

  async function storeCredential() {
    if (!apiKey.trim() || credentialBusy || generationBusy) return;
    setCredentialAction("storing");
    setCredentialFeedback((value) => ({
      ...value,
      [provider]: { message: "Storing key securely…", state: "stored" },
    }));
    try {
      await saveAIThemeCredential(provider, apiKey);
      setConfigured((value) => ({ ...value, [provider]: true }));
      setCredentialFeedback((value) => ({
        ...value,
        [provider]: { message: "Key stored securely. Test it before generating.", state: "stored" },
      }));
    } catch (error) {
      setCredentialFeedback((value) => ({
        ...value,
        [provider]: {
          message: error instanceof Error ? error.message : "Key storage failed.",
          state: "error",
        },
      }));
    } finally {
      setAPIKey("");
      setCredentialAction(null);
    }
  }

  async function testCredential() {
    if (!configured[provider] || credentialBusy || generationBusy) return;
    setCredentialAction("testing");
    setCredentialFeedback((value) => ({
      ...value,
      [provider]: { message: "Testing key…", state: "testing" },
    }));
    try {
      await verifyAIThemeCredential(provider);
      setCredentialFeedback((value) => ({
        ...value,
        [provider]: { message: "Key verified.", state: "verified" },
      }));
    } catch (error) {
      setCredentialFeedback((value) => ({
        ...value,
        [provider]: {
          message: error instanceof Error ? error.message : "Key verification failed.",
          state: "error",
        },
      }));
    } finally {
      setCredentialAction(null);
    }
  }

  async function removeCredential() {
    if (credentialBusy || generationBusy) return;
    setCredentialAction("removing");
    try {
      await deleteAIThemeCredential(provider);
      setConfigured((value) => ({ ...value, [provider]: false }));
      setCredentialFeedback((value) => {
        const next = { ...value };
        delete next[provider];
        return next;
      });
    } catch (error) {
      setCredentialFeedback((value) => ({
        ...value,
        [provider]: {
          message: error instanceof Error ? error.message : "Key removal failed.",
          state: "error",
        },
      }));
    } finally {
      setCredentialAction(null);
    }
  }

  async function runGeneration(action: GenerationAction, nextPrompt = prompt) {
    if (!nextPrompt.trim() || generationInFlightRef.current || credentialBusy) return;
    generationInFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerationAction(action);
    setGenerationStatus(`${generationLabels[action].replace("…", "")} an isolated candidate…`);
    const userMessage: AIThemeMessage = {
      content: nextPrompt.trim(),
      createdAt: new Date().toISOString(),
      role: "user",
    };
    try {
      const next = await generateAITheme(
        {
          baseSpec: mode === "improve" ? currentSpec : undefined,
          history: [...history, userMessage],
          mode,
          prompt: nextPrompt.trim(),
          providerId: provider,
        },
        controller.signal,
      );
      onCandidateChange(next);
      setHistory((value) => [
        ...value,
        userMessage,
        { content: next.notes, createdAt: new Date().toISOString(), role: "assistant" },
      ]);
      setGenerationStatus("Candidate ready. Review it before applying.");
    } catch (error) {
      setGenerationStatus(
        controller.signal.aborted
          ? "Generation cancelled."
          : error instanceof Error
            ? error.message
            : "Generation failed.",
      );
    } finally {
      abortRef.current = null;
      generationInFlightRef.current = false;
      setGenerationAction(null);
    }
  }

  function clearCandidate(message: string) {
    onCandidateChange(null);
    setGenerationStatus(message);
  }

  return (
    <aside className="grid min-h-0 gap-3 rounded-[var(--radius-card)] border bg-card p-4 lg:h-full lg:grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <div><h3 className="flex items-center gap-2 font-bold"><Bot className="size-4" />AI Theme Builder</h3><p className="text-xs text-muted-foreground">Create or improve a candidate. Nothing changes until Apply.</p></div>
      <div className="grid gap-2">
        <Select disabled={credentialBusy || generationBusy} value={provider} onValueChange={(value) => setProvider(value as AIThemeProviderId)}><SelectTrigger aria-label="AI provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem></SelectContent></Select>
        {!configured[provider] ? (
          <div className="flex gap-2">
            <Input aria-label={`${provider === "openai" ? "OpenAI" : "Anthropic"} key`} autoComplete="off" disabled={credentialBusy || generationBusy} onChange={(event) => setAPIKey(event.target.value)} placeholder={`${provider === "openai" ? "OpenAI" : "Anthropic"} key`} type="password" value={apiKey} />
            <Button disabled={credentialBusy || generationBusy || !apiKey.trim()} onClick={() => void storeCredential()} size="sm"><KeyRound />{credentialAction === "storing" ? "Storing…" : "Store key"}</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
            <span className="flex items-center gap-1"><Check className="size-3" />Key stored</span>
            <div className="flex items-center gap-1">
              <Button disabled={credentialBusy || generationBusy} onClick={() => void testCredential()} size="sm" variant="outline">{credentialAction === "testing" ? <Spinner /> : <KeyRound />}{credentialAction === "testing" ? "Testing…" : "Test key"}</Button>
              <Button disabled={credentialBusy || generationBusy} onClick={() => void removeCredential()} size="icon-sm" variant="ghost" title="Remove key"><Trash2 /></Button>
            </div>
          </div>
        )}
        {providerFeedback ? (
          <p aria-live="polite" className={`rounded-md border px-3 py-2 text-xs ${providerFeedback.state === "error" ? "border-destructive/40 text-destructive" : "bg-muted text-foreground"}`}>
            {providerFeedback.state === "testing" ? <Spinner className="mr-1 inline" /> : providerFeedback.state === "verified" ? <Check className="mr-1 inline size-3" /> : null}
            {providerFeedback.message}
          </p>
        ) : null}
        <Select disabled={credentialBusy || generationBusy} value={mode} onValueChange={(value) => setMode(value as AIThemeMode)}><SelectTrigger aria-label="Generation mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="create">Create new theme</SelectItem><SelectItem value="improve">Improve current theme</SelectItem></SelectContent></Select>
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {history.slice(-6).map((message, index) => <div className="rounded-md bg-muted p-2 text-xs" key={`${message.createdAt}-${index}`}><strong>{message.role === "user" ? "You" : "AI"}</strong><p>{message.content}</p></div>)}
        {candidate ? <Alert><Sparkles /><AlertTitle>{candidate.packName}</AlertTitle><AlertDescription>{candidate.notes}</AlertDescription></Alert> : null}
      </div>
      <div className="grid gap-2">
        <Textarea aria-label="AI theme prompt" disabled={generationBusy} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "create" ? "Create a neon finance theme…" : "Make this theme calmer…"} value={prompt} />
        {generationStatus ? <p aria-live="polite" className="rounded-md border bg-muted px-3 py-2 text-sm font-medium text-foreground">{generationBusy ? <Spinner className="mr-1 inline" /> : null}{generationStatus}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={credentialBusy || generationBusy || !configured[provider] || !prompt.trim()} onClick={() => void runGeneration(primaryAction)} size="sm">{generationBusy && generationAction === primaryAction ? <Spinner /> : <Send />}{generationBusy && generationAction === primaryAction ? generationLabels[primaryAction] : primaryLabel}</Button>
          {candidate ? <Button disabled={credentialBusy || generationBusy} onClick={() => void runGeneration("regenerating", prompt)} size="sm" variant="outline">{generationAction === "regenerating" ? <Spinner /> : <RotateCcw />}{generationAction === "regenerating" ? generationLabels.regenerating : "Regenerate"}</Button> : null}
          {generationBusy ? <Button onClick={() => abortRef.current?.abort()} size="sm" variant="outline"><X />Cancel</Button> : null}
          {candidate ? <><Button disabled={generationBusy} onClick={() => { onApply(candidate); clearCandidate("Candidate applied as one undo step."); }} size="sm" variant="secondary"><Check />Apply</Button><Button disabled={generationBusy} onClick={() => clearCandidate("Candidate discarded.")} size="sm" variant="ghost">Discard</Button></> : null}
        </div>
      </div>
    </aside>
  );
}
