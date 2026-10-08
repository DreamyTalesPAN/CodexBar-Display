"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Download,
  Settings,
  Type,
  TimerReset,
  ChartNoAxesColumn,
  ChevronDown,
  ImagePlus,
  Paperclip,
  Square,
  FolderOpen,
  X,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ControlCenterBrand } from "@/components/control-center-brand";
import { EditableThemePreview } from "./editable-theme-preview";
import { friendlyElementName } from "./theme-studio-customer-labels";
import { createDesignElement, isTypingTarget, LIVE_READINGS, pinnedElement, readingKey, setReading, type AddElementKind } from "./design-controls";
import { ColorField, NumberField } from "./editor-fields";
import {
  clampCompanionSize,
  clampedMoveDelta,
  clampInt,
  COMPANION_MAX_SIZE,
  DISPLAY_SIZE,
  isAspectLockedPrimitive,
  normalizeCompanionPrimitive,
  primitiveBounds,
  primitiveMaxBottom,
  setPrimitiveField,
  textPrimitiveFontSizeFromVisualHeight,
  textPrimitiveNaturalWidth,
  type FieldKey,
} from "./editor-geometry";
import {
  createThemeStudioEditorState,
  themeStudioEditorReducer,
  isThemeStudioDirty,
  type ThemeStudioDocument,
} from "./theme-studio-editor-state";
import {
  buildThemePack,
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  validateThemeSpec,
} from "@/lib/theme-studio";
import { importSpriteFile, uniqueAssetPath } from "@/lib/theme-studio-assets";
import {
  loadUserThemes,
  loadThemeStudioRecovery,
  writeThemeStudioRecovery,
  writeUserThemes,
  type UserThemeRecord,
} from "@/lib/theme-studio-storage";
import {
  buildAIThemeCandidate,
  fetchAIThemeCapabilities,
  generateAIThemeConcept,
  planAIThemeLayout,
  saveAIThemeCredential,
  verifyAIThemeCredential,
  deleteAIThemeCredential,
  AI_THEME_ANIMATION_ASSET_PATH,
  type AIThemeCapabilities,
} from "@/lib/ai-theme";
import {
  applyAIThemeCandidate,
  pruneUnusedThemeAssets,
  conceptFromDocument,
  setAIAnimationSpeed,
  spritePNG,
} from "@/lib/ai-theme-document";
import { AI_THEME_SCREENMASTER_ASSET_PATH } from "@/lib/ai-theme";
import { isAttachedSceneAnimation } from "@/lib/ai-theme";
import {applyAIThemeLayout,layoutContext} from "@/lib/ai-theme-layout";
import { sendThemeToVibeTV } from "@/lib/theme-install";

function blank(): ThemeStudioDocument {
  return {
    assets: {},
    packName: "My design",
    spec: { ...createBlankThemeSpec(), primitives: [] },
    usage: "live",
  };
}

