"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BringToFront,
  Type,
  TimerReset,
  ChartNoAxesColumn,
  ChevronDown,
  ImagePlus,
  Paperclip,
  Square,
  SquarePlus,
  X,
  Redo2,
  SendToBack,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { ProcessSteps } from "../process-steps";
import { EditableThemePreview } from "./editable-theme-preview";
import { SetupDialog } from "../setup/setup-dialog";
import { OpenAIKeyForm, openAIState } from "./openai-key-form";
import { friendlyElementName } from "./theme-studio-customer-labels";
import { createDesignElement, isTypingTarget, LIVE_READINGS, moveLayer, pinnedElement, readingKey, setReading, usageSectionIndices, type AddElementKind } from "./design-controls";
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
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  validateThemeSpec,
} from "@/lib/theme-studio";
import { importSpriteFile, uniqueAssetPath } from "@/lib/theme-studio-assets";
import {
  loadUserThemes,
  clearThemeStudioRecovery,
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
  AI_THEME_ANIMATION_ASSET_PATH,
  AI_THEME_LOCAL_HISTORY_LIMIT,
  AI_THEME_SCREENMASTER_ASSET_PATH,
  AI_THEME_TRANSMITTED_HISTORY_LIMIT,
  isAttachedSceneAnimation,
  hasMovingCompanion,
  isCompanionSprite,
  type AIThemeMessage,
} from "@/lib/ai-theme";
import {
  applyAIThemeCandidate,
  pruneUnusedThemeAssets,
  adoptPicture,
  conceptFromDocument,
  setAIAnimationSpeed,
  spritePNG,
} from "@/lib/ai-theme-document";
import {applyAIThemeLayout,layoutContext} from "@/lib/ai-theme-layout";
import type { ThemeStudioScreenProps } from "../theme-studio-screen";
import { isNativeControlCenterApp, onNativeDownloadFinished, themeRenderPackUrl } from "../control-center-runtime";
import { copyForHost } from "@/lib/customer-platform";
import { validateThemeAgainstCapabilities } from "@/lib/theme-studio-capabilities";
import { buildDeviceThemePack, sendThemeToVibeTV } from "@/lib/theme-install";

function blank(): ThemeStudioDocument {
  return {
    assets: {},
    packName: "My design",
    spec: { ...createBlankThemeSpec(), primitives: [] },
    usage: "live",
  };
}

// The planner sees the actual scene palette and negative space, not just its name.
function planningContext(document: ThemeStudioDocument, selected: number[] = []) {
  return layoutContext(document, selected).map((item, index) => ({
    ...item,
    ...(["companion", "artwork"].includes(item.role) && document.assets[document.spec.primitives[index].assetPath!]
      ? { referenceImageBase64: spritePNG(document.assets[document.spec.primitives[index].assetPath!].data, false) }
      : {}),
  }));
}

// A reference image while it waits in the composer or in the request: the full
// picture for the AI, and a small thumbnail for the bubble once the turn is kept.
type ReferenceImage = { name: string; data: string; thumb: string };
const REFERENCE_THUMBNAIL_PX = 96;

// The small picture a finished turn keeps, at most 96 px on its long side.
function referenceThumbnail(source: HTMLCanvasElement) {
  const scale = Math.min(1, REFERENCE_THUMBNAIL_PX / Math.max(source.width, source.height));
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read this image.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1];
}

