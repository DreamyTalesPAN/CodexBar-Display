"use client";

import { Bot, Check, KeyRound, RefreshCw, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  buildAIThemeCandidate,
  clearAIThemeHistory,
  deleteAIThemeCredential,
  fetchAIThemeCapabilities,
  generateAIThemeConcept,
  loadAIThemeHistory,
  saveAIThemeCredential,
  saveAIThemeHistory,
  verifyAIThemeCredential,
  type AIThemeCandidate,
  type AIThemeMessage,
  type AIThemeSession,
} from "@/lib/ai-theme";
import type { ThemeStudioSpec } from "@/lib/theme-studio";

type CredentialFeedback = { message: string; state: "stored" | "testing" | "verified" | "error" };

function displayMessage(content: string): string {
  if (content === "Theme draft ready. Review the preview, then apply it.") {
    return "Theme created. You can edit it now or ask for changes.";
  }
  if (content === "Draft refined. Review the updated preview, then apply it.") {
    return "Theme updated. You can edit it now or ask for more changes.";
  }
  return content;
}

export function AIThemePanel({ currentSpec, onApply, onSessionChange, session }: {
  currentSpec: ThemeStudioSpec;
  onApply: (candidate: AIThemeCandidate) => void;
  onSessionChange: (session: AIThemeSession | null) => void;
  session: AIThemeSession | null;
}) {
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [credentialFeedback, setCredentialFeedback] = useState<CredentialFeedback | null>(null);
  const [credentialAction, setCredentialAction] = useState<"storing" | "testing" | "removing" | null>(null);
  const [apiKey, setAPIKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<AIThemeMessage[]>(() => loadAIThemeHistory(currentSpec.themeId));
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);
  const resetVersionRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchAIThemeCapabilities(controller.signal).then((caps) => {
      setEnabled(caps.enabled);
      const stored = Boolean(caps.providers.find((item) => item.id === "openai")?.configured);
      setConfigured(stored);
      if (stored) setCredentialFeedback({ message: "Key stored securely. Test it before creating a concept.", state: "stored" });
    }).catch(() => setEnabled(false));
    return () => controller.abort();
  }, []);

  useEffect(() => saveAIThemeHistory(currentSpec.themeId, history), [currentSpec.themeId, history]);

  useEffect(() => {
    if (!credentialFeedback || credentialFeedback.state === "error" || credentialFeedback.state === "testing") {
      return;
    }
    const timer = window.setTimeout(() => setCredentialFeedback(null), 3500);
    return () => window.clearTimeout(timer);
  }, [credentialFeedback]);

  if (!enabled) return null;

  const credentialBusy = credentialAction !== null;
  const canCreateOrRefine = !credentialBusy && !generationBusy && configured && Boolean(prompt.trim());

  async function storeCredential() {
    if (!apiKey.trim() || credentialBusy || generationBusy) return;
    setCredentialAction("storing");
    try {
      await saveAIThemeCredential("openai", apiKey);
      setConfigured(true);
      setCredentialFeedback({ message: "Key stored securely. Test it before creating a concept.", state: "stored" });
    } catch (error) {
      setCredentialFeedback({ message: error instanceof Error ? error.message : "Key storage failed.", state: "error" });
    } finally { setAPIKey(""); setCredentialAction(null); }
  }

  async function testCredential() {
    if (!configured || credentialBusy || generationBusy) return;
    setCredentialAction("testing"); setCredentialFeedback({ message: "Testing OpenAI image access…", state: "testing" });
    try {
      await verifyAIThemeCredential("openai");
      setCredentialFeedback({ message: "Key verified for image generation.", state: "verified" });
    } catch (error) {
      setCredentialFeedback({ message: error instanceof Error ? error.message : "Key verification failed.", state: "error" });
    } finally { setCredentialAction(null); }
  }

  async function removeCredential() {
    if (credentialBusy || generationBusy) return;
    setCredentialAction("removing");
    try { await deleteAIThemeCredential("openai"); setConfigured(false); setCredentialFeedback(null); }
    catch (error) { setCredentialFeedback({ message: error instanceof Error ? error.message : "Key removal failed.", state: "error" }); }
    finally { setCredentialAction(null); }
  }

  async function createOrRefineConcept() {
    if (!prompt.trim() || generationInFlightRef.current || credentialBusy) return;
    generationInFlightRef.current = true; setGenerationBusy(true);
    const controller = new AbortController(); abortRef.current = controller;
    const resetVersion = resetVersionRef.current;
    const refining = Boolean(session);
    const assistantMessage = refining
      ? "Theme updated. You can edit it now or ask for more changes."
      : "Theme created. You can edit it now or ask for changes.";
    setGenerationError("");
    const userMessage: AIThemeMessage = { content: prompt.trim(), createdAt: new Date().toISOString(), role: "user" };
    try {
      const concept = await generateAIThemeConcept({ history: [...history, userMessage], previous: session?.concept, prompt: prompt.trim() }, controller.signal);
      const candidate = await buildAIThemeCandidate(concept);
      if (resetVersionRef.current !== resetVersion) return;
      onApply(candidate);
      onSessionChange({ candidate, concept });
      setHistory((value) => [...value, userMessage, { content: assistantMessage, createdAt: new Date().toISOString(), role: "assistant" }]);
      setPrompt("");
    } catch (error) {
      if (resetVersionRef.current !== resetVersion) return;
      setGenerationError(controller.signal.aborted ? "Concept creation cancelled." : error instanceof Error ? error.message : "Concept creation failed.");
    } finally {
      if (resetVersionRef.current !== resetVersion) return;
      abortRef.current = null; generationInFlightRef.current = false; setGenerationBusy(false);
    }
  }

  function startOver() {
    resetVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    generationInFlightRef.current = false;
    setGenerationBusy(false);
    setPrompt("");
    setHistory([]);
    clearAIThemeHistory(currentSpec.themeId);
    onSessionChange(null);
    setGenerationError("");
    setCredentialFeedback(null);
  }

  function submitPromptFromKeyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (canCreateOrRefine) {
      void createOrRefineConcept();
    }
  }

  return (
    <aside className="grid min-h-[280px] max-h-[360px] gap-3 rounded-[var(--radius-card)] border bg-card p-4 grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <div><h3 className="flex items-center gap-2 font-bold"><Bot className="size-4" />AI Theme Builder</h3><p className="text-xs text-muted-foreground">Create a theme, edit it on the canvas, then ask for more changes.</p></div>
      <div className="grid gap-2">
        {!configured ? (
          <div className="flex gap-2"><Input aria-label="OpenAI key" autoComplete="off" disabled={credentialBusy || generationBusy} onChange={(event) => setAPIKey(event.target.value)} placeholder="OpenAI key" type="password" value={apiKey} /><Button disabled={credentialBusy || generationBusy || !apiKey.trim()} onClick={() => void storeCredential()} size="sm"><KeyRound />{credentialAction === "storing" ? "Storing…" : "Store key"}</Button></div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"><span className="flex items-center gap-1"><Check className="size-3" />OpenAI key stored</span><div className="flex items-center gap-1"><Button disabled={credentialBusy || generationBusy} onClick={() => void testCredential()} size="sm" variant="outline">{credentialAction === "testing" ? <Spinner /> : <KeyRound />}{credentialAction === "testing" ? "Testing…" : "Test key"}</Button><Button disabled={credentialBusy || generationBusy} onClick={() => void removeCredential()} size="icon-sm" title="Remove key" variant="ghost"><Trash2 /></Button></div></div>
        )}
        {credentialFeedback ? <p aria-live="polite" className={`rounded-md border px-3 py-2 text-xs ${credentialFeedback.state === "error" ? "border-destructive/40 text-destructive" : "bg-muted text-foreground"}`}>{credentialFeedback.state === "testing" ? <Spinner className="mr-1 inline" /> : credentialFeedback.state === "verified" ? <Check className="mr-1 inline size-3" /> : null}{credentialFeedback.message}</p> : null}
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {history.slice(-6).map((message, index) => <div className="rounded-md bg-muted p-2 text-xs" key={`${message.createdAt}-${index}`}><strong>{message.role === "user" ? "You" : "AI"}</strong><p>{displayMessage(message.content)}</p></div>)}
      </div>
      <div className="grid gap-2">
        <Textarea aria-label="AI theme prompt" disabled={generationBusy} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} onKeyDown={submitPromptFromKeyboard} placeholder={session ? "Make the cat larger and the colors warmer…" : "Create a premium synthwave cat theme…"} value={prompt} />
        {generationError ? <p aria-live="polite" className="rounded-md border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive">{generationError}</p> : null}
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Button className={generationBusy ? "" : "col-span-2"} disabled={!canCreateOrRefine} onClick={() => void createOrRefineConcept()} size="sm">{generationBusy ? <Spinner /> : <Send />}{generationBusy ? (session ? "Updating…" : "Creating…") : (session ? "Send change" : "Create theme")}</Button>
            {generationBusy ? <Button onClick={() => abortRef.current?.abort()} size="sm" variant="outline"><X />Cancel</Button> : null}
          </div>
          <Button className="w-full" disabled={generationBusy && !session} onClick={startOver} size="sm" variant="outline"><RefreshCw />Start over</Button>
        </div>
      </div>
    </aside>
  );
}