export function AIThemeStudioScreen() {
  const [state, dispatch] = useReducer(
    themeStudioEditorReducer,
    undefined,
    () => createThemeStudioEditorState(blank()),
  );
  const document = state.present;
  const dirty = isThemeStudioDirty(state);
  // Async import paths read this after awaiting file contents so an edit made
  // meanwhile still triggers the unsaved-changes confirmation.
  const dirtyRef = useRef(dirty);
  const documentRef = useRef(document);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const persistedDraft = useRef<ThemeStudioDocument | null>(null);
  useEffect(() => {
    dirtyRef.current = dirty;
    documentRef.current = document;
  }, [dirty, document]);
  const [selected, setSelected] = useState<number[]>([]);
  const [panel, setPanel] = useState<
    "setup" | "settings" | "add" | "library" | null
  >(null);
  const [connectionError, setConnectionError] = useState("");
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; data: string }[]>([]);
  const [attaching, setAttaching] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState<boolean | "pending">(false);
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");
  const [transferJob, setTransferJob] = useState<string | null>(null);
  const sendRequest = useRef(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<UserThemeRecord[]>([]);
  const [libraryId, setLibraryId] = useState<string>();
  const [pending, setPending] = useState<{
    document: ThemeStudioDocument;
    id?: string;
  }>();
  const request = useRef<AbortController | null>(null);
  const documentVersion = useRef(0);
  const spriteInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const index = selected.at(-1) ?? -1;
  const primitive = document.spec.primitives[index];
  const resetBinding =
    primitive?.type === "text"
      ? primitive.binding ||
        primitive.text?.match(/\{(usageSlot[12]Reset)\}/)?.[1]
      : undefined;
  const resetWindow =
    resetBinding === "usageSlot1Reset"
      ? 1
      : resetBinding === "usageSlot2Reset"
        ? 2
        : undefined;
  const locked = busy || sending;
  const canCancel = busy && !loadingSample;
  const aiReady = configured === true && consent;
  const elementName = primitive
    ? friendlyElementName(primitive, document.assets)
    : "";
  const pack = useMemo(
    () => ({
      ok: true,
      name: document.packName,
      themeId: document.spec.themeId,
      spec: document.spec,
      assets: document.assets,
    }),
    [document],
  );
  const validation = useMemo(
    () => validateThemeSpec(document.spec, document.assets),
    [document],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchAIThemeCapabilities(controller.signal)
      .then(updateCapabilities)
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    const hydration = window.setTimeout(() => {
      try {
        setConsent(sessionStorage.getItem("vibetv.aiTheme.consent") === "1");
        setTransferJob(sessionStorage.getItem("vibetv.themeStudio.transferJob"));
      } catch {
        /* Keep consent and transfer state per-page when storage is unavailable. */
      }
      const loaded = loadUserThemes();
      const recovery = loadThemeStudioRecovery();
      if (loaded.ok) setLibrary(loaded.value.themes);
      else setError(loaded.error.message);
      if (!recovery.ok) setError(recovery.error.message);
      const restored = recovery.ok ? recovery.value : null;
      const latest = loaded.ok ? loaded.value.themes[0] : undefined;
      const saved = restored || latest;
      if (saved && !dirtyRef.current) {
        documentVersion.current++;
        const baseline = restored ? (loaded.ok ? loaded.value.themes.find((theme) => theme.id === restored.libraryId)?.document : undefined) || blank() : undefined;
        dispatch({ type: "load", document: saved.document, savedDocument: baseline });
        setLibraryId(restored ? restored.libraryId : latest?.id);
      }
      setRecoveryReady(recovery.ok);
    }, 0);
    return () => {
      window.clearTimeout(hydration);
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, []);
  useEffect(() => {
    if (!recoveryReady || state.transactionBase) return;
    const result = writeThemeStudioRecovery({
      document,
      libraryId,
      source: libraryId ? "custom" : "blank",
      updatedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      const timer = window.setTimeout(() => setError(result.error.message), 0);
      return () => window.clearTimeout(timer);
    }
    persistedDraft.current = document;
  }, [document, libraryId, recoveryReady, state.transactionBase]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (persistedDraft.current === document) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, document]);

  function updateCapabilities(capabilities: AIThemeCapabilities) {
    setEnabled(capabilities.enabled);
    const provider = capabilities.providers.find((p) => p.id === "openai");
    setConfigured(provider?.configured ? provider.verificationRequired ? "pending" : true : false);
  }

  function mutate(fn: (draft: ThemeStudioDocument) => void) {
    if (locked) return;
    dispatch({
      type: "mutate",
      mutate: (d) => {
        const attached = d.spec.primitives.some((p) =>
          isAttachedSceneAnimation(p.assetPath),
        );
        const art = d.spec.primitives.find(
          (p) => p.assetPath === AI_THEME_SCREENMASTER_ASSET_PATH,
        );
        const geometry = art
          ? { x: art.x, y: art.y, width: art.width, height: art.height }
          : undefined;
        fn(d);
        if (attached) {
          const nextArt = d.spec.primitives.find(
            (p) => p.assetPath === AI_THEME_SCREENMASTER_ASSET_PATH,
          );
          if (nextArt) Object.assign(nextArt, geometry);
          else
            d.spec.primitives = d.spec.primitives.filter(
              (p) => !isAttachedSceneAnimation(p.assetPath),
            );
        }
        d.spec = normalizeThemeSpec(d.spec);
        pruneUnusedThemeAssets(d);
      },
    });
    setError("");
  }
  function change(field: FieldKey, value: unknown) {
    mutate((d) => {
      const p = d.spec.primitives[index];
      if (p) {
        setPrimitiveField(p, field, value);
        if (p.type === "text" && (field === "fontSize" || field === "text")) {
          p.width = Math.max(p.width || 0, textPrimitiveNaturalWidth(p));
        }
      }
    });
  }
  function remove() {
    mutate((d) => {
      d.spec.primitives = d.spec.primitives.filter(
        (p, i) => !selected.includes(i) || pinnedElement(p, d.spec.primitives),
      );
    });
    setSelected([]);
    setStatus("Element removed. Undo brings it back.");
  }
  function nudge(dx: number, dy: number) {
    mutate((d) => {
      const origins = selected.flatMap((i) => {
        const p = d.spec.primitives[i];
        return p && !pinnedElement(p, d.spec.primitives)
          ? [
              {
                index: i,
                x: p.x,
                y: p.y,
                maxBottom: primitiveMaxBottom(p),
                width: primitiveBounds(p).width,
                height: primitiveBounds(p).height,
              },
            ]
          : [];
      });
      const delta = clampedMoveDelta(origins, dx, dy);
      origins.forEach((p) => {
        d.spec.primitives[p.index].x += delta.x;
        d.spec.primitives[p.index].y += delta.y;
      });
    });
  }
  function history(type: "undo" | "redo") {
    if (locked) return;
    documentVersion.current++;
    dispatch({ type });
    setSelected([]);
    setStatus(type === "undo" ? "Last edit undone." : "Edit restored.");
  }
  function load(next: { document: ThemeStudioDocument; id?: string }) {
    documentVersion.current++;
    dispatch({ type: "load", document: next.document });
    setLibraryId(next.id);
    setSelected([]);
    setPrompt("");
    setAttachments([]);
    setPending(undefined);
    setError("");
    setStatus("Design opened.");
  }
  function requestLoad(next: { document: ThemeStudioDocument; id?: string }) {
    if (dirtyRef.current) setPending(next);
    else load(next);
  }
  async function loadSample() {
    if (locked) return;
    setLoadingSample(true);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/theme-pack/token-fire");
      if (!response.ok) throw new Error("Sample unavailable");
      const sample = await response.json();
      const spec = importThemeSpec(sample.spec);
      const assets: ThemeStudioDocument["assets"] = { ...sample.assets };
      for (const [oldPath, newPath] of [
        ["/themes/s/tf-bg.cbi", AI_THEME_SCREENMASTER_ASSET_PATH],
        ["/themes/s/tf-fire.cba", AI_THEME_ANIMATION_ASSET_PATH],
      ]) {
        assets[newPath] = assets[oldPath];
        delete assets[oldPath];
        spec.primitives.forEach((p) => {
          if (p.assetPath === oldPath) p.assetPath = newPath;
        });
      }
      const next = {
        spec,
        assets,
        packName: "Token Fire · sample",
        usage: "live" as const,
      };
      setAIAnimationSpeed(next, AI_THEME_ANIMATION_ASSET_PATH, 4);
      if (validateThemeSpec(spec, assets).errors.length)
        throw new Error("Invalid sample");
      requestLoad({ document: next });
      setStatus(
        "Built-in example loaded — no AI request or charge. Click the flame to move it, or describe your changes below.",
      );
    } catch {
      setError("The built-in sample could not be loaded.");
    } finally {
      setLoadingSample(false);
      setBusy(false);
    }
  }
  function save() {
    if (validation.errors.length) {
      setError(validation.errors[0]);
      return;
    }
    const loaded = loadUserThemes();
    if (!loaded.ok) {
      setError(loaded.error.message);
      return;
    }
    const id = libraryId || crypto.randomUUID();
    const record = { id, document, updatedAt: new Date().toISOString() };
    const records = [record, ...loaded.value.themes.filter((t) => t.id !== id)];
    const result = writeUserThemes(records);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setLibrary(records);
    setLibraryId(id);
    dispatch({ type: "mark_saved" });
    setStatus("Saved in this browser.");
    setError("");
  }
  function download(data: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportPack() {
    try {
      const pack = buildThemePack(
        document.spec,
        document.packName,
        document.assets,
      );
      download(new Uint8Array(pack.zipBytes), pack.fileName, "application/zip");
      setStatus("Theme pack exported. No device was contacted.");
    } catch {
      setError(
        "This scene cannot be exported yet. Check its elements and assets.",
      );
    }
  }
  async function send() {
    if (locked || sendRequest.current || (!transferJob && (!document.spec.primitives.length || validation.errors.length))) return;
    let acceptedJob = transferJob;
    sendRequest.current = true;
    setSending(true);
    setError("");
    setTransferStatus("Sending…");
    try {
      setTransferStatus(await sendThemeToVibeTV(document, setTransferStatus, transferJob, (id) => {
        acceptedJob = id;
        setTransferJob(id);
        try {
          if (id) sessionStorage.setItem("vibetv.themeStudio.transferJob", id);
          else sessionStorage.removeItem("vibetv.themeStudio.transferJob");
        } catch { /* Keep the accepted job in memory when storage is unavailable. */ }
      }));
    } catch (error) {
      setTransferStatus(acceptedJob ? "Check the existing transfer before sending again." : "");
      setError(error instanceof Error ? error.message : "Theme transfer failed. Check the VibeTV Mac App.");
    } finally {
      sendRequest.current = false;
      setSending(false);
    }
  }
  async function importFile(file: File | undefined, sprite: boolean) {
    if (!file || locked) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Choose a file smaller than 8 MB.");
      return;
    }
    const version = documentVersion.current;
    try {
      if (sprite) {
        const imported = await importSpriteFile(file, "live", "image");
        if (request.current || sendRequest.current || version !== documentVersion.current) return;
        if (
          documentRef.current.spec.primitives.some((p) =>
            isAttachedSceneAnimation(p.assetPath),
          ) &&
          (imported.frameCount || 0) > 1
        ) {
          setError(
            "This scene already has movement. Describe your new idea in the AI input instead.",
          );
          return;
        }
        mutate((d) => {
          const assetPath = uniqueAssetPath(imported.assetPath, d.assets);
          d.assets[assetPath] = imported.asset;
          d.spec.primitives.push({
            type: "sprite",
            x: Math.max(0, Math.min(80, DISPLAY_SIZE - imported.width)),
            y: Math.max(0, Math.min(45, DISPLAY_SIZE - imported.height)),
            width: imported.width,
            height: imported.height,
            assetPath,
            frameCount: imported.frameCount,
            fps: imported.fps,
            sheetColumns: imported.sheetColumns,
          });
        });
        setSelected([documentRef.current.spec.primitives.length]);
      } else {
        const parsed = JSON.parse(await file.text()) as ThemeStudioDocument;
        if (request.current || sendRequest.current || version !== documentVersion.current) return;
        const spec = importThemeSpec(parsed.spec);
        const assets = parsed.assets || {};
        const valid = validateThemeSpec(spec, assets);
        if (valid.errors.length) throw new Error("Invalid theme");
        requestLoad({
          document: {
            spec,
            assets,
            packName:
              typeof parsed.packName === "string"
                ? parsed.packName
                : "Imported scene",
            usage: "live",
          },
        });
      }
    } catch {
      setError(
        "This file could not be imported. Choose a valid scene JSON or sprite image.",
      );
    }
  }
  async function attachImages(files: FileList | null) {
    if (!files?.length || locked || attaching) return;
    const version = documentVersion.current;
    setAttaching(true);
    setError("");
    try {
      if (attachments.length + files.length > 3) throw new Error("Add up to three reference images.");
      const images: { name: string; data: string }[] = [];
      for (const file of Array.from(files)) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPG or WebP image.");
        if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image smaller than 10 MB.");
        const bitmap = await createImageBitmap(file);
        const canvas = window.document.createElement("canvas");
        const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) { bitmap.close(); throw new Error("Could not read this image."); }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const data = canvas.toDataURL("image/png").split(",")[1];
        if (data.length > Math.ceil(2 * 1024 * 1024 * 4 / 3)) throw new Error("This image is too large. Choose a smaller image.");
        images.push({ name: file.name, data });
      }
      if (version === documentVersion.current) setAttachments((current) => [...current, ...images]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read this image.");
    } finally {
      setAttaching(false);
    }
  }

  async function connect() {
    const key = password.trim();
    if ((!key && configured !== "pending") || connecting || !consent) return;
    setPassword("");
    setConnecting(true);
    setConnectionError("");
    try {
      if (key) {
        await saveAIThemeCredential("openai", key);
        setConfigured("pending");
      }
      await verifyAIThemeCredential("openai");
      setConfigured(true);
      setStatus("AI is ready.");
      setPanel(null);
      if (panel === "setup" && prompt.trim()) await generate(true);
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : "Connection failed.");
      // A failed model check is not proof of a bad key. Keep it in helper
      // memory for a deliberate retry, without treating it as verified.
      const capabilities = await fetchAIThemeCapabilities().catch(() => null);
      if (capabilities) updateCapabilities(capabilities);
      else setConfigured(false);
    } finally {
      setConnecting(false);
    }
  }
  async function generate(connectedNow = false) {
    if (
      request.current ||
      locked ||
      loadingSample ||
      attaching ||
      (connecting && !connectedNow) ||
      !prompt.trim()
    )
      return;
    if (!connectedNow && !aiReady) {
      openPanel("setup");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setStatus(
      "AI is checking which parts of your design need to change.",
    );
    try {
      const capabilities = await fetchAIThemeCapabilities(controller.signal);
      if (
        !capabilities.providers.some((p) => p.id === "openai" && p.configured && !p.verificationRequired)
      ) {
        if (request.current !== controller || controller.signal.aborted) return;
        setConfigured(capabilities.providers.some((p) => p.id === "openai" && p.configured) ? "pending" : false);
        setStatus(
          "Reconnect your AI account to continue. Your design is unchanged.",
        );
        openPanel("setup");
        return;
      }
      const context = layoutContext(document, selected).map((item, i) => ({
        ...item,
        ...(item.role === "companion" ? {referenceImageBase64: spritePNG(document.assets[document.spec.primitives[i].assetPath!].data, false)} : {}),
      }));
      const layout = await planAIThemeLayout(prompt, context, controller.signal, attachments.map((image) => image.data));
      if (request.current !== controller || controller.signal.aborted) return;
      if (layout.mode === "unsupported") {
        setStatus("");
        setError(layout.notes);
        return;
      }
      if (layout.mode === "layout") {
        const next = applyAIThemeLayout(document, layout);
        pruneUnusedThemeAssets(next);
        const check = validateThemeSpec(next.spec, next.assets);
        if (check.errors.length) throw new Error(check.errors[0]);
        documentVersion.current++;
        dispatch({type:"update",document:next});
        setSelected([]);
        setPrompt("");
        setAttachments([]);
        setStatus("AI plan: " + layout.notes + " Preview the result; Undo takes you back.");
        return;
      }
      if (layout.mode !== "scene" || layout.edits.length) throw new Error("The AI edit plan is invalid. Your design is unchanged.");
      const concept = await generateAIThemeConcept(
        {
          prompt,
          referenceImages: attachments.map((image) => image.data),
          history: selected.length ? [{
            role: "user",
            createdAt: new Date().toISOString(),
            content: `The current request refers to these selected elements: ${selected.map((i) => {
              const p = document.spec.primitives[i];
              return `${i}: ${friendlyElementName(p, document.assets)} at (${p.x}, ${p.y})`;
            }).join("; ")}`.slice(0, 2000),
          }] : [],
          previous: conceptFromDocument(document),
          target: "companions",
        },
        controller.signal,
      );
      const candidate = await buildAIThemeCandidate(concept);
      if (request.current !== controller || controller.signal.aborted) return;
      const next = applyAIThemeCandidate(document, candidate, "auto");
      pruneUnusedThemeAssets(next);
      const check = validateThemeSpec(next.spec, next.assets);
      if (check.errors.length) throw new Error(check.errors[0]);
      documentVersion.current++;
      dispatch({ type: "update", document: next });
      setSelected([]);
      setPrompt("");
      setAttachments([]);
      setStatus("AI plan: " + concept.style.notes + " Preview the result; Undo takes you back.");
    } catch (e) {
      if (!controller.signal.aborted) {
        setStatus("");
        setError(
          e instanceof Error
            ? e.message
            : "Generation failed. Your design is unchanged.",
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setStatus(
      "Cancelled. Your scene is unchanged. OpenAI may still bill work already started.",
    );
  }

  useEffect(() => {
    const input = promptInput.current;
    if (!input || prompt || selected.length || locked) return;
    const ideas = [
      "A sleepy cat by a rainy window…",
      "A cozy fireplace in a pixel-art cabin…",
      "A tiny astronaut floating above the moon…",
      "A neon arcade with a playful robot…",
      "A fox resting in an autumn forest…",
      "A jellyfish drifting through a glowing ocean…",
    ];
    let idea = Math.floor(Math.random() * ideas.length);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      input.placeholder = ideas[idea];
      return;
    }
    let length = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    function type() {
      length += deleting ? -1 : 1;
      input!.placeholder = ideas[idea].slice(0, length) + "▏";
      let delay = deleting ? 25 : 55;
      if (length === ideas[idea].length) {
        deleting = true;
        delay = 2400;
      } else if (length === 0) {
        idea = (idea + 1 + Math.floor(Math.random() * (ideas.length - 1))) % ideas.length;
        deleting = false;
        delay = 350;
      }
      timer = setTimeout(type, delay);
    }
    type();
    return () => clearTimeout(timer);
  }, [prompt, selected.length, locked]);

  // Grow with the text, including programmatic prompt changes and window resizing.
  // Cap the height so a long request never pushes all editing controls off-screen.
  useEffect(() => {
    const textarea = promptInput.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 256) + "px";
    };
    resize();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth !== width) {
        width = textarea.clientWidth;
        resize();
      }
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [prompt]);

  function openPanel(next: typeof panel) {
    dialogTrigger.current = window.document.activeElement as HTMLElement;
    setPassword("");
    setConnectionError("");
    setPanel(next);
    if (next === "settings") {
      void fetchAIThemeCapabilities().then(updateCapabilities)
        .catch(() => setConnectionError("Could not check the AI connection."));
    }
  }
  function updateConsent(value: boolean) {
    setConsent(value);
    try {
      if (value) sessionStorage.setItem("vibetv.aiTheme.consent", "1");
      else sessionStorage.removeItem("vibetv.aiTheme.consent");
    } catch {
      /* Never store a key or block editing on browser storage. */
    }
  }
  function closePanel() {
    if (connecting) return;
    setPassword("");
    setConnectionError("");
    setPanel(null);
  }
  function selectOnCanvas(indices: number[]) {
    setSelected(indices);
    dialogTrigger.current = window.document.getElementById("theme-design-canvas");
    setPanel(null);
  }
  function addElement(type: AddElementKind) {
    mutate((d) => {
      d.spec.primitives.push(createDesignElement(type, d.spec.primitives.length));
    });
    selectOnCanvas([document.spec.primitives.length]);
    setStatus("Element added. Select it on the display to make it yours.");
  }
  return (
    <div
      className="h-dvh overflow-y-auto [scrollbar-gutter:stable] bg-background p-3 text-foreground sm:p-6"
      onKeyDown={(event) => {
        if (isTypingTarget(event.target) || locked || panel || pending || event.nativeEvent.isComposing)
          return;
        const command = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        if (
          command && (key === "z" || key === "y")
        ) {
          event.preventDefault();
          history(key === "y" || event.shiftKey ? "redo" : "undo");
        } else if (command && key === "s") {
          event.preventDefault();
          if (document.spec.primitives.length && !validation.errors.length) save();
        } else if (!panel && event.target instanceof Element && event.target.closest("#theme-design-canvas")) {
          if (event.key === "Escape") { event.preventDefault(); setSelected([]); return; }
          if (command && key === "a") {
            event.preventDefault();
            setSelected(document.spec.primitives.flatMap((p, i) => pinnedElement(p, document.spec.primitives) ? [] : [i]));
            return;
          }
          if (!selected.length || command || event.altKey) return;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          if (moves[event.key]) {
            event.preventDefault();
            const [x, y] = moves[event.key];
            nudge(x * (event.shiftKey ? 10 : 1), y * (event.shiftKey ? 10 : 1));
          }
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            remove();
          }
        }
      }}
    >
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <ControlCenterBrand showTagline={false} />
          <h1 className="text-sm font-medium">Theme Studio</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              title="Settings"
              aria-label="Settings"
              disabled={locked}
              onClick={() => openPanel("settings")}
            >
              <Settings />
            </Button>
            <Button
              variant="outline"
              disabled={locked || !document.spec.primitives.length || validation.errors.length > 0}
              onClick={save}
            >
              Save
            </Button>
            <Button disabled={locked || (!transferJob && (!document.spec.primitives.length || validation.errors.length > 0))} onClick={() => void send()}>
              {sending ? <Spinner /> : null}
              {sending ? "Sending…" : transferJob ? "Check transfer" : "Send to VibeTV"}
            </Button>
          </div>
        </header>
        {transferStatus ? <p role="status" className="px-6 pt-3 text-right text-sm text-muted-foreground">{transferStatus}</p> : null}
          <main className="px-6 py-5">
            <div className="mx-auto mb-4 flex max-w-[680px] items-center justify-end gap-2">
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Undo · ⌘Z / Ctrl+Z"
                  aria-label="Undo last edit"
                  disabled={!state.past.length || locked}
                  onClick={() => history("undo")}
                >
                  <Undo2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Redo · ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y"
                  aria-label="Redo edit"
                  disabled={!state.future.length || locked}
                  onClick={() => history("redo")}
                >
                  <Redo2 />
                </Button>
              </div>
            </div>
            <div
              id="theme-design-canvas"
              role="region"
              aria-label="Design canvas"
              tabIndex={0}
              onPointerDownCapture={(event) => event.currentTarget.focus({ preventScroll: true })}
              className="mx-auto w-full max-w-[460px] overflow-hidden rounded-2xl border bg-muted p-3 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              inert={locked}
              aria-busy={busy}
            >
              <EditableThemePreview
                animate={locked ? false : undefined}
                nonInteractiveIndices={document.spec.primitives.flatMap(
                  (p, i) =>
                    isAttachedSceneAnimation(p.assetPath) ||
                    (p.assetPath === AI_THEME_SCREENMASTER_ASSET_PATH &&
                      document.spec.primitives.some((p) =>
                        isAttachedSceneAnimation(p.assetPath),
                      ))
                      ? [i]
                      : [],
                )}
                pack={pack}
                spec={document.spec}
                selectedIndex={index}
                selectedIndices={selected}
                elementLabels={document.spec.primitives.map((p) =>
                  friendlyElementName(p, document.assets),
                )}
                onSelect={(i, additive) =>
                  setSelected(
                    additive
                      ? selected.includes(i)
                        ? selected.filter((x) => x !== i)
                        : [...selected, i]
                      : [i],
                  )
                }
                onSelectMany={setSelected}
                onInteractionStart={() =>
                  dispatch({ type: "begin_transaction" })
                }
                onInteractionCancel={() =>
                  dispatch({ type: "cancel_transaction" })
                }
                onInteractionCommit={() =>
                  dispatch({ type: "commit_transaction" })
                }
                onMoveMany={(moves) =>
                  mutate((d) =>
                    moves.forEach((move) => {
                      const p = d.spec.primitives[move.index];
                      if (p) {
                        p.x = move.x;
                        p.y = move.y;
                      }
                    }),
                  )
                }
                onResize={(i, size) =>
                  mutate((d) => {
                    const p = d.spec.primitives[i];
                    if (p) {
                      const width = clampInt(size.width, 1, DISPLAY_SIZE - p.x);
                      const height = clampInt(
                        size.height,
                        1,
                        primitiveMaxBottom(p) - p.y,
                      );
                      if (p.type === "text") {
                        p.fontSize = clampInt(
                          textPrimitiveFontSizeFromVisualHeight(p, height),
                          1,
                          8,
                        );
                        p.width = Math.max(width, textPrimitiveNaturalWidth(p));
                      } else if (isAspectLockedPrimitive(p)) {
                        p.width = Math.min(width, height);
                        p.height = p.width;
                        normalizeCompanionPrimitive(p);
                      } else {
                        p.width = width;
                        p.height = height;
                      }
                    }
                  })
                }
              />
            </div>
            {!document.spec.primitives.length ? (
              <div className="mt-5 text-center">
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => void loadSample()}
                >
                  {loadingSample
                    ? "Opening example…"
                    : "Try an animated example"}
                </Button>
              </div>
            ) : null}
            <section className="mx-auto mt-6 flex w-full max-w-[680px] flex-col gap-3" aria-label="AI creation">
              <label
                htmlFor="ai-scene-request"
                className="sr-only"
              >
                Your idea
              </label>
              <div className="flex items-end gap-3">
              <div
                className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-input bg-background shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
                onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
                onDrop={(event) => { event.preventDefault(); void attachImages(event.dataTransfer.files); }}
              >
                {attachments.length > 0 ? (
                  <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attached reference images">
                    {attachments.map((image, i) => (
                      <Badge key={i} variant="secondary" className="gap-2 py-1 pr-1">
                        <span className="size-8 rounded-sm bg-cover bg-center" style={{ backgroundImage: `url(data:image/png;base64,${image.data})` }} role="img" aria-label={image.name} />
                        <span className="max-w-40 truncate">{image.name}</span>
                        <Button variant="ghost" size="icon" className="size-6" aria-label={`Remove attachment ${image.name}`} disabled={locked || attaching} onClick={() => setAttachments(attachments.filter((_, index) => index !== i))}>
                          <X className="size-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {selected.length > 0 ? (
                  <div id="ai-selection-context" className="flex flex-wrap gap-1 px-3 pt-3" aria-live="polite">
                    {selected.map((i) => (
                      <Badge key={i} variant="secondary" className="max-w-full gap-1 pr-0.5">
                        <span className="truncate">{friendlyElementName(document.spec.primitives[i], document.assets)}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          aria-label={`Remove reference to ${friendlyElementName(document.spec.primitives[i], document.assets)}`}
                          disabled={locked}
                          onClick={() => setSelected(selected.filter((item) => item !== i))}
                        >
                          <X className="size-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              <Textarea
                id="ai-scene-request"
                ref={promptInput}
                rows={1}
                value={prompt}
                aria-describedby={[selected.length ? "ai-selection-context" : "", error ? "ai-theme-error" : ""].filter(Boolean).join(" ") || undefined}
                maxLength={2000}
                disabled={locked}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.repeat) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey) {
                    const input = event.currentTarget;
                    const start = input.selectionStart;
                    const end = input.selectionEnd;
                    const next = prompt.slice(0, start) + "\n" + prompt.slice(end);
                    if (next.length > 2000) return;
                    setPrompt(next);
                    requestAnimationFrame(() => input.setSelectionRange(start + 1, start + 1));
                  } else if (!locked && enabled && !connecting && prompt.trim()) {
                    void generate();
                  }
                }}
                className="min-h-14 max-h-64 resize-none overflow-y-auto rounded-none border-0 py-4 pl-4 pr-14 focus-visible:ring-0 [field-sizing:fixed]"
                placeholder={selected.length ? "Describe what to change in this element…" : "Describe your design or what to change…"}
              />
                <Button
                  variant="ghost" size="icon" className="absolute bottom-2 right-2"
                  aria-label="Attach reference images" title="Attach images"
                  disabled={locked || attaching || attachments.length >= 3}
                  onClick={() => attachmentInput.current?.click()}
                >
                  {attaching ? <Spinner /> : <Paperclip />}
                </Button>
              </div>
              <Button
                className="h-14 shrink-0 px-6"
                aria-busy={busy}
                disabled={locked || attaching || !enabled || connecting || !prompt.trim()}
                onClick={() => void generate()}
              >
                {busy ? <Spinner className="motion-reduce:animate-none" /> : <Sparkles />}
                {busy ? "Creating…" : "Create"}
              </Button>
              </div>
              <Button
                variant="ghost"
                size={canCancel ? "default" : "icon"}
                className="self-start"
                aria-label={canCancel ? "Cancel" : "Add manually"}
                title={canCancel ? "Cancel" : "Add manually"}
                disabled={locked && !canCancel}
                onClick={canCancel ? cancel : () => openPanel("add")}
              >
                {canCancel ? "Cancel" : <Plus />}
              </Button>
            {primitive && !isAttachedSceneAnimation(primitive.assetPath) ? (
              <Collapsible className="w-full">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group w-full justify-between">
                    Details
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
              <section className="space-y-3" aria-label="Selected element tools">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="min-w-0 truncate font-medium">
                    {selected.length > 1 ? "Selected elements" : elementName}
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Deselect"
                    aria-label="Deselect element"
                    disabled={locked}
                    onClick={() => setSelected([])}
                  >
                    <X />
                  </Button>
                </div>
                <fieldset disabled={locked} className="space-y-4">
                  {selected.length === 1 &&
                  primitive.type === "text" &&
                  !primitive.binding &&
                  !primitive.text?.includes("{") ? (
                    <label className="grid gap-2 text-sm">
                      Your text
                      <Input
                        value={primitive.text || ""}
                        onChange={(e) => change("text", e.target.value)}
                      />
                    </label>
                  ) : null}
                  {selected.length === 1 && primitive.type === "text" && readingKey(primitive) ? (
                    <label className="grid gap-2 text-sm">
                      Live information to show
                      <select aria-label="Live information to show" className="h-11 w-full rounded-md border bg-background px-3" value={readingKey(primitive)}
                        onChange={(event) => mutate((d) => { const p = d.spec.primitives[index]; setReading(p, event.target.value); p.width = Math.min(DISPLAY_SIZE - p.x, textPrimitiveNaturalWidth(p)); })}>
                        {!LIVE_READINGS.some(([key]) => key === readingKey(primitive)) ? <option value={readingKey(primitive)}>Current reading</option> : null}
                        {LIVE_READINGS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {selected.length === 1 && resetWindow ? (
                    <label className="grid gap-2 text-sm">
                      Reset for
                      <select
                        aria-label="Reset for"
                        className="h-11 w-full rounded-md border bg-background px-3"
                        value={resetWindow}
                        onChange={(e) => {
                          const slot = e.target.value === "2" ? 2 : 1;
                          mutate((d) => {
                            const p = d.spec.primitives[index];
                            p.slot = slot;
                            const binding = `usageSlot${slot}Reset`;
                            if (p.binding) p.binding = binding;
                            else
                              p.text = p.text?.replace(
                                /\{usageSlot[12]Reset\}/g,
                                `{${binding}}`,
                              );
                          });
                        }}
                      >
                        <option value="1">First usage window</option>
                        <option value="2">Second usage window</option>
                      </select>
                    </label>
                  ) : null}
                  {selected.length === 1 && primitive.type === "text" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField
                        label="Text size"
                        value={primitive.fontSize || 2}
                        max={8}
                        onChange={(value) =>
                          change("fontSize", clampInt(value, 1, 8))
                        }
                      />
                      <ColorField
                        label="Color"
                        value={primitive.color || "#EEEEEE"}
                        onChange={(value) => change("color", value)}
                      />
                    </div>
                  ) : null}
                  {selected.length === 1 && primitive.type === "progress" ? (
                    <label className="grid gap-2 text-sm">
                      Reading to show
                      <select
                        aria-label="Reading to show"
                        className="h-11 rounded-md border bg-background px-3"
                        value={primitive.binding || "usageSlot1Percent"}
                        onChange={(e) => mutate((d) => {
                          const p = d.spec.primitives[index];
                          p.binding = e.target.value;
                          delete p.slot;
                          delete p.providerSlot;
                          delete p.usageIndex;
                          if (p.binding === "session" || p.binding === "usageSlot1Percent") p.slot = 1;
                          if (p.binding === "weekly" || p.binding === "usageSlot2Percent") p.slot = 2;
                        })}
                      >
                        <option value="usageSlot1Percent">
                          First usage window
                        </option>
                        <option value="usageSlot2Percent">
                          Second usage window
                        </option>
                        <option value="session">Session usage</option>
                        <option value="weekly">Weekly usage</option>
                        {!["usageSlot1Percent", "usageSlot2Percent", "session", "weekly"].includes(
                          primitive.binding || "",
                        ) ? (
                          <option value={primitive.binding}>
                            {primitive.binding === "session"
                              ? "Session usage"
                              : primitive.binding === "weekly"
                                ? "Weekly usage"
                                : "Current reading"}
                          </option>
                        ) : null}
                      </select>
                    </label>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex gap-1" aria-label="Position controls">
                      {[
                        [ArrowLeft, -2, 0, "left"],
                        [ArrowUp, 0, -2, "up"],
                        [ArrowDown, 0, 2, "down"],
                        [ArrowRight, 2, 0, "right"],
                      ].map(([Icon, x, y, label]) => {
                        const Symbol = Icon as typeof ArrowLeft;
                        return (
                          <Button
                            key={String(label)}
                            size="icon"
                            variant="outline"
                            title={"Move " + label}
                            aria-label={"Move " + label}
                            onClick={() => nudge(Number(x), Number(y))}
                          >
                            <Symbol />
                          </Button>
                        );
                      })}
                    </div>
                    <Button variant="ghost" onClick={remove}>
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                  {selected.length === 1 && primitive.type !== "text" ? (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="group w-full justify-between">
                          Size & appearance
                          <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="grid gap-4 pt-3">
                        {isAspectLockedPrimitive(primitive) ? (
                          <NumberField
                            label="Size"
                            value={primitive.width || 24}
                            max={COMPANION_MAX_SIZE}
                            onChange={(value) =>
                              mutate((d) => {
                                const p = d.spec.primitives[index];
                                if (!p) return;
                                p.width = clampCompanionSize(value);
                                p.height = p.width;
                                normalizeCompanionPrimitive(p);
                              })
                            }
                          />
                        ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <NumberField
                            label="Width"
                            value={primitive.width || 24}
                            max={240}
                            onChange={(value) =>
                              change("width", Math.max(1, Math.min(240, value)))
                            }
                          />
                          <NumberField
                            label="Height"
                            value={primitive.height || 24}
                            max={240}
                            onChange={(value) =>
                              change(
                                "height",
                                Math.max(1, Math.min(240, value)),
                              )
                            }
                          />
                        </div>
                        )}
                        {["rect", "progress"].includes(primitive.type) ? (
                          <ColorField
                            label="Color"
                            value={primitive.color || "#EEEEEE"}
                            onChange={(value) => change("color", value)}
                          />
                        ) : null}
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </fieldset>
              </section>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
            </section>
            <div className="space-y-3">
              {status && !busy ? (
                <p role="status" className="sr-only">
                  {status}
                </p>
              ) : null}
              {error ? (
                <p id="ai-theme-error" role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
                  {error}
                </p>
              ) : null}
              {document.spec.primitives.length > 0 &&
              validation.errors.length ? (
                <p role="alert" className="text-sm text-destructive">
                  This design needs an adjustment before saving.{" "}
                  {validation.errors[0]}
                </p>
              ) : null}
            </div>
          </main>
      </div>

      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
          showCloseButton={!connecting}
          onEscapeKeyDown={(event) => {
            if (connecting) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (connecting) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (dialogTrigger.current?.isConnected)
              dialogTrigger.current.focus();
            else promptInput.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {panel === "setup"
                ? "Create with AI"
                : panel === "settings"
                  ? "Settings"
                  : panel === "add"
                    ? "Add an element"
                    : panel === "library"
                      ? "Your saved designs"
                      : "Settings"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {panel === "setup"
                ? "Connect OpenAI to create your design."
                : panel === "settings"
                  ? "Manage your design and AI connection."
                  : panel === "add"
                    ? "Choose what you want to show. You can move and change it afterwards."
                    : panel === "library"
                      ? "Designs saved in this browser on this Mac."
                      : "Your design, saved files and other tools."}
            </DialogDescription>
          </DialogHeader>
          {panel === "setup" || panel === "settings" ? (
            <div className="space-y-4">
                <Collapsible open={panel === "setup" ? true : undefined}>
                  <CollapsibleTrigger asChild className={panel === "setup" ? "hidden" : undefined}>
                    <Button
                      variant="ghost"
                      className="group w-full justify-between"
                      disabled={!configured}
                      title={!configured ? "Connect OpenAI through Create with AI first" : undefined}
                    >
                      Change API key
                      <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-3">
                    {configured !== true || panel === "settings" ? (
                      <label className="grid gap-2 text-sm">
                        {configured ? "Replace OpenAI key" : "OpenAI key"}
                        <Input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={password}
                          disabled={!enabled || connecting}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={
                            configured
                              ? "Paste a new key to replace it"
                              : "Paste your key here"
                          }
                          aria-invalid={Boolean(connectionError)}
                          aria-describedby={connectionError ? "key-error" : undefined}
                        />
                      </label>
                    ) : null}
                    {panel === "setup" || !consent ? (
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
                          (panel === "settings" && configured === true && !password.trim()) ||
                          (!configured && !password.trim())
                        }
                        onClick={() => {
                          if (password.trim() || configured === "pending") void connect();
                          else {
                            setPanel(null);
                            if (panel === "setup") void generate(true);
                          }
                        }}
                      >
                        {connecting
                          ? "Checking…"
                          : configured === "pending" && !password.trim()
                            ? "Retry connection check"
                            : panel === "settings"
                              ? "Update key"
                              : configured === true && !password.trim()
                                ? "Continue"
                                : "Connect and continue"}
                      </Button>
                      {configured ? (
                        <Button
                          className="h-12 w-full"
                          variant="outline"
                          disabled={connecting}
                          onClick={() => {
                            setConnecting(true);
                            void deleteAIThemeCredential("openai")
                              .then(() => {
                                setConfigured(false);
                                updateConsent(false);
                                setPassword("");
                                setStatus(
                                  "OpenAI disconnected. You can keep editing by hand.",
                                );
                              })
                              .catch(() =>
                                setConnectionError(
                                  "Could not disconnect. Try again.",
                                ),
                              )
                              .finally(() => setConnecting(false));
                          }}
                        >
                          Disconnect OpenAI
                        </Button>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
            </div>
          ) : null}
          {panel === "add" ? (
            <div className="grid gap-2">
              {[
                {
                  icon: Type,
                  name: "Text",
                  description: "Add a name, message or short label.",
                  type: "text" as const,
                },
                {
                  icon: ChartNoAxesColumn,
                  name: "Usage bar",
                  description: "A bar that fills with your current usage.",
                  type: "progress" as const,
                },
                {
                  icon: TimerReset,
                  name: "Reset countdown",
                  description: "Show how long until a usage window resets.",
                  type: "reset" as const,
                },
                { icon: Type, name: "Session usage", description: "Your session percentage, updated automatically.", type: "session" as const },
                { icon: Type, name: "Weekly usage", description: "Your weekly percentage, updated automatically.", type: "weekly" as const },
                { icon: Type, name: "Usage direction", description: "Show whether usage is used or remaining.", type: "usageMode" as const },
                { icon: Type, name: "Other live information", description: "Usage window names, date, provider, account or tokens.", type: "reading" as const },
                {
                  icon: Square,
                  name: "Shape",
                  description: "A colored block for a frame or background.",
                  type: "rect" as const,
                },
                {
                  icon: Type,
                  name: "Clock",
                  description: "Show the time, updated automatically.",
                  type: "time" as const,
                },
              ].map(({ icon: Icon, name, description, type }) => (
                <Button
                  key={name}
                  variant="ghost"
                  className="h-auto min-h-16 justify-start gap-4 whitespace-normal py-3 text-left"
                  onClick={() => addElement(type)}
                >
                  <Icon className="size-5" />
                  <span>
                    <span className="block">{name}</span>
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </Button>
              ))}
              <Button
                variant="ghost"
                className="h-auto min-h-16 justify-start gap-4 whitespace-normal py-3 text-left"
                onClick={() => {
                  setPanel(null);
                  spriteInput.current?.click();
                }}
              >
                <ImagePlus className="size-5" />
                <span>
                  <span className="block">Image or animation</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Bring in your own image or a VibeTV animation.
                  </span>
                </span>
              </Button>
            </div>
          ) : null}
          {panel === "settings" ? (
            <div className="space-y-1">
              <div className="grid gap-1">
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    setPanel(null);
                    requestLoad({ document: blank() });
                  }}
                >
                  <Plus />
                  New design
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setPanel("library")}
                >
                  <FolderOpen />
                  Open saved design
                </Button>
              </div>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group w-full justify-between">
                    Rename design
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-3 pt-2">
                <label className="mt-2 grid gap-2 text-sm">
                  Name in your saved designs
                  <Input
                    value={document.packName}
                    maxLength={48}
                    onChange={(e) =>
                      mutate((d) => {
                        d.packName = e.target.value;
                      })
                    }
                  />
                </label>
              </CollapsibleContent>
              </Collapsible>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group w-full justify-between">
                    Import & export
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-3 pt-2">
                <div className="mt-2 grid gap-3">
                  <Button
                    variant="ghost"
                    disabled={!document.spec.primitives.length}
                    onClick={() =>
                      download(
                        JSON.stringify(document, null, 2),
                        "vibetv-scene.json",
                        "application/json",
                      )
                    }
                  >
                    Download editable design
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPanel(null);
                      jsonInput.current?.click();
                    }}
                  >
                    Open design file
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={
                      !document.spec.primitives.length ||
                      validation.errors.length > 0
                    }
                    onClick={exportPack}
                  >
                    <Download />
                    Export theme pack
                  </Button>
                </div>
              </CollapsibleContent>
              </Collapsible>
            </div>
          ) : null}
          {panel === "library" ? (
            <div className="grid gap-2">
              {library.length ? (
                library.map((t) => (
                  <Button
                    key={t.id}
                    variant="outline"
                    className="min-w-0 justify-start"
                    onClick={() => {
                      setPanel(null);
                      requestLoad({ document: t.document, id: t.id });
                    }}
                  >
                    <span className="truncate">{t.document.packName}</span>
                  </Button>
                ))
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  No saved designs yet.
                </p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <input
        ref={attachmentInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          void attachImages(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={spriteInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,.cbi,.cba"
        className="hidden"
        onChange={(e) => {
          void importFile(e.target.files?.[0], true);
          e.target.value = "";
        }}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void importFile(e.target.files?.[0], false);
          e.target.value = "";
        }}
      />
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keep your changes?</DialogTitle>
            <DialogDescription>
              This design has unsaved edits. Save it first, or discard them to
              continue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Button
              variant="outline"
              className="h-12 w-full"
              onClick={() => setPending(undefined)}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              className="h-12 w-full"
              onClick={() => {
                if (pending) load(pending);
              }}
            >
              Discard and continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
