"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Download,
  Settings,
  MoreHorizontal,
  Type,
  TimerReset,
  ChartNoAxesColumn,
  ImagePlus,
  Square,
  FolderOpen,
  X,
  Pause,
  Play,
  Plus,
  Redo2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { DesignElementsPanel } from "./design-elements-panel";
import { createDesignElement, isTypingTarget, LIVE_READINGS, moveLayer, pinnedElement, readingKey, setReading, swapRowPositions, type AddElementKind } from "./design-controls";
import { ColorField, NumberField } from "./editor-fields";
import {
  clampedMoveDelta,
  clampInt,
  DISPLAY_SIZE,
  isAspectLockedPrimitive,
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
  buildThemePack,
  createBlankThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  validateThemeSpec,
} from "@/lib/theme-studio";
import { importSpriteFile, spriteMetadata } from "@/lib/theme-studio-assets";
import {
  loadUserThemes,
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
} from "@/lib/ai-theme";
import {
  applyAIThemeCandidate,
  conceptFromDocument,
  setAIAnimationSpeed,
  spritePNG,
} from "@/lib/ai-theme-document";
import { AI_THEME_SCREENMASTER_ASSET_PATH } from "@/lib/ai-theme";
import { isAttachedSceneAnimation } from "@/lib/ai-theme";
import {applyAIThemeLayout,layoutContext} from "@/lib/ai-theme-layout";

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
  const [selected, setSelected] = useState<number[]>([]);
  const [panel, setPanel] = useState<
    "setup" | "settings" | "add" | "tools" | "library" | null
  >(null);
  const [connectionError, setConnectionError] = useState("");
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState<boolean | "pending">(false);
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<UserThemeRecord[]>([]);
  const [libraryId, setLibraryId] = useState<string>();
  const [pending, setPending] = useState<{
    document: ThemeStudioDocument;
    id?: string;
  }>();
  const request = useRef<AbortController | null>(null);
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
  const hasAnimation = document.spec.primitives.some(
    (p) =>
      p.assetPath &&
      (spriteMetadata(document.assets[p.assetPath]?.data)?.frameCount || 0) > 1,
  );
  const locked = busy;
  const view = document;
  const aiReady = configured === true && consent;
  const elementName = primitive
    ? friendlyElementName(primitive, document.assets)
    : "";
  const pack = useMemo(
    () => ({
      ok: true,
      name: view.packName,
      themeId: view.spec.themeId,
      spec: view.spec,
      assets: view.assets,
    }),
    [view],
  );
  const validation = useMemo(
    () => validateThemeSpec(document.spec, document.assets),
    [document],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchAIThemeCapabilities(controller.signal)
      .then((c) => {
        setEnabled(c.enabled);
        const provider = c.providers.find((p) => p.id === "openai");
        setConfigured(provider?.configured ? provider.verificationRequired ? "pending" : true : false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    const hydration = window.setTimeout(() => {
      try {
        setConsent(sessionStorage.getItem("vibetv.aiTheme.consent") === "1");
      } catch {
        /* Consent remains per-page when storage is unavailable. */
      }
      const loaded = loadUserThemes();
      if (loaded.ok) {
        setLibrary(loaded.value.themes);
        const latest = loaded.value.themes[0];
        if (
          latest &&
          !state.present.spec.primitives.length &&
          !isThemeStudioDirty(state)
        ) {
          dispatch({ type: "load", document: latest.document });
          setLibraryId(latest.id);
          setStatus("Your saved design is ready.");
        }
      } else setError(loaded.error.message);
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (motion.matches) setPlaying(false);
    }, 0);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => {
      if (motion.matches) setPlaying(false);
    };
    motion.addEventListener("change", changed);
    return () => {
      window.clearTimeout(hydration);
      controller.abort();
      request.current?.abort();
      request.current = null;
      motion.removeEventListener("change", changed);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

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
    if (busy) return;
    dispatch({ type });
    setSelected([]);
    setStatus(type === "undo" ? "Last edit undone." : "Edit restored.");
  }
  function load(next: { document: ThemeStudioDocument; id?: string }) {
    dispatch({ type: "load", document: next.document });
    setLibraryId(next.id);
    setSelected([]);
    setPrompt("");
    setPending(undefined);
    setError("");
    setStatus("Design opened.");
  }
  function requestLoad(next: { document: ThemeStudioDocument; id?: string }) {
    if (dirty) setPending(next);
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
  async function importFile(file: File | undefined, sprite: boolean) {
    if (!file || locked) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("Choose a file smaller than 8 MB.");
      return;
    }
    try {
      if (sprite) {
        const imported = await importSpriteFile(file, "live", "image");
        if (request.current) return;
        if (
          document.spec.primitives.some((p) =>
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
          d.assets[imported.assetPath] = imported.asset;
          d.spec.primitives.push({
            type: "sprite",
            x: Math.max(0, Math.min(80, DISPLAY_SIZE - imported.width)),
            y: Math.max(0, Math.min(45, DISPLAY_SIZE - imported.height)),
            width: imported.width,
            height: imported.height,
            assetPath: imported.assetPath,
            frameCount: imported.frameCount,
            fps: imported.fps,
            sheetColumns: imported.sheetColumns,
          });
        });
        setSelected([document.spec.primitives.length]);
      } else {
        const parsed = JSON.parse(await file.text()) as ThemeStudioDocument;
        if (request.current) return;
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
      const provider = capabilities?.providers.find((p) => p.id === "openai");
      setConfigured(provider?.configured ? "pending" : false);
    } finally {
      setConnecting(false);
    }
  }
  async function generate(connectedNow = false) {
    if (
      request.current ||
      busy ||
      loadingSample ||
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
      const layout = await planAIThemeLayout(prompt, context, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      if (layout.mode === "unsupported") {
        setStatus(layout.notes);
        return;
      }
      if (layout.mode === "layout") {
        const next = applyAIThemeLayout(document, layout);
        const check = validateThemeSpec(next.spec, next.assets);
        if (check.errors.length) throw new Error(check.errors[0]);
        dispatch({type:"update",document:next});
        setSelected([]);
        setPrompt("");
        setStatus("AI plan: " + layout.notes + " Preview the result; Undo takes you back.");
        return;
      }
      if (layout.mode !== "scene" || layout.edits.length) throw new Error("The AI edit plan is invalid. Your design is unchanged.");
      const concept = await generateAIThemeConcept(
        {
          prompt,
          history: [],
          previous: conceptFromDocument(document),
          target: "companions",
        },
        controller.signal,
      );
      const candidate = await buildAIThemeCandidate(concept);
      if (request.current !== controller || controller.signal.aborted) return;
      const next = applyAIThemeCandidate(document, candidate, "auto");
      const check = validateThemeSpec(next.spec, next.assets);
      if (check.errors.length) throw new Error(check.errors[0]);
      dispatch({ type: "update", document: next });
      setSelected([]);
      setPrompt("");
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
        if (isTypingTarget(event.target) || busy || (panel && panel !== "tools") || pending || event.nativeEvent.isComposing)
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
      <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <ControlCenterBrand showTagline={false} />
          <h1 className="text-sm font-medium">Theme Studio</h1>
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              title="More options"
              aria-label="More options"
              disabled={busy}
              onClick={() => openPanel("tools")}
            >
              <MoreHorizontal />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="VibeTV settings"
              aria-label="VibeTV settings"
              disabled={busy}
              onClick={() => openPanel("settings")}
            >
              <Settings />
            </Button>
          </div>
        </header>
        <div className="grid min-w-0 md:grid-cols-[minmax(0,1fr)_340px]">
          <main className="min-w-0 p-4 sm:p-6">
            <div className="mb-6 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => openPanel("add")}
              >
                <Plus />
                Add element
              </Button>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Undo · ⌘Z / Ctrl+Z"
                  aria-label="Undo last edit"
                  disabled={!state.past.length || busy}
                  onClick={() => history("undo")}
                >
                  <Undo2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Redo · ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y"
                  aria-label="Redo edit"
                  disabled={!state.future.length || busy}
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
              className="mx-auto w-full max-w-[360px] overflow-hidden rounded-2xl border bg-muted p-3 pb-4 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              inert={locked}
              aria-busy={busy}
            >
              <EditableThemePreview
                animate={playing && !locked}
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
                        p.width = Math.max(width, textPrimitiveNaturalWidth(p));
                      } else {
                        p.width = width;
                        p.height = height;
                      }
                    }
                  })
                }
              />
              <p className="pt-3 text-center text-xs tracking-widest text-muted-foreground">
                VibeTV
              </p>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {document.spec.primitives.length
                ? "Click to select. Drag or use arrow keys to move. Shift + arrow moves 10 pixels."
                : "A little display. Endless possibilities."}
            </p>
            {hasAnimation ? (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause /> : <Play />}
                  {playing ? "Pause animation" : "Play animation"}
                </Button>
              </div>
            ) : null}
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
                <p className="mt-2 text-xs text-muted-foreground">
                  No account needed. Make it your own.
                </p>
              </div>
            ) : null}
            {primitive && !isAttachedSceneAnimation(primitive.assetPath) ? (
              <section
                className="mt-6 space-y-3 rounded-xl border bg-card p-4"
                aria-label="Selected element tools"
              >
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
                  {selected.length === 1 &&
                  (primitive.binding || primitive.text?.includes("{")) ? (
                    <p className="text-sm text-muted-foreground">
                      This reading updates automatically. The preview uses
                      example values.
                    </p>
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
                    <details>
                      <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
                        Size & appearance
                      </summary>
                      <div className="grid gap-4 pt-3">
                        {isAspectLockedPrimitive(primitive) ? (
                          <NumberField
                            label="Size"
                            value={primitive.width || 24}
                            max={240}
                            onChange={(value) =>
                              mutate((d) => {
                                const p = d.spec.primitives[index];
                                if (!p) return;
                                const size = Math.max(1, Math.min(240, value));
                                p.width = size;
                                p.height = size;
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
                      </div>
                    </details>
                  ) : null}
                </fieldset>
              </section>
            ) : null}
          </main>
          <aside className="flex min-w-0 flex-col gap-5 border-t bg-card p-5 md:border-l md:border-t-0">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Make it yours
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                {document.spec.primitives.length
                  ? "What would you change?"
                  : "What will you create?"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Describe your idea. Then make the details your own, right on the
                display.
              </p>
            </div>
            <section className="space-y-3" aria-label="AI creation">
              <label
                htmlFor="ai-scene-request"
                className="block text-sm font-medium"
              >
                Your idea
              </label>
              <Textarea
                id="ai-scene-request"
                ref={promptInput}
                rows={3}
                value={prompt}
                aria-describedby={error ? "ai-theme-error" : undefined}
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
                className="min-h-28 max-h-64 resize-none overflow-y-auto [field-sizing:fixed]"
                placeholder="A cozy office that feels alive… or tell me what to change."
              />
              <p className="text-xs text-muted-foreground">
                Describe your scene. AI chooses one or two animated companions
                to match, over a still background.
              </p>
              <p className="text-xs text-muted-foreground">Enter to create · ⌘/Ctrl+Enter or Shift+Enter for a new line.</p>
              <div className="flex gap-2">
                {busy && !loadingSample ? (
                  <Button className="h-12" variant="outline" onClick={cancel}>
                    Cancel
                  </Button>
                ) : null}
                <Button
                  className="h-12 flex-1"
                  aria-busy={busy}
                  disabled={locked || !enabled || connecting || !prompt.trim()}
                  onClick={() => void generate()}
                >
                  {busy ? <Spinner className="motion-reduce:animate-none" /> : <Sparkles />}
                  {busy ? "Creating…" : "Create with AI"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {aiReady
                  ? "Uses your OpenAI account. One creation may include several billed AI steps."
                  : "Connect your OpenAI account when you first create. No generation starts without your confirmation."}
              </p>
            </section>
            <div className="mt-auto space-y-4 pt-3">
              {status && !busy ? (
                <p role="status" className="text-sm text-muted-foreground">
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
              <Button
                className="h-12 w-full"
                disabled={
                  locked ||
                  !document.spec.primitives.length ||
                  validation.errors.length > 0
                }
                onClick={save}
              >
                {dirty ? "Save changes" : "Save design"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Local preview · nothing is sent to your device.
              </p>
            </div>
          </aside>
        </div>
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
                  ? "VibeTV settings"
                  : panel === "add"
                    ? "Add an element"
                    : panel === "library"
                      ? "Your saved designs"
                      : "More options"}
            </DialogTitle>
            <DialogDescription>
              {panel === "setup"
                ? "Connect OpenAI once for this session. You can manage it later in Settings."
                : panel === "settings"
                  ? "Manage the AI connection for this local preview."
                  : panel === "add"
                    ? "Choose what you want to show. You can move and change it afterwards."
                    : panel === "library"
                      ? "Designs saved in this browser on this Mac."
                      : "Your design, saved files and other tools."}
            </DialogDescription>
          </DialogHeader>
          {panel === "setup" || panel === "settings" ? (
            <div className="space-y-4">
              <div className="flex justify-between gap-3 border-b pb-3">
                <span className="font-medium">AI creation · OpenAI</span>
                <span className="text-sm text-muted-foreground">
                  {configured === "pending" ? "Key saved · check needed" : configured ? "Connected" : "Not connected"}
                </span>
              </div>
              {configured !== true || panel === "settings" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Use a secret key from your OpenAI developer account with
                    paid usage enabled. A ChatGPT subscription does not cover
                    this.
                  </p>
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
                      aria-describedby={connectionError ? "key-privacy key-error" : "key-privacy"}
                    />
                  </label>
                </>
              ) : null}
              <p id="key-privacy" className="text-xs text-muted-foreground">
                In this preview, your key stays only in memory until the local
                service stops. It is not saved in your browser.
              </p>
              {configured === "pending" ? (
                <p className="text-sm text-muted-foreground">
                  Your key is still held for this session. Retry the check without
                  pasting it again, or replace it above. No image is generated by the check.
                </p>
              ) : null}
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0"
                  checked={consent}
                  disabled={connecting}
                  onChange={(e) => updateConsent(e.target.checked)}
                />
                I agree to send my description and artwork to OpenAI. Creating
                or changing a scene is billed to my OpenAI account and may
                include several analysis steps and up to five generated images,
                including at most one automatic correction per companion.
              </label>
              {!enabled ? (
                <p role="alert" className="text-sm text-destructive">
                  AI is unavailable right now. Restart the local preview and try
                  again. You can still edit by hand.
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
                    (!configured && !password.trim())
                  }
                  onClick={() => {
                    if (password.trim() || configured === "pending") void connect();
                    else {
                      setPanel(null);
                      if (panel === "setup") void generate(true);
                      else setStatus(
                        "AI is ready. Your next step is to describe your idea.",
                      );
                    }
                  }}
                >
                  {connecting
                    ? "Checking key…"
                    : password.trim()
                      ? "Connect and continue"
                      : configured === "pending"
                        ? "Retry connection check"
                      : configured
                        ? panel === "setup" ? "Continue" : "Done"
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
                            "Could not disconnect. Stop the local preview to clear the key.",
                          ),
                        )
                        .finally(() => setConnecting(false));
                    }}
                  >
                    Disconnect OpenAI
                  </Button>
                ) : null}
              </div>
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
          {panel === "tools" ? (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    setPanel(null);
                    requestLoad({ document: blank() });
                  }}
                >
                  <Plus />
                  New design
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => setPanel("library")}
                >
                  <FolderOpen />
                  Open saved design
                </Button>
              </div>
              <DesignElementsPanel document={document} onSelect={selectOnCanvas} onMove={(from, to, mode) => {
                const primitives = document.spec.primitives.map((p) => ({ ...p }));
                const moved = mode === "position" ? swapRowPositions(primitives, from, to) : moveLayer(primitives, from[0], to[0]);
                if (!moved) return "These elements cannot swap here. Keep them inside the display and clear of attached scene artwork.";
                mutate((d) => { d.spec.primitives = primitives; });
                setSelected([]);
                const message = mode === "position" ? "Vertical positions swapped. Undo brings them back." : "Layer order changed. Undo brings it back.";
                setStatus(message);
                return message;
              }} />
              <details>
                <summary className="min-h-11 cursor-pointer py-3 font-medium">Keyboard shortcuts</summary>
                <p className="text-sm text-muted-foreground">On the display: arrows move 1 pixel; Shift + arrows move 10. Delete or Backspace removes the selection. Escape deselects. ⌘/Ctrl+A selects editable elements.</p>
                <p className="mt-2 text-sm text-muted-foreground">⌘/Ctrl+Z undoes; ⌘/Ctrl+Shift+Z or Ctrl+Y redoes. ⌘/Ctrl+S saves. While typing, text editing keeps its normal shortcuts.</p>
              </details>
              <details>
                <summary className="cursor-pointer py-2 font-medium">
                  Rename design
                </summary>
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
              </details>
              <details>
                <summary className="cursor-pointer py-2 font-medium">
                  Import & export
                </summary>
                <div className="mt-2 grid gap-3">
                  <Button
                    variant="outline"
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
                    variant="outline"
                    onClick={() => {
                      setPanel(null);
                      jsonInput.current?.click();
                    }}
                  >
                    Open design file
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !document.spec.primitives.length ||
                      validation.errors.length > 0
                    }
                    onClick={exportPack}
                  >
                    <Download />
                    Export theme pack
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    An editable file is a backup you can reopen here. A theme
                    pack is for transferring your design later.
                  </p>
                </div>
              </details>
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
                  No saved designs yet. Use Save design when you are happy with
                  one.
                </p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
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
