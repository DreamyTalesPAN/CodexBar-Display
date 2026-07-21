"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Code2,
  FileUp,
  Film,
  ImagePlus,
  LayoutGrid,
  Palette,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Type,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  fetchAIThemeCapabilities,
  type AIThemeCandidate,
} from "@/lib/ai-theme";
import {
  buildThemePack,
  createStarterThemeSpec,
  importThemeSpec,
  normalizeThemeSpec,
  referencedThemeAssetPaths,
  updateThemeColors,
  validateThemeSpec,
  type ThemeStudioAsset,
  type ThemeStudioPrimitive,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";
import {
  assetFileName,
  assetKind,
  fileToBase64,
  importSpriteFile,
  spriteMetadata,
  themeAssetPathForFile,
} from "@/lib/theme-studio-assets";
import {
  clearThemeStudioRecovery,
  writeThemeStudioRecovery,
} from "@/lib/theme-studio-storage";
import {
  validateThemeAgainstCapabilities,
  type ThemeStudioDeviceCapabilities,
} from "@/lib/theme-studio-capabilities";
import {
  createThemeStudioEditorState,
  isThemeStudioDirty,
  reorderPrimitiveIndices,
  themeStudioEditorReducer,
  type ThemeStudioDocument,
} from "./theme-studio/theme-studio-editor-state";
import {
  AdvancedPanel,
  type ThemeStudioAdvancedTab,
} from "./theme-studio/advanced-panel";
import { ColorField, TextField } from "./theme-studio/editor-fields";
import {
  StatusLine,
  StatusPill,
  type EditorStatus,
} from "./theme-studio/editor-status";
import { LeaveEditorDialog } from "./theme-studio/leave-editor-dialog";
import { ThemeStudioToolbar } from "./theme-studio/theme-studio-toolbar";
import { EditableThemePreview } from "./theme-studio/editable-theme-preview";
import { PrimitiveInspector } from "./theme-studio/primitive-inspector";
import {
  AddButton,
  AssetRow,
  PanelTitle,
} from "./theme-studio/editor-controls";
import {
  clampInt,
  clampedMoveDelta,
  defaultPrimitive,
  DISPLAY_SIZE,
  isEditableKeyboardTarget,
  normalizeSelectedIndices,
  prettyJson,
  primitiveBounds,
  primitiveTitle,
  setPrimitiveField,
  textPrimitiveFontSizeFromVisualHeight,
  textPrimitiveNaturalWidth,
  titleFromThemeId,
} from "./theme-studio/editor-geometry";
import { AIThemePanel } from "./theme-studio/ai-theme-panel";
import type { ThemeRenderPack } from "./live-vibetv-preview";
import { themeRenderPackUrl } from "./control-center-runtime";

const COLOR_FALLBACK = "#000000";
const DEFAULT_GIF_SIZE = 80;
const MAX_TEXT_FONT_SIZE = 30;
const RETIRED_AI_THEME_STORAGE_PREFIX = "vibetv.controlCenter.aiTheme";
const NATIVE_WINDOW_WILL_CLOSE_EVENT = "vibetv:native-window-will-close";

export type ThemeStudioEditorSource = "blank" | "custom" | "published";

export type ThemeStudioEditorTheme = {
  assets?: Record<string, ThemeStudioAsset>;
  libraryId?: string;
  packName: string;
  recovered?: boolean;
  source: ThemeStudioEditorSource;
  spec: ThemeStudioSpec;
};

export type ThemeStudioSavePayload = {
  assets: Record<string, ThemeStudioAsset>;
  libraryId?: string;
  packName: string;
  source: ThemeStudioEditorSource;
  spec: ThemeStudioSpec;
};

export type ThemeStudioSaveResult = {
  document: ThemeStudioDocument;
  libraryId: string;
  savedAt: string;
};

export type ThemeStudioInstallPayload = {
  assets: Record<string, ThemeStudioAsset>;
  packName: string;
  spec: ThemeStudioSpec;
};

export type ThemeStudioScreenProps = {
  deviceCapabilities?: ThemeStudioDeviceCapabilities;
  initialTheme?: ThemeStudioEditorTheme;
  onBackToLibrary?: () => void;
  onInstallTheme?: (payload: ThemeStudioInstallPayload) => Promise<boolean>;
  onRecoveryDiscarded?: () => void;
  onSaveToLibrary?: (
    payload: ThemeStudioSavePayload,
  ) => Promise<ThemeStudioSaveResult>;
  saveBlockedReason?: string;
};

export function ThemeStudioScreen({
  deviceCapabilities,
  initialTheme,
  onBackToLibrary,
  onInstallTheme,
  onRecoveryDiscarded,
  onSaveToLibrary,
  saveBlockedReason,
}: ThemeStudioScreenProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const libraryButtonRef = useRef<HTMLDivElement>(null);
  const recoveryWrittenRef = useRef(Boolean(initialTheme?.recovered));
  const recoverySnapshotRef = useRef<{
    dirty: boolean;
    document: ThemeStudioDocument;
  } | null>(null);
  const spriteInputRef = useRef<HTMLInputElement>(null);
  const libraryIdRef = useRef(initialTheme?.libraryId);
  const sourceRef = useRef<ThemeStudioEditorSource>(
    initialTheme?.source || "custom",
  );
  const [editorState, dispatchEditor] = useReducer(
    themeStudioEditorReducer,
    undefined,
    () =>
      createThemeStudioEditorState({
        assets: {},
        packName: "Mini Classic",
        spec: createStarterThemeSpec(),
      }),
  );
  const { assets, packName, spec } = editorState.present;
  const [recoveryDirty, setRecoveryDirty] = useState(
    Boolean(initialTheme?.recovered),
  );
  const dirty = recoveryDirty || isThemeStudioDirty(editorState);
  recoverySnapshotRef.current = {
    dirty,
    document: editorState.present,
  };
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0]);
  const [jsonText, setJsonText] = useState(() =>
    prettyJson(createStarterThemeSpec()),
  );
  const [jsonDirty, setJsonDirty] = useState(false);
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [advancedTab, setAdvancedTab] =
    useState<ThemeStudioAdvancedTab>("project");
  const [jsonStatus, setJsonStatus] = useState<EditorStatus>({
    tone: "unknown",
    message: "Draft ready.",
  });
  const [exportStatus, setExportStatus] = useState<EditorStatus>({
    tone: "unknown",
    message: "Export is ready after validation.",
  });
  const [deviceStatus, setDeviceStatus] = useState<EditorStatus>({
    tone: "unknown",
    message: "Nothing is sent until you click Send.",
  });
  const [assetStatus, setAssetStatus] = useState<EditorStatus>({
    tone: "unknown",
    message: "",
  });
  const [libraryStatus, setLibraryStatus] = useState<EditorStatus | null>(() =>
    saveBlockedReason
      ? { message: saveBlockedReason, tone: "attention" }
      : null,
  );
  const [aiThemeAvailable, setAIThemeAvailable] = useState(false);
  const [aiThemeCandidate, setAIThemeCandidate] =
    useState<AIThemeCandidate | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAIThemeCapabilities(controller.signal)
      .then((capabilities) => setAIThemeAvailable(capabilities.enabled))
      .catch(() => setAIThemeAvailable(false));
    return () => controller.abort();
  }, []);

  const validation = useMemo(
    () => validateThemeSpec(spec, assets),
    [assets, spec],
  );
  const deviceValidation = useMemo(
    () =>
      deviceCapabilities
        ? validateThemeAgainstCapabilities(spec, assets, deviceCapabilities)
        : null,
    [assets, deviceCapabilities, spec],
  );
  const visibleSelectedIndices = useMemo(
    () => normalizeSelectedIndices(selectedIndices, spec.primitives.length),
    [selectedIndices, spec.primitives.length],
  );
  const selectedIndex =
    visibleSelectedIndices[visibleSelectedIndices.length - 1] ?? -1;
  const selectedPrimitive =
    selectedIndex >= 0 ? spec.primitives[selectedIndex] || null : null;
  const previewPack = useMemo<ThemeRenderPack>(
    () => ({
      ok: true,
      themeId: spec.themeId,
      name: packName,
      spec,
      assets,
    }),
    [assets, packName, spec],
  );
  const candidatePreviewPack = useMemo<ThemeRenderPack | null>(
    () =>
      aiThemeCandidate
        ? {
            assets: {},
            name: aiThemeCandidate.packName,
            ok: true,
            spec: aiThemeCandidate.spec,
            themeId: aiThemeCandidate.spec.themeId,
          }
        : null,
    [aiThemeCandidate],
  );
  const referencedAssets = useMemo(() => referencedThemeAssetPaths(spec), [spec]);

  useEffect(() => {
    if (initialTheme) {
      libraryIdRef.current = initialTheme.libraryId;
      sourceRef.current = initialTheme.source;
      recoveryWrittenRef.current = Boolean(initialTheme.recovered);
      replaceLoadedTheme({
        assets: initialTheme.assets || {},
        markSaved: true,
        packName: initialTheme.packName,
        spec: initialTheme.spec,
        status: { tone: "ready", message: "Theme opened." },
      });
      return;
    }

    let cancelled = false;

    async function loadInitialTheme() {
      await loadBuiltInTheme("mini-classic", {
        cancelled: () => cancelled,
        quiet: true,
      });
    }

    void loadInitialTheme();
    return () => {
      cancelled = true;
    };
    // Load once so a later preset button cannot overwrite local edits through this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTheme]);

  function replaceLoadedTheme({
    assets: nextAssets,
    markSaved = false,
    packName: nextPackName,
    spec: nextSpec,
    status,
  }: {
    assets?: Record<string, ThemeStudioAsset>;
    markSaved?: boolean;
    packName: string;
    spec: ThemeStudioSpec;
    status?: EditorStatus;
  }) {
    const normalized = normalizeThemeSpec(nextSpec);
    dispatchEditor({
      document: {
        assets: nextAssets || {},
        packName: nextPackName,
        spec: normalized,
      },
      type: markSaved ? "load" : "update",
    });
    setSelectedIndices(normalized.primitives.length > 0 ? [0] : []);
    setAIThemeCandidate(null);
    setJsonText(prettyJson(normalized));
    setJsonDirty(false);
    if (status) {
      setJsonStatus(status);
    }
    setExportStatus({
      tone: "unknown",
      message: "Export is ready after validation.",
    });
  }

  function applyAIThemeCandidate(nextCandidate: AIThemeCandidate) {
    replaceLoadedTheme({
      assets,
      packName: nextCandidate.packName,
      spec: nextCandidate.spec,
      status: {
        tone: "ready",
        message: "AI candidate applied as one undo step.",
      },
    });
  }

  const updateDocument = useCallback(
    (updater: (draft: ThemeStudioDocument) => void) => {
      dispatchEditor({
        mutate: (draft) => {
          updater(draft);
          draft.spec = normalizeThemeSpec(draft.spec);
          if (!jsonDirty) {
            setJsonText(prettyJson(draft.spec));
          } else {
            setJsonStatus({
              tone: "unknown",
              message: "JSON is out of date. Apply or reset it before editing JSON.",
            });
          }
        },
        type: "mutate",
      });
    },
    [jsonDirty],
  );

  const updateSpec = useCallback(
    (updater: (draft: ThemeStudioSpec) => void) => {
      updateDocument((document) => updater(document.spec));
    },
    [updateDocument],
  );

  const persistThemeStudioRecovery = useCallback(() => {
    const snapshot = recoverySnapshotRef.current;
    if (!snapshot?.dirty) {
      return true;
    }
    const result = writeThemeStudioRecovery({
      document: snapshot.document,
      libraryId: libraryIdRef.current,
      originThemeId:
        sourceRef.current === "published" ? libraryIdRef.current : undefined,
      source: sourceRef.current,
      updatedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setLibraryStatus({
        tone: "attention",
        message: result.error.message,
      });
      return false;
    }
    recoveryWrittenRef.current = true;
    return true;
  }, []);

  async function saveThemeToLibrary(): Promise<boolean> {
    if (!onSaveToLibrary) {
      return false;
    }
    if (saveBlockedReason) {
      setLibraryStatus({ tone: "attention", message: saveBlockedReason });
      return false;
    }
    if (validation.errors.length > 0) {
      setLibraryStatus({
        tone: "attention",
        message: validation.errors[0],
      });
      return false;
    }
    setSaving(true);
    try {
      const result = await onSaveToLibrary({
        assets,
        libraryId: libraryIdRef.current,
        packName,
        source: sourceRef.current,
        spec,
      });
      if (result.libraryId) {
        libraryIdRef.current = result.libraryId;
      }
      sourceRef.current = "custom";
      recoveryWrittenRef.current = false;
      setRecoveryDirty(false);
      dispatchEditor({
        document: result.document,
        type: "mark_saved",
      });
      const clearedRecovery = clearThemeStudioRecovery();
      if (clearedRecovery.ok) {
        onRecoveryDiscarded?.();
      }
      setLibraryStatus({
        tone: "ready",
        message: "Saved to library.",
      });
      return true;
    } catch (error) {
      setLibraryStatus({
        tone: "attention",
        message:
          error instanceof Error ? error.message : "Theme could not be saved.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function setPackName(value: string) {
    updateDocument((document) => {
      document.packName = value;
    });
  }

  function requestBackToLibrary() {
    if (!onBackToLibrary) {
      return;
    }
    if (!dirty) {
      onBackToLibrary();
      return;
    }
    setLeaveDialogOpen(true);
  }

  function keepEditing() {
    setLeaveDialogOpen(false);
    window.setTimeout(() => {
      libraryButtonRef.current?.querySelector("button")?.focus();
    }, 0);
  }

  function selectPrimitiveIndex(index: number, additive = false) {
    setSelectedIndices((current) => {
      if (index < 0 || index >= spec.primitives.length) {
        return [];
      }
      if (!additive) {
        return [index];
      }
      if (current.includes(index)) {
        const next = current.filter((item) => item !== index);
        return next.length > 0 ? next : [index];
      }
      return normalizeSelectedIndices([...current, index], spec.primitives.length);
    });
  }

  function selectPrimitiveIndices(indices: number[]) {
    setSelectedIndices(normalizeSelectedIndices(indices, spec.primitives.length));
  }

  function updatePrimitive(
    index: number,
    updater: (draft: ThemeStudioPrimitive) => void,
  ) {
    updateSpec((draft) => {
      const primitive = draft.primitives[index];
      if (!primitive) {
        return;
      }
      updater(primitive);
    });
  }

  function updateSelectedPrimitive(
    updater: (draft: ThemeStudioPrimitive) => void,
  ) {
    if (selectedIndex < 0) {
      return;
    }
    updatePrimitive(selectedIndex, updater);
  }

  async function loadBuiltInTheme(
    themeId: string,
    options: { cancelled?: () => boolean; quiet?: boolean } = {},
  ) {
    setLoadingPreset(true);
    try {
      const response = await fetch(themeRenderPackUrl(themeId));
      if (!response.ok) {
        throw new Error("Theme could not be opened.");
      }
      const payload = (await response.json()) as {
        assets?: Record<string, ThemeStudioAsset>;
        name?: string;
        spec?: unknown;
        themeId?: string;
      };
      if (!payload.spec) {
        throw new Error("Theme could not be opened.");
      }
      if (options.cancelled?.()) {
        return;
      }
      const imported = importThemeSpec(payload.spec);
      replaceLoadedTheme({
        assets: payload.assets || {},
        markSaved: Boolean(options.quiet),
        packName: payload.name || titleFromThemeId(payload.themeId || themeId),
        spec: imported,
        status: options.quiet
          ? { tone: "ready", message: "Mini Classic loaded." }
          : { tone: "ready", message: "Theme opened." },
      });
      setDeviceStatus({
        tone: "unknown",
        message: "Nothing is sent until you click Send.",
      });
    } catch (error) {
      if (options.cancelled?.()) {
        return;
      }
      setJsonStatus({
        tone: "attention",
        message:
          error instanceof Error ? error.message : "Theme could not be opened.",
      });
    } finally {
      if (!options.cancelled?.()) {
        setLoadingPreset(false);
      }
    }
  }

  async function openThemeFile(file: File | null | undefined) {
    if (!file) {
      return;
    }
    try {
      const imported = importThemeSpec(JSON.parse(await file.text()));
      replaceLoadedTheme({
        assets: {},
        packName: titleFromThemeId(imported.themeId),
        spec: imported,
        status: { tone: "ready", message: `${file.name} opened.` },
      });
    } catch (error) {
      setJsonStatus({
        tone: "attention",
        message:
          error instanceof Error ? error.message : "Theme file was not opened.",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function applyJson() {
    try {
      const imported = importThemeSpec(JSON.parse(jsonText));
      replaceLoadedTheme({
        assets,
        packName: titleFromThemeId(imported.themeId),
        spec: imported,
        status: { tone: "ready", message: "JSON applied." },
      });
    } catch (error) {
      setJsonStatus({
        tone: "attention",
        message:
          error instanceof Error ? error.message : "JSON was not applied.",
      });
    }
  }

  function addPrimitive(type: "text" | "progress" | "rect") {
    updateSpec((draft) => {
      const primitive = defaultPrimitive(type, draft.primitives.length);
      draft.primitives.push(primitive);
      setSelectedIndices([draft.primitives.length - 1]);
    });
  }

  async function addGifFile(file: File | null | undefined) {
    if (!file) {
      return;
    }
    if (file.type && file.type !== "image/gif") {
      setAssetStatus({ tone: "attention", message: "Choose a GIF file." });
      return;
    }
    try {
      const assetPath = themeAssetPathForFile(file.name, ".gif");
      const asset: ThemeStudioAsset = {
        contentType: file.type || "image/gif",
        data: await fileToBase64(file),
        encoding: "base64",
      };
      updateDocument((document) => {
        document.assets[assetPath] = asset;
        document.spec.primitives.push({
          type: "gif",
          x: 24,
          y: 24,
          width: DEFAULT_GIF_SIZE,
          height: DEFAULT_GIF_SIZE,
          assetPath,
        });
        setSelectedIndices([document.spec.primitives.length - 1]);
      });
      setAssetStatus({
        tone: "ready",
        message: `${assetFileName(assetPath)} imported.`,
      });
    } catch (error) {
      setAssetStatus({
        tone: "attention",
        message: error instanceof Error ? error.message : "GIF import failed.",
      });
    } finally {
      if (gifInputRef.current) {
        gifInputRef.current.value = "";
      }
    }
  }

  async function addSpriteFile(file: File | null | undefined) {
    if (!file) {
      return;
    }
    try {
      const imported = await importSpriteFile(file);
      updateDocument((document) => {
        document.assets[imported.assetPath] = imported.asset;
        document.spec.primitives.push({
          type: "sprite",
          x: 176,
          y: 26,
          width: imported.width,
          height: imported.height,
          frameCount: imported.frameCount,
          fps: imported.fps,
          sheetColumns: imported.sheetColumns,
          assetPath: imported.assetPath,
        });
        setSelectedIndices([document.spec.primitives.length - 1]);
      });
      setAssetStatus({
        tone: "ready",
        message: `${assetFileName(imported.assetPath)} imported.`,
      });
    } catch (error) {
      setAssetStatus({
        tone: "attention",
        message:
          error instanceof Error ? error.message : "Sprite import failed.",
      });
    } finally {
      if (spriteInputRef.current) {
        spriteInputRef.current.value = "";
      }
    }
  }

  function assignAssetPath(assetPath: string) {
    const type = assetKind(assetPath);
    if (!type) {
      return;
    }
    if (selectedPrimitive?.type === type) {
      updateSelectedPrimitive((primitive) => {
        primitive.assetPath = assetPath;
        const metadata = type === "sprite" ? spriteMetadata(assets[assetPath]?.data) : null;
        if (metadata) {
          primitive.width = metadata.width;
          primitive.height = metadata.height;
          primitive.frameCount = metadata.frameCount;
          primitive.fps = metadata.fps;
        }
      });
      setAssetStatus({
        tone: "ready",
        message: `${assetFileName(assetPath)} assigned to the selected element.`,
      });
      return;
    }

    updateSpec((draft) => {
      const metadata = type === "sprite" ? spriteMetadata(assets[assetPath]?.data) : null;
      draft.primitives.push({
        type,
        x: type === "gif" ? 24 : 176,
        y: type === "gif" ? 24 : 26,
        width: type === "gif" ? DEFAULT_GIF_SIZE : metadata?.width ?? 24,
        height: type === "gif" ? DEFAULT_GIF_SIZE : metadata?.height ?? 14,
        frameCount: metadata?.frameCount,
        fps: metadata?.fps,
        assetPath,
      });
      setSelectedIndices([draft.primitives.length - 1]);
    });
    setAssetStatus({
      tone: "ready",
      message: `${assetFileName(assetPath)} placed on the preview.`,
    });
  }

  function removeAsset(assetPath: string) {
    updateDocument((document) => {
      delete document.assets[assetPath];
    });
    setAssetStatus({
      tone: "unknown",
      message: `${assetFileName(assetPath)} removed from this draft.`,
    });
  }

  function reorderSelectedPrimitives(direction: "backward" | "forward") {
    if (visibleSelectedIndices.length === 0) {
      return;
    }
    const reordered = reorderPrimitiveIndices(
      spec.primitives,
      visibleSelectedIndices,
      direction,
    );
    updateSpec((draft) => {
      draft.primitives = reordered.primitives;
    });
    setSelectedIndices(reordered.selectedIndices);
  }

  const deleteSelectedPrimitives = useCallback(() => {
    if (visibleSelectedIndices.length === 0) {
      return;
    }
    const indicesToDelete = normalizeSelectedIndices(
      visibleSelectedIndices,
      spec.primitives.length,
    );
    if (indicesToDelete.length === 0) {
      return;
    }
    const firstDeleted = Math.min(...indicesToDelete);
    const deleted = new Set(indicesToDelete);
    updateSpec((draft) => {
      draft.primitives = draft.primitives.filter((_primitive, index) => !deleted.has(index));
      const nextIndex = Math.min(firstDeleted, draft.primitives.length - 1);
      setSelectedIndices(nextIndex >= 0 ? [nextIndex] : []);
    });
  }, [spec.primitives.length, updateSpec, visibleSelectedIndices]);

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }
      if (
        isEditableKeyboardTarget(event.target) ||
        visibleSelectedIndices.length === 0
      ) {
        return;
      }
      event.preventDefault();
      deleteSelectedPrimitives();
    }

    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [deleteSelectedPrimitives, visibleSelectedIndices.length]);

  useEffect(() => {
    function handleEditorShortcut(event: KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatchEditor({ type: event.shiftKey ? "redo" : "undo" });
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatchEditor({ type: "redo" });
        return;
      }
      if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)) {
        return;
      }
      if (visibleSelectedIndices.length === 0) {
        return;
      }
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      const requestedX = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
      const requestedY = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
      const origins = visibleSelectedIndices.flatMap((index) => {
        const primitive = spec.primitives[index];
        if (!primitive) {
          return [];
        }
        const bounds = primitiveBounds(primitive);
        return [{
          height: bounds.height,
          index,
          width: bounds.width,
          x: primitive.x,
          y: primitive.y,
        }];
      });
      const delta = clampedMoveDelta(origins, requestedX, requestedY);
      updateSpec((draft) => {
        for (const origin of origins) {
          const primitive = draft.primitives[origin.index];
          if (primitive) {
            primitive.x = origin.x + delta.x;
            primitive.y = origin.y + delta.y;
          }
        }
      });
    }

    window.addEventListener("keydown", handleEditorShortcut);
    return () => window.removeEventListener("keydown", handleEditorShortcut);
  }, [spec.primitives, updateSpec, visibleSelectedIndices]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      persistThemeStudioRecovery();
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, persistThemeStudioRecovery]);

  useEffect(() => {
    window.addEventListener(
      NATIVE_WINDOW_WILL_CLOSE_EVENT,
      persistThemeStudioRecovery,
    );
    return () =>
      window.removeEventListener(
        NATIVE_WINDOW_WILL_CLOSE_EVENT,
        persistThemeStudioRecovery,
      );
  }, [persistThemeStudioRecovery]);

  useEffect(() => {
    if (!dirty) {
      if (!recoveryWrittenRef.current) {
        return;
      }
      const result = clearThemeStudioRecovery();
      if (result.ok) {
        recoveryWrittenRef.current = false;
        const callbackTimer = window.setTimeout(() => {
          onRecoveryDiscarded?.();
        }, 0);
        return () => window.clearTimeout(callbackTimer);
      } else {
        const statusTimer = window.setTimeout(() => {
          setLibraryStatus({
            tone: "attention",
            message: result.error.message,
          });
        }, 0);
        return () => window.clearTimeout(statusTimer);
      }
    }
    const timer = window.setTimeout(() => {
      const result = writeThemeStudioRecovery({
        document: editorState.present,
        libraryId: libraryIdRef.current,
        originThemeId:
          sourceRef.current === "published" ? libraryIdRef.current : undefined,
        source: sourceRef.current,
        updatedAt: new Date().toISOString(),
      });
      if (!result.ok) {
        setLibraryStatus({
          tone: "attention",
          message: result.error.message,
        });
      } else {
        recoveryWrittenRef.current = true;
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [dirty, editorState.present, onRecoveryDiscarded]);

  function insertToken(token: string) {
    updateSelectedPrimitive((primitive) => {
      if (primitive.type !== "text") {
        return;
      }
      primitive.text = `${primitive.text || ""}${token}`;
      delete primitive.binding;
    });
  }

  function exportThemePack() {
    if (validation.errors.length > 0) {
      setExportStatus({
        tone: "attention",
        message: validation.errors[0],
      });
      return;
    }
    try {
      const pack = buildThemePack(spec, packName, assets);
      const zipBuffer = new ArrayBuffer(pack.zipBytes.byteLength);
      new Uint8Array(zipBuffer).set(pack.zipBytes);
      const blob = new Blob([zipBuffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = pack.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus({
        tone: "ready",
        message: `${pack.fileName} exported. Nothing was sent.`,
      });
    } catch (error) {
      setExportStatus({
        tone: "attention",
        message: error instanceof Error ? error.message : "Export failed.",
      });
    }
  }

  async function sendTheme() {
    if (dirty) {
      setDeviceStatus({
        tone: "attention",
        message: "Save this theme before sending it to VibeTV.",
      });
      return;
    }
    const checked = validateThemeSpec(spec, assets);
    if (checked.errors.length > 0) {
      setDeviceStatus({
        tone: "attention",
        message: checked.errors[0],
      });
      return;
    }
    if (deviceValidation && deviceValidation.errors.length > 0) {
      setDeviceStatus({
        tone: "attention",
        message: deviceValidation.errors[0],
      });
      setAdvancedTab("device");
      return;
    }

    if (!onInstallTheme) {
      setDeviceStatus({
        tone: "attention",
        message: "Open Theme Studio in the local Mac App to send this theme.",
      });
      return;
    }

    // Keep the exact directly installed edit available to the Overview preview.
    // Installation remains allowed if storage is unavailable; the persistence
    // helper already surfaces that problem in the Theme Studio status.
    void persistThemeStudioRecovery();

    setSending(true);
    setDeviceStatus({
      tone: "unknown",
      message: "Sending theme after your click.",
    });
    try {
      const installed = await onInstallTheme({
        assets,
        packName,
        spec,
      });
      if (!installed) {
        throw new Error("Theme install needs attention. Check the install status.");
      }
      setDeviceStatus({
        tone: "ready",
        message: "Theme installed through the Mac App.",
      });
    } catch (error) {
      setDeviceStatus({
        tone: "attention",
        message:
          error instanceof Error ? error.message : "VibeTV could not be reached.",
      });
    } finally {
      setSending(false);
    }
  }

  const validationOk = validation.errors.length === 0;
  const assetCount = referencedAssets.length;
  const showDeviceStatus =
    deviceStatus.tone === "attention" ||
    deviceStatus.message !== "Nothing is sent until you click Send.";
  const showJsonStatus = jsonStatus.tone === "attention";

  return (
    <div
      className="mx-auto max-w-[1540px] text-foreground lg:h-screen lg:max-w-none lg:overflow-hidden"
      data-theme-studio-root
    >
      <h2 className="sr-only">Theme Studio</h2>
      <section className="grid gap-4 py-4 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)]">
        <header className="grid gap-4 border-b pb-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="grid justify-items-start gap-3">
              {onBackToLibrary ? (
                <div ref={libraryButtonRef}>
                  <Button onClick={requestBackToLibrary} type="button" variant="outline">
                    <ArrowLeft data-icon="inline-start" aria-hidden />
                    <span>Library</span>
                  </Button>
                </div>
              ) : null}
              <h3 className="truncate text-3xl font-black leading-tight text-foreground">
                {packName || "Untitled theme"}
              </h3>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusPill
                  icon={
                    validationOk ? (
                      <CheckCircle2 size={14} aria-hidden />
                    ) : (
                      <AlertTriangle size={14} aria-hidden />
                    )
                  }
                  label={validationOk ? "Valid" : "Fix"}
                  tone={validationOk ? "ready" : "attention"}
                />
                <StatusPill
                  label={`${validation.bytes} B`}
                  tone={validation.bytes > 4096 ? "attention" : "neutral"}
                />
                <StatusPill
                  label={`${validation.primitiveCount} elements`}
                  tone={validation.primitiveCount > 32 ? "attention" : "neutral"}
                />
                <StatusPill
                  label={`${assetCount} ${assetCount === 1 ? "asset" : "assets"}`}
                  tone={assetCount > 0 ? "warn" : "neutral"}
                />
                <StatusPill
                  label={dirty ? "Unsaved changes" : "Saved"}
                  tone={dirty ? "warn" : "ready"}
                />
              </div>
            </div>
          </div>

          <ThemeStudioToolbar
            canExport={validation.errors.length === 0}
            canRedo={editorState.future.length > 0}
            canSave={
              validation.errors.length === 0 && !saveBlockedReason
            }
            canSend={
              !dirty &&
              validation.errors.length === 0 &&
              (deviceValidation?.errors.length || 0) === 0
            }
            canUndo={editorState.past.length > 0}
            onExport={exportThemePack}
            onRedo={() => dispatchEditor({ type: "redo" })}
            onSave={() => void saveThemeToLibrary()}
            onSend={() => void sendTheme()}
            onUndo={() => dispatchEditor({ type: "undo" })}
            saving={saving}
            sending={sending}
            showSave={Boolean(onSaveToLibrary)}
          />
          {aiThemeAvailable ? (
            <div className="hidden lg:block 2xl:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline">
                    <Sparkles data-icon="inline-start" aria-hidden />
                    AI Theme
                  </Button>
                </SheetTrigger>
                <SheetContent
                  className="w-[380px] overflow-y-auto sm:max-w-[380px]"
                  side="right"
                >
                  <SheetHeader>
                    <SheetTitle>AI Theme Builder</SheetTitle>
                    <SheetDescription>Create or improve an isolated candidate.</SheetDescription>
                  </SheetHeader>
                  <div className="p-4">
                    <AIThemePanel
                      candidate={aiThemeCandidate}
                      currentSpec={spec}
                      key={`sheet-${spec.themeId}`}
                      onApply={applyAIThemeCandidate}
                      onCandidateChange={setAIThemeCandidate}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2 lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline"><LayoutGrid data-icon="inline-start" />Layers & assets</Button>
              </SheetTrigger>
              <SheetContent className="overflow-y-auto" side="left">
                <SheetHeader>
                  <SheetTitle>Layers & assets</SheetTitle>
                  <SheetDescription>Add content, select a layer, or import an asset.</SheetDescription>
                </SheetHeader>
                <div className="grid gap-5 px-4 pb-6">
                  <div className="grid grid-cols-3 gap-2">
                    <AddButton icon={Type} label="Text" onClick={() => addPrimitive("text")} />
                    <AddButton icon={LayoutGrid} label="Bar" onClick={() => addPrimitive("progress")} />
                    <AddButton icon={Square} label="Rect" onClick={() => addPrimitive("rect")} />
                    <AddButton icon={Film} label="GIF" onClick={() => gifInputRef.current?.click()} />
                    <AddButton icon={ImagePlus} label="Sprite" onClick={() => spriteInputRef.current?.click()} />
                    <AddButton icon={FileUp} label="JSON" onClick={() => fileInputRef.current?.click()} />
                  </div>
                  <div className="grid gap-2">
                    {spec.primitives.map((primitive, index) => (
                      <Button
                        aria-pressed={visibleSelectedIndices.includes(index)}
                        className={cn("h-auto min-h-12 w-full justify-start", visibleSelectedIndices.includes(index) && "border-ring bg-primary hover:bg-primary-hover")}
                        key={`mobile-${primitive.type}-${index}`}
                        onClick={(event) => selectPrimitiveIndex(index, event.shiftKey || event.metaKey || event.ctrlKey)}
                        variant="outline"
                      >
                        <span className="w-6 font-mono text-muted-foreground">{index + 1}</span>
                        <strong className="w-16 truncate text-left">{primitive.type}</strong>
                        <span className="min-w-0 flex-1 truncate text-left font-normal">{primitiveTitle(primitive)}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline"><Palette data-icon="inline-start" />Properties</Button>
              </SheetTrigger>
              <SheetContent className="overflow-y-auto" side="right">
                <SheetHeader>
                  <SheetTitle>Inspector</SheetTitle>
                  <SheetDescription>Adjust the selected element and project settings.</SheetDescription>
                </SheetHeader>
                <div className="grid gap-6 px-4 pb-6">
                  {selectedPrimitive ? (
                    <PrimitiveInspector
                      key={`mobile-${selectedPrimitive.type}-${selectedIndex}`}
                      onChange={(field, value) => updateSelectedPrimitive((primitive) => setPrimitiveField(primitive, field, value))}
                      onDelete={deleteSelectedPrimitives}
                      onInsertToken={insertToken}
                      primitive={selectedPrimitive}
                    />
                  ) : <p className="rounded-[var(--radius-control)] border bg-muted p-3 text-sm text-muted-foreground">Select an element.</p>}
                  <div className="grid gap-3 border-t pt-5">
                    <PanelTitle icon={<Palette aria-hidden />} title="Project" />
                    <TextField label="Name" value={packName} onChange={setPackName} />
                    <ColorField label="Background" value={spec.bgColor || COLOR_FALLBACK} onChange={(value) => updateSpec((draft) => { Object.assign(draft, updateThemeColors(draft, { background: value })); })} />
                  </div>
                  <StatusLine
                    detail={deviceValidation?.errors[0] || deviceValidation?.warnings[0] || deviceStatus.message}
                    icon={<Send aria-hidden />}
                    title="VibeTV readiness"
                    tone={deviceValidation?.errors.length ? "attention" : deviceStatus.tone}
                  />
                </div>
              </SheetContent>
            </Sheet>
            {aiThemeAvailable ? (
              <Sheet>
                <SheetTrigger asChild>
                  <Button className="col-span-2" variant="outline">
                    <Sparkles data-icon="inline-start" />AI Theme
                  </Button>
                </SheetTrigger>
                <SheetContent className="overflow-y-auto" side="right">
                  <SheetHeader>
                    <SheetTitle>AI Theme Builder</SheetTitle>
                    <SheetDescription>Create or improve an isolated candidate.</SheetDescription>
                  </SheetHeader>
                  <div className="p-4">
                    <AIThemePanel
                      candidate={aiThemeCandidate}
                      currentSpec={spec}
                      key={`mobile-ai-${spec.themeId}`}
                      onApply={applyAIThemeCandidate}
                      onCandidateChange={setAIThemeCandidate}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            ) : null}
          </div>
        </header>

        <section className="grid min-h-0 items-start gap-4 lg:h-full lg:grid-cols-[240px_minmax(360px,1fr)_300px] lg:overflow-hidden 2xl:grid-cols-[260px_minmax(460px,1fr)_300px_340px]">
          <aside className="order-2 hidden lg:order-1 lg:block lg:h-full lg:min-h-0">
            <Card className="h-full min-h-0" size="sm">
              <CardHeader>
                <CardTitle>Layers</CardTitle>
                <CardDescription>Add and arrange elements.</CardDescription>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <div className="flex flex-col gap-4 pr-3">
                <div className="grid grid-cols-2 gap-2">
                  <AddButton
                    icon={Type}
                    label="Text"
                    onClick={() => addPrimitive("text")}
                  />
                  <AddButton
                    icon={LayoutGrid}
                    label="Bar"
                    onClick={() => addPrimitive("progress")}
                  />
                  <AddButton
                    icon={Square}
                    label="Rect"
                    onClick={() => addPrimitive("rect")}
                  />
                  <AddButton
                    icon={Film}
                    label="GIF"
                    onClick={() => gifInputRef.current?.click()}
                  />
                  <AddButton
                    icon={ImagePlus}
                    label="Sprite"
                    onClick={() => spriteInputRef.current?.click()}
                  />
                </div>

                <ItemGroup>
                    {spec.primitives.map((primitive, index) => {
                      const selected = visibleSelectedIndices.includes(index);

                      return (
                        <Item
                          asChild
                          key={`${primitive.type}-${index}`}
                          size="sm"
                          variant={selected ? "muted" : "outline"}
                        >
                          <button
                            aria-pressed={selected}
                            onClick={(event) =>
                              selectPrimitiveIndex(
                                index,
                                event.shiftKey ||
                                  event.metaKey ||
                                  event.ctrlKey,
                              )
                            }
                            type="button"
                          >
                            <ItemContent className="min-w-0">
                              <ItemTitle>{primitiveTypeLabel(primitive)}</ItemTitle>
                              <ItemDescription className="truncate">
                                {primitiveTitle(primitive)}
                              </ItemDescription>
                            </ItemContent>
                            <ItemActions>
                              <Badge variant={selected ? "default" : "outline"}>
                                {index + 1}
                              </Badge>
                            </ItemActions>
                          </button>
                        </Item>
                      );
                    })}
                </ItemGroup>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    aria-label="Bring selected layers forward"
                    disabled={visibleSelectedIndices.length === 0}
                    onClick={() => reorderSelectedPrimitives("forward")}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <ArrowUp data-icon="inline-start" aria-hidden />
                    <span>Forward</span>
                  </Button>
                  <Button
                    aria-label="Send selected layers backward"
                    disabled={visibleSelectedIndices.length === 0}
                    onClick={() => reorderSelectedPrimitives("backward")}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <ArrowDown data-icon="inline-start" aria-hidden />
                    <span>Backward</span>
                  </Button>
                </div>

                <AdvancedPanel
              activeTab={advancedTab}
              onTabChange={setAdvancedTab}
              panels={{
                project: (
                <section
                  aria-labelledby="theme-studio-tab-project"
                  className="grid gap-3"
                  id="theme-studio-panel-project"
                  role="tabpanel"
                >
                  <TextField label="Name" value={packName} onChange={setPackName} />
                  <TextField
                    label="ID"
                    value={spec.themeId}
                    onChange={(value) =>
                      updateSpec((draft) => {
                        draft.themeId = value;
                      })
                    }
                  />
                  <ColorField
                    label="Background"
                    value={spec.bgColor || COLOR_FALLBACK}
                    onChange={(value) =>
                      updateSpec((draft) => {
                        Object.assign(
                          draft,
                          updateThemeColors(draft, { background: value }),
                        );
                      })
                    }
                  />
                  <Button
                    className="w-full"
                    disabled={loadingPreset}
                    onClick={() => void loadBuiltInTheme("mini-classic")}
                    type="button"
                    variant="outline"
                  >
                    {loadingPreset ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <RefreshCw data-icon="inline-start" aria-hidden />
                    )}
                    <span>{loadingPreset ? "Loading" : "Mini theme"}</span>
                  </Button>
                  <Button
                    className="w-full"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                    variant="outline"
                  >
                    <FileUp data-icon="inline-start" aria-hidden />
                    <span>Import theme JSON</span>
                  </Button>
                </section>
                ),

                assets: (
                <section
                  aria-labelledby="theme-studio-tab-assets"
                  className="grid min-w-0 gap-2"
                  id="theme-studio-panel-assets"
                  role="tabpanel"
                >
                  <div className="grid min-w-0 gap-2">
                    <Button
                      className="min-w-0 w-full justify-start"
                      onClick={() => gifInputRef.current?.click()}
                      type="button"
                      variant="outline"
                    >
                      <Film data-icon="inline-start" aria-hidden />
                      <span>Upload GIF</span>
                    </Button>
                    <Button
                      className="min-w-0 w-full justify-start"
                      onClick={() => spriteInputRef.current?.click()}
                      type="button"
                      variant="outline"
                    >
                      <ImagePlus data-icon="inline-start" aria-hidden />
                      <span>Upload sprite</span>
                    </Button>
                  </div>
                  {Object.entries(assets).length > 0 ? (
                    Object.entries(assets).map(([assetPath, asset]) => (
                      <AssetRow
                        asset={asset}
                        key={assetPath}
                        path={assetPath}
                        referenced={referencedAssets.includes(assetPath)}
                        onRemove={() => removeAsset(assetPath)}
                        onUse={() => assignAssetPath(assetPath)}
                      />
                    ))
                  ) : (
                    <Empty className="gap-2 border bg-muted/30 p-4">
                      <EmptyHeader className="gap-1">
                        <EmptyMedia variant="icon">
                          <FileUp aria-hidden />
                        </EmptyMedia>
                        <EmptyTitle>No custom assets</EmptyTitle>
                        <EmptyDescription className="text-xs">
                          Upload a GIF or sprite to add it to this draft.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                  {assetStatus.message ? (
                    <StatusLine
                      detail={assetStatus.message}
                      icon={<FileUp size={16} aria-hidden />}
                      title="Assets"
                      tone={assetStatus.tone}
                    />
                  ) : null}
                </section>
                ),

                device: (
                  <section
                    aria-labelledby="theme-studio-tab-device"
                    id="theme-studio-panel-device"
                    role="tabpanel"
                  >
                  <StatusLine
                    icon={<Send size={16} aria-hidden />}
                    tone={
                      deviceValidation?.errors.length
                        ? "attention"
                        : deviceStatus.tone
                    }
                    title="VibeTV"
                    detail={
                      deviceValidation?.errors[0] ||
                      deviceValidation?.warnings[0] ||
                      deviceStatus.message
                    }
                  />
                  </section>
                ),

                json: (
                <section
                  aria-labelledby="theme-studio-tab-json"
                  className="grid gap-3"
                  id="theme-studio-panel-json"
                  role="tabpanel"
                >
                  <Textarea
                    aria-label="Theme JSON"
                    className="min-h-[220px] resize-y font-mono text-xs leading-5"
                    onChange={(event) => {
                      setJsonText(event.target.value);
                      setJsonDirty(true);
                      setJsonStatus({
                        tone: "unknown",
                        message: "JSON has local edits.",
                      });
                    }}
                    spellCheck={false}
                    value={jsonText || prettyJson(spec)}
                  />
                  <div className="grid gap-2">
                    {jsonDirty || showJsonStatus ? (
                      <StatusLine
                        detail={jsonStatus.message}
                        icon={<Code2 size={16} aria-hidden />}
                        title="JSON"
                        tone={jsonStatus.tone}
                      />
                    ) : null}
                    <Button
                      className="w-full"
                      onClick={applyJson}
                      type="button"
                      variant="outline"
                    >
                      <Code2 data-icon="inline-start" aria-hidden />
                      <span>Apply JSON</span>
                    </Button>
                    <Button
                      className="w-full"
                      onClick={() => {
                        setJsonText(prettyJson(spec));
                        setJsonDirty(false);
                        setJsonStatus({ tone: "ready", message: "JSON reset." });
                      }}
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw data-icon="inline-start" aria-hidden />
                      <span>Reset JSON</span>
                    </Button>
                  </div>
                </section>
                ),
              }}
                />
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </aside>

          <main className="order-1 grid min-h-0 min-w-0 place-items-center lg:order-2 lg:h-full">
            <div className="grid w-full justify-items-center gap-2">
              {aiThemeCandidate ? (
                <Badge data-ai-candidate-preview variant="secondary">
                  AI Candidate Preview – not applied
                </Badge>
              ) : null}
              <EditableThemePreview
                onInteractionCancel={() =>
                  dispatchEditor({ type: "cancel_transaction" })
                }
                onInteractionCommit={() =>
                  dispatchEditor({ type: "commit_transaction" })
                }
                onInteractionStart={() =>
                  dispatchEditor({ type: "begin_transaction" })
                }
                onMoveMany={(moves) => {
                  updateSpec((draft) => {
                    for (const move of moves) {
                      const primitive = draft.primitives[move.index];
                      if (!primitive) {
                        continue;
                      }
                      primitive.x = move.x;
                      primitive.y = move.y;
                    }
                  });
                }}
                onResize={(index, size) =>
                  updatePrimitive(index, (primitive) => {
                    const width = clampInt(size.width, 1, DISPLAY_SIZE - primitive.x);
                    const height = clampInt(size.height, 1, DISPLAY_SIZE - primitive.y);
                    if (primitive.type === "text") {
                      const fontSize = clampInt(
                        textPrimitiveFontSizeFromVisualHeight(primitive, height),
                        1,
                        MAX_TEXT_FONT_SIZE,
                      );
                      primitive.fontSize = fontSize;
                      primitive.width = Math.max(
                        width,
                        textPrimitiveNaturalWidth(primitive, fontSize),
                      );
                      return;
                    }
                    primitive.width = width;
                    primitive.height = height;
                  })
                }
                onSelect={selectPrimitiveIndex}
                onSelectMany={selectPrimitiveIndices}
                pack={candidatePreviewPack || previewPack}
                readOnly={Boolean(aiThemeCandidate)}
                selectedIndex={aiThemeCandidate ? -1 : selectedIndex}
                selectedIndices={aiThemeCandidate ? [] : visibleSelectedIndices}
                spec={aiThemeCandidate?.spec || spec}
              />
            </div>
          </main>

          <aside className="order-3 hidden gap-4 rounded-[var(--radius-card)] border bg-card p-4 lg:grid lg:max-h-full lg:overflow-y-auto">
            <div>
              <PanelTitle
                icon={<LayoutGrid size={16} aria-hidden />}
                title="Inspector"
              />
              {selectedPrimitive ? (
                <PrimitiveInspector
                  key={`${selectedPrimitive.type}-${selectedIndex}`}
                  onChange={(field, value) =>
                    updateSelectedPrimitive((primitive) => {
                      setPrimitiveField(primitive, field, value);
                    })
                  }
                  onDelete={deleteSelectedPrimitives}
                  onInsertToken={insertToken}
                  primitive={selectedPrimitive}
                />
              ) : (
                <p className="rounded-[var(--radius-control)] border bg-muted p-3 text-sm text-muted-foreground">
                  Select an element.
                </p>
              )}
            </div>

            {validation.errors.length > 0 || validation.warnings.length > 0 ? (
              <Card className="gap-0 bg-muted p-3">
                <PanelTitle
                  icon={<AlertTriangle size={16} aria-hidden />}
                  title="Validation"
                />
                <div className="grid gap-2">
                  {validation.errors.map((error) => (
                    <StatusLine
                      detail={error}
                      icon={<AlertTriangle size={16} aria-hidden />}
                      key={error}
                      title="Error"
                      tone="attention"
                    />
                  ))}
                  {validation.warnings.map((warning) => (
                    <StatusLine
                      detail={warning}
                      icon={<AlertTriangle size={16} aria-hidden />}
                      key={warning}
                      title="Warning"
                      tone="unknown"
                    />
                  ))}
                </div>
              </Card>
            ) : null}
            {libraryStatus ? (
              <StatusLine
                detail={libraryStatus.message}
                icon={
                  libraryStatus.tone === "attention" ? (
                    <AlertTriangle size={16} aria-hidden />
                  ) : (
                    <CheckCircle2 size={16} aria-hidden />
                  )
                }
                title="Library"
                tone={libraryStatus.tone}
              />
            ) : null}
            {exportStatus.message !== "Export is ready after validation." ? (
              <StatusLine
                detail={exportStatus.message}
                icon={
                  exportStatus.tone === "attention" ? (
                    <AlertTriangle size={16} aria-hidden />
                  ) : (
                    <CheckCircle2 size={16} aria-hidden />
                  )
                }
                title="Export"
                tone={exportStatus.tone}
              />
            ) : null}
            {showDeviceStatus ? (
              <StatusLine
                detail={deviceStatus.message}
                icon={<Send size={16} aria-hidden />}
                title="VibeTV"
                tone={deviceStatus.tone}
              />
            ) : null}
          </aside>

          <div className="order-4 hidden min-h-0 2xl:block 2xl:h-full">
            {aiThemeAvailable ? (
              <AIThemePanel
                candidate={aiThemeCandidate}
                currentSpec={spec}
                key={spec.themeId}
                onApply={applyAIThemeCandidate}
                onCandidateChange={setAIThemeCandidate}
              />
            ) : null}
          </div>
        </section>
      </section>

      <input
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void openThemeFile(event.target.files?.[0])}
        ref={fileInputRef}
        type="file"
      />
      <input
        accept="image/gif,.gif"
        className="hidden"
        onChange={(event) => void addGifFile(event.target.files?.[0])}
        ref={gifInputRef}
        type="file"
      />
      <input
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.cbi,.cba,text/plain"
        className="hidden"
        onChange={(event) => void addSpriteFile(event.target.files?.[0])}
        ref={spriteInputRef}
        type="file"
      />
      {leaveDialogOpen ? (
        <LeaveEditorDialog
          saving={saving}
          onDiscard={() => {
            const cleared = clearThemeStudioRecovery();
            if (!cleared.ok) {
              setLibraryStatus({
                tone: "attention",
                message: cleared.error.message,
              });
              keepEditing();
              return;
            }
            setLeaveDialogOpen(false);
            recoveryWrittenRef.current = false;
            setRecoveryDirty(false);
            onRecoveryDiscarded?.();
            onBackToLibrary?.();
          }}
          onKeepEditing={keepEditing}
          onSaveAndReturn={async () => {
            if (await saveThemeToLibrary()) {
              setLeaveDialogOpen(false);
              onBackToLibrary?.();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function primitiveTypeLabel(primitive: ThemeStudioPrimitive): string {
  if (primitive.type === "progress") {
    return "Bar";
  }
  if (primitive.type === "gif") {
    return "GIF";
  }
  return primitive.type.charAt(0).toUpperCase() + primitive.type.slice(1);
}

export function clearRetiredAiThemeStorage() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(RETIRED_AI_THEME_STORAGE_PREFIX)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in hardened browser modes. The AI feature stays absent.
  }
}