// The customer's turn: its reference images as small thumbnails inside the same bubble, left of the text.
function userTurn(text: string | null, images: { name: string; data: string }[] = []) {
  return (
    <div className="ml-auto flex w-fit max-w-[88%] items-center gap-2.5 rounded-xl bg-muted px-3 py-2">
      {images.map((image, i) => (
        <span key={i} role="img" aria-label={image.name} title={image.name} className="size-8 shrink-0 rounded-md bg-cover bg-center" style={{ backgroundImage: `url(data:image/png;base64,${image.data})` }} />
      ))}
      <p className="min-w-0 whitespace-pre-wrap text-[13px] [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

// The status line while the AI works. Words only rotate inside the real step
// they belong to, so a word never runs ahead of what the AI is doing.
const PLANNING_WORDS = ["Understanding your idea…", "Sketching a plan…", "Picking a palette…"];
const DRAWING_WORDS = (animated: boolean) => [
  "Getting the paint ready…",
  "Mixing the colors…",
  "Drawing the picture…",
  "Placing every pixel…",
  ...(animated ? ["Teaching it to move…"] : []),
  "Checking the light…",
  "Letting the paint dry…",
  "Cleaning the brushes…",
];
const FITTING_WORDS = ["Adding clock and readings…", "Fitting it to your VibeTV…", "Polishing the details…", "Taking one last look…"];

export function AIThemeStudioScreen({
  initialTheme, onBackToLibrary, onSaveToLibrary, onInstallTheme,
  installStatus, deviceCapabilities, saveBlockedReason, windowsHost = false,
}: ThemeStudioScreenProps = {}) {
  const [state, dispatch] = useReducer(
    themeStudioEditorReducer,
    undefined,
    () => createThemeStudioEditorState(initialTheme ? {
      assets: initialTheme.assets || {}, packName: initialTheme.packName,
      spec: initialTheme.spec, usage: initialTheme.usage || "live",
    } : blank()),
  );
  const nativeInstall = Boolean(onInstallTheme);
  const document = state.present;
  const dirty = isThemeStudioDirty(state);
  const visibleInstallStatus = installStatus?.themeId === document.spec.themeId ? installStatus : null;
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
  const [panel, setPanel] = useState<"setup" | "add" | "library" | null>(null);
  const [fileMenu, setFileMenu] = useState(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [prompt, setPrompt] = useState("");
  // The conversation lives with the open editor: it gives the AI the context
  // of earlier turns and is not part of the saved design.
  const [messages, setMessages] = useState<AIThemeMessage[]>([]);
  // The request the AI is working on: shown as the customer's message right
  // away, and added to the conversation for good once it has an answer.
  const [asking, setAsking] = useState<string | null>(null);
  // The reference images of the request in progress, shown in its bubble.
  const [askingImages, setAskingImages] = useState<ReferenceImage[]>([]);
  // One status line shows the words of the step the AI is in; `at` counts the
  // swaps so each word flies in again.
  const [progress, setProgress] = useState<{ words: string[]; at: number }>({ words: [], at: 0 });
  useEffect(() => {
    if (!progress.words.length) return;
    const timer = window.setInterval(() => setProgress((p) => ({ ...p, at: p.at + 1 })), 2500);
    return () => window.clearInterval(timer);
  }, [progress.words]);
  function progressTo(words: string[]) {
    setProgress({ words, at: 0 });
  }
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, asking]);
  const [attachments, setAttachments] = useState<ReferenceImage[]>([]);
  const [attaching, setAttaching] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState<boolean | "pending">(false);
  // Bumped by every stored-key change: a capability read that started before it is stale and must not write back (#847).
  const keyGeneration = useRef(0);
  function changeConfigured(value: boolean | "pending") {
    keyGeneration.current += 1;
    setConfigured(value);
  }
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");
  const [transferJob, setTransferJob] = useState<string | null>(null);
  const sendRequest = useRef(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // The Mac App asks where to save, and the customer can cancel: an export is
  // confirmed only once it says the file was saved (#582).
  const [exporting, setExporting] = useState("");
  useEffect(() => {
    if (!exporting) return;
    return onNativeDownloadFinished(exporting, (saved) => {
      setExporting("");
      if (saved) setStatus("Theme pack exported. No device was contacted.");
    });
  }, [exporting]);
  const [library, setLibrary] = useState<UserThemeRecord[]>([]);
  const savedDesigns = initialTheme ? library.filter((theme) => (theme.document.usage || "live") === (initialTheme.usage || "live")) : library;
  const [libraryId, setLibraryId] = useState(initialTheme?.libraryId);
  const source = useRef(initialTheme?.source || "blank");
  const [saving, setSaving] = useState(false);
  const savingRequest = useRef(false);
  const [pending, setPending] = useState<{
    document: ThemeStudioDocument;
    id?: string;
  }>();
  // Leaving is only safe once the latest edits are stored as a draft.
  const [leaving, setLeaving] = useState(false);
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
  const locked = busy || sending || saving || installStatus?.phase === "installing";
  const canCancel = busy && !loadingSample;
  // Every notice of the editor (saved, exported, sent, cancelled) shows in one
  // place, right in the header row left of Save, not in the chat column.
  const notices = [visibleInstallStatus ? copyForHost(visibleInstallStatus.error || visibleInstallStatus.message || "Sending…", windowsHost) : transferStatus, busy ? "" : status].filter(Boolean);
  // Connecting needs the consent box ticked, so a saved key is that consent
  // (#633); Disconnect removes both.
  const aiReady = configured === true;
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
  const validation = useMemo(() => {
    const result = validateThemeSpec(document.spec, document.assets, document.usage);
    // VibeTV draws one animation at a time: where two overlap, each new frame
    // of one wipes the other. That holds for imported animations as well.
    const figures = document.spec.primitives.filter((p) => p.type === "gif" || (p.type === "sprite" && /\.cba$/i.test(p.assetPath || "")));
    const overlap = figures.some((a, i) => figures.slice(i + 1).some((b) =>
      a.x < b.x + (b.width || 0) && b.x < a.x + (a.width || 0) && a.y < b.y + (b.height || 0) && b.y < a.y + (a.height || 0)));
    return overlap ? { ...result, errors: [...result.errors, "Move the animated elements apart. VibeTV cannot show them overlapping."] } : result;
  }, [document]);
  // Send is off for a design the customer can fix (#551): the reason is the
  // first validation sentence, the same one the alert in the chat shows. Busy,
  // saving and sending are passing states and give no reason.
  const sendNeedsFix = !transferJob && (!document.spec.primitives.length || validation.errors.length > 0);
  const sendBlockedReason = !locked && sendNeedsFix ? validation.errors[0] ?? "" : "";

  useEffect(() => {
    const controller = new AbortController();
    const generation = keyGeneration.current;
    void fetchAIThemeCapabilities(controller.signal)
      .then((capabilities) => {
        const state = openAIState(capabilities);
        setEnabled(state.enabled);
        if (generation === keyGeneration.current) setConfigured(state.configured);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    const hydration = window.setTimeout(() => {
      try {
        if (!nativeInstall) setTransferJob(sessionStorage.getItem("vibetv.themeStudio.transferJob"));
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
      if (initialTheme?.recovered && !dirtyRef.current) {
        const savedDocument = loaded.ok ? loaded.value.themes.find((theme) => theme.id === initialTheme.libraryId)?.document : undefined;
        dispatch({ type: "load", document: documentRef.current, savedDocument: savedDocument || blank() });
      }
      if (!initialTheme && saved && !dirtyRef.current) {
        documentVersion.current++;
        const baseline = restored ? (loaded.ok ? loaded.value.themes.find((theme) => theme.id === restored.libraryId)?.document : undefined) || blank() : undefined;
        dispatch({ type: "load", document: saved.document, savedDocument: baseline });
        setLibraryId(restored ? restored.libraryId : latest?.id);
        source.current = restored?.source || "custom";
      }
      setRecoveryReady(recovery.ok);
    }, 0);
    return () => {
      window.clearTimeout(hydration);
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, [initialTheme, nativeInstall]);
  useEffect(() => {
    if (!recoveryReady || state.transactionBase) return;
    if (nativeInstall && !dirty) return;
    const result = writeThemeStudioRecovery({
      document,
      libraryId,
      source: source.current,
      updatedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      const timer = window.setTimeout(() => setError(result.error.message), 0);
      return () => window.clearTimeout(timer);
    }
    persistedDraft.current = document;
  }, [document, libraryId, recoveryReady, state.transactionBase, dirty, nativeInstall]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (persistedDraft.current === document) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const persist = () => writeThemeStudioRecovery({ document, libraryId, source: source.current, updatedAt: new Date().toISOString() });
    window.addEventListener("beforeunload", guard);
    window.addEventListener("vibetv:native-window-will-close", persist);
    return () => {
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("vibetv:native-window-will-close", persist);
    };
  }, [dirty, document, libraryId]);

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
          // Longer text widens its box, but never past the display edge.
          p.width = Math.min(DISPLAY_SIZE - p.x, Math.max(p.width || 0, textPrimitiveNaturalWidth(p)));
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
    setError("");
    setStatus(type === "undo" ? "Last edit undone." : "Edit restored.");
  }
  function load(next: { document: ThemeStudioDocument; id?: string }) {
    documentVersion.current++;
    dispatch({ type: "load", document: initialTheme ? { ...next.document, usage: initialTheme.usage || "live" } : next.document });
    setLibraryId(next.id);
    source.current = next.id ? "custom" : "blank";
    setSelected([]);
    setPrompt("");
    setAttachments([]);
    setPending(undefined);
    setError("");
    setMessages([]);
    setTransferStatus("");
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
      const response = await fetch(themeRenderPackUrl("token-fire"));
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
        usage: document.usage || "live",
      };
      setAIAnimationSpeed(next, AI_THEME_ANIMATION_ASSET_PATH, 4);
      if (validateThemeSpec(spec, assets, next.usage).errors.length)
        throw new Error("Invalid sample");
      requestLoad({ document: next });
    } catch {
      setError("The built-in sample could not be loaded.");
    } finally {
      setLoadingSample(false);
      setBusy(false);
    }
  }
  async function save() {
    if (savingRequest.current || locked) return;
    if (saveBlockedReason) { setError(saveBlockedReason); return; }
    if (validation.errors.length) {
      setError(validation.errors[0]);
      return;
    }
    if (onSaveToLibrary) {
      savingRequest.current = true;
      setSaving(true);
      try {
        const saved = await onSaveToLibrary({ ...document, libraryId, source: source.current });
        setLibraryId(saved.libraryId);
        source.current = "custom";
        const loaded = loadUserThemes();
        if (loaded.ok) setLibrary(loaded.value.themes);
        dispatch({ type: "mark_saved", document: saved.document });
        setStatus("Saved.");
        setError("");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not save this design.");
      } finally {
        savingRequest.current = false;
        setSaving(false);
      }
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
    source.current = "custom";
    setStatus("Saved.");
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
      const pack = buildDeviceThemePack(document);
      download(new Uint8Array(pack.zipBytes), pack.fileName, "application/zip");
      if (isNativeControlCenterApp() && !windowsHost) {
        setStatus("");
        setExporting(pack.fileName);
      } else setStatus(windowsHost ? "Saved in your Downloads folder. Nothing was sent." : "Theme pack exported. No device was contacted.");
    } catch {
      setError(
        "This scene cannot be exported yet. Check its elements and assets.",
      );
    }
  }
  async function send() {
    if (locked || sendRequest.current || (!transferJob && (!document.spec.primitives.length || validation.errors.length))) return;
    if (deviceCapabilities) {
      const check = validateThemeAgainstCapabilities(document.spec, document.assets, deviceCapabilities);
      if (check.errors.length) { setError(check.errors[0]); return; }
    }
    let acceptedJob = transferJob;
    sendRequest.current = true;
    setSending(true);
    setError("");
    setTransferStatus("Sending…");
    try {
      if (onInstallTheme) {
        const installed = await onInstallTheme(document);
        setTransferStatus(installed ? "Theme sent to VibeTV." : "Check the transfer status.");
        return;
      }
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
      setError(error instanceof Error ? error.message : copyForHost("Theme transfer failed. Check the VibeTV Mac App.", windowsHost));
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
        const imported = await importSpriteFile(file, document.usage || "live", "image");
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
        const usage = initialTheme ? initialTheme.usage || "live" : parsed.usage === "screensaver" ? "screensaver" : "live";
        const valid = validateThemeSpec(spec, assets, usage);
        if (valid.errors.length) throw new Error("Invalid theme");
        requestLoad({
          document: {
            spec,
            assets,
            packName:
              typeof parsed.packName === "string"
                ? parsed.packName
                : "Imported scene",
            usage,
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
      const images: ReferenceImage[] = [];
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
        images.push({ name: file.name, data, thumb: referenceThumbnail(canvas) });
      }
      if (version === documentVersion.current) setAttachments((current) => [...current, ...images]);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not read this image.");
    } finally {
      setAttaching(false);
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
    setStatus("");
    const history = messages;
    // A turn enters the conversation once it has an answer, so a failed or
    // cancelled request is not shown twice and not sent as an earlier turn.
    const asked = prompt;
    // The images leave the composer with the request; they come back only if it fails.
    const images = attachments;
    setAttachments([]);
    setAskingImages(images);
    setAsking(asked);
    let replied = false;
    progressTo(PLANNING_WORDS);
    const reply = (content: string) => {
      replied = true;
      // The finished turn keeps only the thumbnails; the full pictures went with the request.
      const shown = images.map(({ name, thumb }) => ({ name, data: thumb }));
      setMessages((all) => [...all, ...([["user", asked], ["assistant", content]] as const).map(([role, text]) => ({ role, content: text.slice(0, 2000), createdAt: new Date().toISOString(), ...(role === "user" && shown.length ? { images: shown } : {}) }))].slice(-AI_THEME_LOCAL_HISTORY_LIMIT));
    };
    try {
      const generation = keyGeneration.current;
      const capabilities = await fetchAIThemeCapabilities(controller.signal);
      if (
        !capabilities.providers.some((p) => p.id === "openai" && p.configured && !p.verificationRequired)
      ) {
        if (request.current !== controller || controller.signal.aborted) return;
        if (generation === keyGeneration.current) changeConfigured(capabilities.providers.some((p) => p.id === "openai" && p.configured) ? "pending" : false);
        setStatus(
          "Reconnect your AI account to continue. Your design is unchanged.",
        );
        openPanel("setup");
        return;
      }
      // The picture of an imported or older design is the design's picture
      // for the helper too, so it can be redrawn like a generated one.
      const base = adoptPicture(document, selected);
      const context = planningContext(base, selected);
      const layout = await planAIThemeLayout(prompt, context, controller.signal, images.map((image) => image.data), history);
      if (request.current !== controller || controller.signal.aborted) return;
      if (layout.mode === "unsupported" || layout.mode === "answer") {
        reply(layout.notes);
        setPrompt("");
        return;
      }
      if (layout.mode === "layout") {
        const next = applyAIThemeLayout(base, layout);
        pruneUnusedThemeAssets(next);
        const check = validateThemeSpec(next.spec, next.assets, next.usage);
        if (check.errors.length) throw new Error(check.errors[0]);
        documentVersion.current++;
        dispatch({type:"update",document:next});
        setSelected([]);
        setPrompt("");
        reply(layout.notes);
        return;
      }
      if (layout.mode !== "scene" || layout.edits.length) throw new Error("The AI edit plan is invalid. Your design is unchanged.");
      // One picture per design is redrawn; a second, selected image stays.
      if (selected.some((i) => {
        const path = base.spec.primitives[i]?.assetPath;
        return path && path !== AI_THEME_SCREENMASTER_ASSET_PATH && !isCompanionSprite(path) && !isAttachedSceneAnimation(path) && path !== AI_THEME_ANIMATION_ASSET_PATH;
      })) {
        reply("I can redraw the main picture of this design, not a second image beside it. Select the main picture or nothing and ask again; the selected image stays as it is.");
        setPrompt("");
        return;
      }
      // Only a companion that moves earns the motion word (Codex review of #638).
      progressTo(DRAWING_WORDS(hasMovingCompanion(base.spec.primitives)));
      const concept = await generateAIThemeConcept(
        {
          prompt,
          referenceImages: images.map((image) => image.data),
          history: [...history.slice(selected.length ? 1 - AI_THEME_TRANSMITTED_HISTORY_LIMIT : -AI_THEME_TRANSMITTED_HISTORY_LIMIT), ...(selected.length ? [{
            role: "user" as const,
            createdAt: new Date().toISOString(),
            content: `The current request refers to these selected elements: ${selected.map((i) => {
              const p = base.spec.primitives[i];
              return `${i}: ${friendlyElementName(p, base.assets)} at (${p.x}, ${p.y})`;
            }).join("; ")}`.slice(0, 2000),
          }] : [])],
          previous: conceptFromDocument(base),
          target: "companions",
          usage: base.usage || "live",
        },
        controller.signal,
      );
      // A companion this request creates is known only now, so the motion word
      // is chosen again for the sprite build (Codex review of #638).
      progressTo(DRAWING_WORDS((concept.companions ?? []).some((p) => p.fps > 0)));
      const candidate = await buildAIThemeCandidate(concept);
      if (request.current !== controller || controller.signal.aborted) return;
      let next = applyAIThemeCandidate(base, candidate, "auto");
      pruneUnusedThemeAssets(next);
      const check = validateThemeSpec(next.spec, next.assets, next.usage);
      if (check.errors.length) throw new Error(check.errors[0]);
      // The scene step draws the picture and its figures only. A clock, a text
      // or a bar asked for in the same request is added in a second, native
      // step; if that fails the picture still stands.
      let added = "";
      try {
        progressTo(FITTING_WORDS);
        const extras = await planAIThemeLayout(
          "The picture for the following request has just been created and is already in the design. Now add or change ONLY the native elements this request asks for (text, clock, date, usage readings, bars, shapes), placed where the request says. Do not describe or change the picture. For a live theme that shows usage, also harmonize its readouts with the supplied artwork: cohesive colours, compact readable typography, appropriate bar treatment and calm placement clear of the subjects. Keep at least one live percentage, meter or reset unless the customer explicitly requested no readings. For screensavers or explicitly readout-free designs, add only what was requested. Request: " + prompt,
          planningContext(next), controller.signal, [], history,
        );
        if (request.current !== controller || controller.signal.aborted) return;
        if (extras.mode === "layout" && extras.edits.length) {
          const withExtras = applyAIThemeLayout(next, extras);
          if ((!concept.showUsage || usageSectionIndices(withExtras.spec.primitives).flat().length > 0) && !validateThemeSpec(withExtras.spec, withExtras.assets, withExtras.usage).errors.length) {
            next = withExtras;
            added = " " + extras.notes;
          }
        }
      } catch {
        if (request.current !== controller || controller.signal.aborted) return;
      }
      documentVersion.current++;
      dispatch({ type: "update", document: next });
      setSelected([]);
      setPrompt("");
      reply(concept.style.notes + added);
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
      // Only the request that still owns the editor puts its images back; a
      // cancelled one has already handed them back in cancel().
      if (request.current === controller) {
        if (!replied) setAttachments(images);
        setAskingImages([]);
        request.current = null;
        setBusy(false);
        setAsking(null);
        progressTo([]);
      }
    }
  }
  function cancel() {
    request.current?.abort();
    request.current = null;
    setAttachments(askingImages);
    setAskingImages([]);
    setBusy(false);
    setAsking(null);
    progressTo([]);
    setStatus(
      "Cancelled. Your scene is unchanged. OpenAI may still bill work already started.",
    );
  }

  useEffect(() => {
    const input = promptInput.current;
    if (!input) return;
    // The ideas are for an empty studio; once there is a conversation the field says what it is for (master 19.10.).
    if (messages.length || asking !== null) {
      input.placeholder = selected.length ? "Describe what to change in this element…" : "Describe your design or what to change…";
      return;
    }
    if (prompt || selected.length || locked) return;
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
  }, [prompt, selected.length, locked, messages.length, asking]);

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
    setPanel(next);
  }
  function closePanel() {
    if (connecting) return;
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
      data-theme-studio-root
      className="flex min-h-[calc(100svh-86px)] h-[calc(100svh-86px)] flex-col pb-6 text-foreground"
      onKeyDown={(event) => {
        if (isTypingTarget(event.target) || locked || panel || pending || leaving || event.nativeEvent.isComposing)
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
        } else if (!panel && event.target instanceof Element && event.target.closest("#theme-design-canvas") && !event.target.closest("[data-selection-controls]")) {
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
        <header className="flex min-h-10 flex-wrap items-center gap-x-1 gap-y-2 min-[960px]:flex-nowrap">
          {onBackToLibrary ? <Button variant="ghost" size="icon" className="-ml-2 size-9" aria-label="Back to library" title="Back to library" disabled={locked} onClick={() => { if (dirty && persistedDraft.current !== document) setLeaving(true); else onBackToLibrary(); }}><ArrowLeft className="size-5" /></Button> : null}
          <h2 className="sr-only">{document.usage === "screensaver" ? "Screensaver Studio" : "Theme Studio"}</h2>
          {/* The box is as wide as the name (as drawn in the template); the input lies over the hidden copy of its text. */}
          <div className="-ml-[5px] mr-[7px] inline-grid min-w-24 max-w-[20rem] shrink">
            <span aria-hidden className="invisible col-start-1 row-start-1 h-10 overflow-hidden whitespace-pre border px-2 text-[28px] leading-none font-semibold">{document.packName || " "}</span>
            <Input
              aria-label="Design name"
              title={document.packName || "Design name"}
              className="col-start-1 row-start-1 h-10 w-0 min-w-full text-ellipsis border-transparent bg-transparent px-2 text-[28px] leading-none font-semibold md:text-[28px] shadow-none hover:border-input focus-visible:border-ring"
              value={document.packName}
              maxLength={48}
              disabled={locked}
              onChange={(e) =>
                mutate((d) => {
                  d.packName = e.target.value;
                })
              }
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Popover open={fileMenu} onOpenChange={setFileMenu}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="h-9 gap-1.5 px-2.5 text-[13px] font-semibold" disabled={locked}>
                  File
                  <ChevronDown className="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={6} className="w-64 p-1.5">
                <div className="flex flex-col" onClick={() => setFileMenu(false)}>
                  <Button size="sm" variant="ghost" className="w-full justify-start font-normal" onClick={() => requestLoad({ document: blank() })}>
                    New design
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full justify-start font-normal" onClick={() => openPanel("library")}>
                    Open saved design…
                  </Button>
                  <div aria-hidden className="mx-1 my-1.5 h-px bg-border" />
                  <Button size="sm" variant="ghost" className="w-full justify-start font-normal" onClick={() => jsonInput.current?.click()}>
                    Open design file…
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full justify-start font-normal" disabled={!document.spec.primitives.length} onClick={() => download(JSON.stringify(document, null, 2), "vibetv-scene.json", "application/json")}>
                    Download editable design
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full justify-start font-normal" disabled={!document.spec.primitives.length || validation.errors.length > 0} onClick={exportPack}>
                    Export theme pack
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
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
              className="size-9"
              title="Redo · ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y"
              aria-label="Redo edit"
              disabled={!state.future.length || locked}
              onClick={() => history("redo")}
            >
              <Redo2 />
            </Button>
          </div>
          {notices.length || sendBlockedReason ? (
            <div className="ml-auto mr-3 flex min-w-40 max-w-[14rem] flex-[0_1_auto] flex-col items-end gap-0.5 text-right">
              {notices.map((text, i) => <p key={i} role="status" className="text-[13px] font-normal text-muted-foreground [overflow-wrap:break-word]">{text}</p>)}
              {sendBlockedReason ? <p id="send-blocked-reason" role="status" className="text-[13px] font-normal text-muted-foreground [overflow-wrap:break-word]">{sendBlockedReason}</p> : null}
            </div>
          ) : null}
          <div className={`${notices.length || sendBlockedReason ? "" : "ml-auto "}flex shrink-0 items-center gap-2`}>
            <Button
              variant="outline"
              className="h-9 px-3.5 text-[13px]"
              disabled={locked || Boolean(saveBlockedReason) || !document.spec.primitives.length || validation.errors.length > 0}
              title={saveBlockedReason}
              onClick={() => void save()}
            >
              Save
            </Button>
            {/* A disabled button takes no pointer events, so the tooltip sits on this wrapper. */}
            <span title={sendBlockedReason || undefined} className="inline-flex">
              <Button className="h-9 min-w-36 px-3.5 text-[13px]" disabled={locked || sendNeedsFix} aria-describedby={sendBlockedReason ? "send-blocked-reason" : undefined} onClick={() => void send()}>
                {sending ? <Spinner /> : null}
                {sending ? "Sending…" : transferJob ? "Check transfer" : "Send to VibeTV"}
              </Button>
            </span>
          </div>
        </header>
          {/* The composer sits on the bottom edge of the window at every height; the preview keeps the template's position (see the spacer row in the workspace grid). */}
          <main className="flex min-h-0 flex-1 flex-col gap-6 pt-8 lg:flex-row lg:gap-12">
            <div className="min-h-0 min-w-0 overflow-y-auto lg:flex-1 lg:basis-0">
            <div
              id="theme-design-canvas"
              role="region"
              aria-label="Design canvas"
              tabIndex={0}
              onPointerDownCapture={(event) => {
                if (!(event.target as Element).closest("button, input, textarea, select, a, [data-selection-controls]")) {
                  event.currentTarget.focus({ preventScroll: true });
                }
              }}
              className="group/canvas flex h-full w-full flex-col outline-none"
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
                        DISPLAY_SIZE - p.y,
                      );
                      if (p.type === "text") {
                        p.fontSize = clampInt(
                          textPrimitiveFontSizeFromVisualHeight(p, height),
                          1,
                          8,
                        );
                        p.width = Math.min(
                          DISPLAY_SIZE - p.x,
                          Math.max(width, textPrimitiveNaturalWidth(p)),
                        );
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
              >
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
            {primitive && !isAttachedSceneAnimation(primitive.assetPath) ? (
              <Collapsible data-selection-controls className="mx-auto flex w-full max-w-[460px] flex-col">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="group w-full justify-between">
                    Details
                    <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                  </Button>
                </CollapsibleTrigger>
                {/* The panel has its natural height and never scrolls inside itself: in a low window it runs past the bottom of the workspace and the whole left column (preview and Details) scrolls as one, so the colour field and its palette are never cut off in a small scroll area of their own. */}
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
                    {selected.length === 1 ? (
                      <div className="flex gap-1" aria-label="Layer order">
                        {([[BringToFront, 1, "Bring forward"], [SendToBack, -1, "Send backward"]] as const).map(([Symbol, step, label]) => (
                          <Button
                            key={label}
                            size="icon"
                            variant="outline"
                            title={label}
                            aria-label={label}
                            disabled={!moveLayer([...document.spec.primitives], index, index + step)}
                            onClick={() => {
                              mutate((d) => { moveLayer(d.spec.primitives, index, index + step); });
                              setSelected([index + step]);
                            }}
                          >
                            <Symbol />
                          </Button>
                        ))}
                      </div>
                    ) : null}
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
                            max={DISPLAY_SIZE - primitive.x}
                            onChange={(value) =>
                              change(
                                "width",
                                Math.max(1, Math.min(DISPLAY_SIZE - primitive.x, value)),
                              )
                            }
                          />
                          <NumberField
                            label="Height"
                            value={primitive.height || 24}
                            max={DISPLAY_SIZE - primitive.y}
                            onChange={(value) =>
                              change(
                                "height",
                                Math.max(1, Math.min(DISPLAY_SIZE - primitive.y, value)),
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
              </EditableThemePreview>
            </div>
            </div>
            <div className="flex min-h-0 w-full min-w-0 flex-col max-lg:max-h-[40svh] max-lg:shrink-0 lg:flex-1 lg:basis-0 lg:overflow-y-auto">
            <div className="flex min-h-24 flex-1 flex-col gap-4 overflow-y-auto pb-4" role="log" aria-label="Conversation">
              {messages.length || asking !== null ? messages.map((message, i) => (
                message.role === "user" ? <div key={i}>{userTurn(message.content, message.images)}</div> : <p
                  key={i}
                  className="mr-6 whitespace-pre-wrap text-[13px] [overflow-wrap:anywhere]"
                >
                  {message.content}
                </p>
              )) : (
                <p className="my-auto text-center text-[13px] text-muted-foreground">
                  Describe a design, ask for a change, or ask what is possible.
                </p>
              )}
              {asking !== null ? (
                <>
                  {userTurn(asking, askingImages)}
                  {progress.words.length ? (
                    <div aria-hidden>
                      <ProcessSteps variant="single" steps={[{ id: String(progress.at), text: progress.words[progress.at % progress.words.length] }]} />
                    </div>
                  ) : null}
                  {/* Announces each real step once, not every word. */}
                  <p role="status" className="sr-only">{progress.words[0]}</p>
                </>
              ) : null}
              <div ref={chatEnd} />
            </div>
            <section className="flex w-full flex-col gap-3" aria-label="AI creation">
              <label
                htmlFor="ai-scene-request"
                className="sr-only"
              >
                Your idea
              </label>
              <div className="flex items-center gap-3">
              <div
                className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-input bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40"
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
                value={asking !== null ? "" : prompt}
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
                className="min-h-0 max-h-64 resize-none overflow-y-auto rounded-none border-0 text-[13px] md:text-[13px] bg-transparent px-3.5 pb-0 pt-[11px] disabled:bg-transparent focus-visible:ring-0 [field-sizing:fixed]"
                placeholder={selected.length ? "Describe what to change in this element…" : "Describe your design or what to change…"}
              />
              <div className="flex items-center gap-0.5 pb-[7px] pl-1.5 pr-[11px] pt-[11px]">
              <Button
                variant="ghost"
                size={canCancel ? "default" : "icon"}
                className={canCancel ? "h-8 px-2.5 text-[13px]" : "size-8"}
                aria-label={canCancel ? "Cancel" : "Add manually"}
                title={canCancel ? "Cancel" : "Add element"}
                disabled={locked && !canCancel}
                onClick={canCancel ? cancel : () => openPanel("add")}
              >
                {canCancel ? "Cancel" : <SquarePlus />}
              </Button>
                <Button
                  variant="ghost" size="icon" className="size-8"
                  aria-label="Attach reference images" title="Attach images"
                  disabled={locked || attaching || attachments.length >= 3}
                  onClick={() => attachmentInput.current?.click()}
                >
                  {attaching ? <Spinner /> : <Paperclip />}
                </Button>
                <Button
                  size="icon"
                  className="ml-auto size-8 rounded-full! bg-foreground text-background hover:bg-foreground/90"
                  aria-label="Create"
                  title="Create"
                  aria-busy={busy}
                  disabled={locked || attaching || !enabled || connecting || !prompt.trim()}
                  onClick={() => void generate()}
                >
                  <ArrowUp />
                </Button>
              </div>
              </div>
              </div>
            </section>
            <div className="mt-3 w-full space-y-3 empty:mt-0">
              {error ? (
                <p id="ai-theme-error" role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
                  {error}
                </p>
              ) : null}
              {/* The same reason already shows under the toolbar while Send is off (#551). */}
              {document.spec.primitives.length > 0 &&
              validation.errors.length && !sendBlockedReason ? (
                <p role="alert" className="text-sm text-destructive">
                  This design needs an adjustment before saving.{" "}
                  {validation.errors[0]}
                </p>
              ) : null}
            </div>
            </div>
          </main>

      {/* The key dialog is the same dialog as every other overlay, not this editor's own. */}
      <SetupDialog
        open={panel === "setup"}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
        title={configured ? "Replace OpenAI key" : "Add OpenAI key"}
        showCloseButton={false}
      >
          <OpenAIKeyForm
              inSetup
              initialConfigured={configured}
              onConfiguredChange={changeConfigured}
              onDismiss={closePanel}
              onConnectingChange={setConnecting}
              onConnected={(kept) => {
                setConfigured(true);
                if (kept !== undefined)
                  setStatus(kept || !nativeInstall ? "AI is ready." : copyForHost("AI is ready. The key could not be saved on this Mac, so it is needed again after the Mac App restarts.", windowsHost));
                setPanel(null);
                if (prompt.trim()) void generate(true);
              }}
              onDisconnected={() => {
                setConfigured(false);
                setStatus("OpenAI disconnected. You can keep editing by hand.");
              }}
            />
      </SetupDialog>

      <Dialog
        open={panel === "add" || panel === "library"}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
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
            <DialogTitle>{panel === "add" ? "Add an element" : "Your saved designs"}</DialogTitle>
            <DialogDescription className="sr-only">
              {panel === "add"
                ? "Choose what you want to show. You can move and change it afterwards."
                : "Your saved designs."}
            </DialogDescription>
          </DialogHeader>
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
          {panel === "library" ? (
            <div className="grid gap-2">
              {savedDesigns.length ? (
                savedDesigns.map((t) => (
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
        open={Boolean(pending) || leaving}
        onOpenChange={(open) => {
          if (!open) { setPending(undefined); setLeaving(false); }
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
              onClick={() => { setPending(undefined); setLeaving(false); }}
            >
              Keep editing
            </Button>
            <Button
              variant="destructive"
              className="h-12 w-full"
              onClick={() => {
                // Discarding is final: the draft must not be offered again later.
                clearThemeStudioRecovery();
                persistedDraft.current = null;
                if (leaving) onBackToLibrary?.();
                else if (pending) load(pending);
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
