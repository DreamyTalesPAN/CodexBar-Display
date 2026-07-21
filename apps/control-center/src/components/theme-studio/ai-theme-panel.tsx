"use client";

import { Bot, Check, Hammer, KeyRound, Send, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  buildAIThemeCandidate,
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
  const [generationStatus, setGenerationStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);

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
  if (!enabled) return null;

  const credentialBusy = credentialAction !== null;

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
    const refining = Boolean(session);
    setGenerationStatus(refining ? "Refining concept and preparing its hardware preview…" : "Creating concept and preparing its hardware preview…");
    const userMessage: AIThemeMessage = { content: prompt.trim(), createdAt: new Date().toISOString(), role: "user" };
    try {
      const concept = await generateAIThemeConcept({ history: [...history, userMessage], previous: session?.concept, prompt: prompt.trim() }, controller.signal);
      const candidate = await buildAIThemeCandidate(concept);
      onSessionChange({ built: false, candidate, concept });
      setHistory((value) => [...value, userMessage, { content: concept.style.notes, createdAt: new Date().toISOString(), role: "assistant" }]);
      setGenerationStatus("Concept ready. Review the screenmaster, then build the theme.");
    } catch (error) {
      setGenerationStatus(controller.signal.aborted ? "Concept creation cancelled." : error instanceof Error ? error.message : "Concept creation failed.");
    } finally {
      abortRef.current = null; generationInFlightRef.current = false; setGenerationBusy(false);
    }
  }

  function discard(message: string) { onSessionChange(null); setGenerationStatus(message); }

  return (
    <aside className="grid min-h-0 gap-3 rounded-[var(--radius-card)] border bg-card p-4 lg:h-full lg:grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <div><h3 className="flex items-center gap-2 font-bold"><Bot className="size-4" />AI Theme Builder</h3><p className="text-xs text-muted-foreground">Create one hardware-ready screenmaster, refine it, then build and apply.</p></div>
      <div className="grid gap-2">
        {!configured ? (
          <div className="flex gap-2"><Input aria-label="OpenAI key" autoComplete="off" disabled={credentialBusy || generationBusy} onChange={(event) => setAPIKey(event.target.value)} placeholder="OpenAI key" type="password" value={apiKey} /><Button disabled={credentialBusy || generationBusy || !apiKey.trim()} onClick={() => void storeCredential()} size="sm"><KeyRound />{credentialAction === "storing" ? "Storing…" : "Store key"}</Button></div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"><span className="flex items-center gap-1"><Check className="size-3" />OpenAI key stored</span><div className="flex items-center gap-1"><Button disabled={credentialBusy || generationBusy} onClick={() => void testCredential()} size="sm" variant="outline">{credentialAction === "testing" ? <Spinner /> : <KeyRound />}{credentialAction === "testing" ? "Testing…" : "Test key"}</Button><Button disabled={credentialBusy || generationBusy} onClick={() => void removeCredential()} size="icon-sm" title="Remove key" variant="ghost"><Trash2 /></Button></div></div>
        )}
        {credentialFeedback ? <p aria-live="polite" className={`rounded-md border px-3 py-2 text-xs ${credentialFeedback.state === "error" ? "border-destructive/40 text-destructive" : "bg-muted text-foreground"}`}>{credentialFeedback.state === "testing" ? <Spinner className="mr-1 inline" /> : credentialFeedback.state === "verified" ? <Check className="mr-1 inline size-3" /> : null}{credentialFeedback.message}</p> : null}
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {history.slice(-6).map((message, index) => <div className="rounded-md bg-muted p-2 text-xs" key={`${message.createdAt}-${index}`}><strong>{message.role === "user" ? "You" : "AI"}</strong><p>{message.content}</p></div>)}
        {session ? <Alert><Sparkles /><AlertTitle>{session.candidate.packName}</AlertTitle><AlertDescription>{session.candidate.notes}</AlertDescription></Alert> : null}
      </div>
      <div className="grid gap-2">
        <Textarea aria-label="AI theme prompt" disabled={generationBusy} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder={session ? "Make the cat larger and the colors warmer…" : "Create a premium synthwave cat theme…"} value={prompt} />
        {generationStatus ? <p aria-live="polite" className="rounded-md border bg-muted px-3 py-2 text-sm font-medium text-foreground">{generationBusy ? <Spinner className="mr-1 inline" /> : null}{generationStatus}</p> : null}
        <div className="flex flex-wrap gap-2">
          {!session?.built ? <Button disabled={credentialBusy || generationBusy || !configured || !prompt.trim()} onClick={() => void createOrRefineConcept()} size="sm">{generationBusy ? <Spinner /> : <Send />}{generationBusy ? (session ? "Refining…" : "Creating…") : (session ? "Refine concept" : "Create concept")}</Button> : null}
          {generationBusy ? <Button onClick={() => abortRef.current?.abort()} size="sm" variant="outline"><X />Cancel</Button> : null}
          {session && !session.built ? <Button disabled={generationBusy} onClick={() => { onSessionChange({ ...session, built: true }); setGenerationStatus("Theme built. The screenmaster is unchanged and ready to apply."); }} size="sm" variant="secondary"><Hammer />Build theme</Button> : null}
          {session?.built ? <><Button onClick={() => { onApply(session.candidate); discard("Theme applied as one undo step."); }} size="sm" variant="secondary"><Check />Apply</Button><Button onClick={() => { onSessionChange({ ...session, built: false }); setGenerationStatus("Back to concept. The editor is unchanged."); }} size="sm" variant="outline"><Undo2 />Back to concept</Button></> : null}
          {session ? <Button disabled={generationBusy} onClick={() => discard("Concept discarded.")} size="sm" variant="ghost">Discard</Button> : null}
        </div>
      </div>
    </aside>
  );
}
