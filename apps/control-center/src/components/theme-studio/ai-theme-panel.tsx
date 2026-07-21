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

export function AIThemePanel({ currentSpec, onApply }: { currentSpec: ThemeStudioSpec; onApply: (candidate: AIThemeCandidate) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<AIThemeProviderId>("openai");
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [apiKey, setAPIKey] = useState("");
  const [mode, setMode] = useState<AIThemeMode>("create");
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<AIThemeMessage[]>(() =>
    loadAIThemeHistory(currentSpec.themeId),
  );
  const [candidate, setCandidate] = useState<AIThemeCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAIThemeCapabilities(controller.signal)
      .then((caps) => {
        setEnabled(caps.enabled);
        setConfigured(Object.fromEntries(caps.providers.map((item) => [item.id, item.configured])));
      })
      .catch(() => setEnabled(false));
    return () => controller.abort();
  }, []);

  useEffect(() => saveAIThemeHistory(currentSpec.themeId, history), [currentSpec.themeId, history]);

  if (!enabled) return null;

  async function storeCredential() {
    if (!apiKey.trim()) return;
    setBusy(true); setStatus("Saving key securely…");
    try {
      await saveAIThemeCredential(provider, apiKey);
      setAPIKey("");
      await verifyAIThemeCredential(provider);
      setConfigured((value) => ({ ...value, [provider]: true }));
      setStatus("Key verified and stored by the local app.");
    } catch (error) { setAPIKey(""); setStatus(error instanceof Error ? error.message : "Key setup failed."); }
    finally { setBusy(false); }
  }

  async function removeCredential() {
    setBusy(true);
    try { await deleteAIThemeCredential(provider); setConfigured((value) => ({ ...value, [provider]: false })); setStatus("Key removed."); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Key removal failed."); }
    finally { setBusy(false); }
  }

  async function runGeneration(nextPrompt = prompt) {
    if (!nextPrompt.trim()) return;
    const controller = new AbortController(); abortRef.current = controller; setBusy(true); setStatus("Creating an isolated candidate…");
    const userMessage: AIThemeMessage = { content: nextPrompt.trim(), createdAt: new Date().toISOString(), role: "user" };
    try {
      const next = await generateAITheme({ baseSpec: mode === "improve" ? currentSpec : undefined, history: [...history, userMessage], mode, prompt: nextPrompt.trim(), providerId: provider }, controller.signal);
      setCandidate(next);
      setHistory((value) => [...value, userMessage, { content: next.notes, createdAt: new Date().toISOString(), role: "assistant" }]);
      setStatus("Candidate ready. Review it before applying.");
    } catch (error) { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Generation failed."); }
    finally { abortRef.current = null; setBusy(false); }
  }

  return (
    <aside className="grid min-h-0 gap-3 rounded-[var(--radius-card)] border bg-card p-4 lg:h-full lg:grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <div><h3 className="flex items-center gap-2 font-bold"><Bot className="size-4" />AI Theme Builder</h3><p className="text-xs text-muted-foreground">Create or improve a candidate. Nothing changes until Apply.</p></div>
      <div className="grid gap-2">
        <Select value={provider} onValueChange={(value) => setProvider(value as AIThemeProviderId)}><SelectTrigger aria-label="AI provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="anthropic">Anthropic</SelectItem></SelectContent></Select>
        {!configured[provider] ? <div className="flex gap-2"><Input aria-label={`${provider === "openai" ? "OpenAI" : "Anthropic"} key`} autoComplete="off" onChange={(event) => setAPIKey(event.target.value)} placeholder={`${provider === "openai" ? "OpenAI" : "Anthropic"} key`} type="password" value={apiKey} /><Button disabled={busy || !apiKey.trim()} onClick={() => void storeCredential()} size="icon" title="Save and verify key"><KeyRound /></Button></div> : <div className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"><span className="flex items-center gap-1"><Check className="size-3" />Key configured</span><Button disabled={busy} onClick={() => void removeCredential()} size="icon-sm" variant="ghost" title="Remove key"><Trash2 /></Button></div>}
        <Select value={mode} onValueChange={(value) => setMode(value as AIThemeMode)}><SelectTrigger aria-label="Generation mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="create">Create new theme</SelectItem><SelectItem value="improve">Improve current theme</SelectItem></SelectContent></Select>
      </div>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {history.slice(-6).map((message, index) => <div className="rounded-md bg-muted p-2 text-xs" key={`${message.createdAt}-${index}`}><strong>{message.role === "user" ? "You" : "AI"}</strong><p>{message.content}</p></div>)}
        {candidate ? <Alert><Sparkles /><AlertTitle>{candidate.packName}</AlertTitle><AlertDescription>{candidate.notes}</AlertDescription></Alert> : null}
      </div>
      <div className="grid gap-2">
        <Textarea aria-label="AI theme prompt" disabled={busy} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder={mode === "create" ? "Create a neon finance theme…" : "Make this theme calmer…"} value={prompt} />
        {status ? <p aria-live="polite" className="text-xs text-muted-foreground">{busy ? <Spinner className="mr-1 inline" /> : null}{status}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !configured[provider] || !prompt.trim()} onClick={() => void runGeneration()} size="sm"><Send />{candidate ? "Refine" : mode === "create" ? "Create" : "Improve"}</Button>
          {candidate ? <Button disabled={busy} onClick={() => void runGeneration(prompt)} size="sm" variant="outline"><RotateCcw />Regenerate</Button> : null}
          {busy ? <Button onClick={() => abortRef.current?.abort()} size="sm" variant="outline"><X />Cancel</Button> : null}
          {candidate ? <><Button onClick={() => { onApply(candidate); setCandidate(null); setStatus("Candidate applied as one undo step."); }} size="sm" variant="secondary"><Check />Apply</Button><Button onClick={() => { setCandidate(null); setStatus("Candidate discarded."); }} size="sm" variant="ghost">Discard</Button></> : null}
        </div>
      </div>
    </aside>
  );
}
