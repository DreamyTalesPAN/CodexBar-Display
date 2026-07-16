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
  Square,
  Trash2,
  Type,
} from "lucide-react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  buildThemePack,
  createStarterThemeSpec,
  deviceThemeSpecJson,
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
  assetKindLabel,
  fileToBase64,
  formatBytes,
  importSpriteFile,
  spriteMetadata,
  themeAssetByteLength,
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
import {
  ColorField,
  NumberField,
  SelectField,
  TextField,
} from "./theme-studio/editor-fields";
import {
  StatusLine,
  StatusPill,
  type EditorStatus,
} from "./theme-studio/editor-status";
import { LeaveEditorDialog } from "./theme-studio/leave-editor-dialog";
import { ThemeStudioToolbar } from "./theme-studio/theme-studio-toolbar";
import {
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "./live-vibetv-preview";
import { ControlCenterButton } from "./control-center-button";
import { themeRenderPackUrl } from "./control-center-runtime";

type DragState =
  | {
      mode: "move";
      origins: DragMoveOrigin[];
      startX: number;
      startY: number;
    }
  | {
      currentX: number;
      currentY: number;
      mode: "select";
      startX: number;
      startY: number;
    }
  | {
      edgeOffsetX: number;
      edgeOffsetY: number;
      index: number;
      mode: "resize";
      originHeight: number;
      originWidth: number;
      originX: number;
      originY: number;
    };

type ResizeSize = {
  height: number;
  width: number;
};

type DragMoveOrigin = {
  height: number;
  index: number;
  width: number;
  x: number;
  y: number;
};

type PrimitiveMove = {
  index: number;
  x: number;
  y: number;
};

type SelectionBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type FieldKey = keyof ThemeStudioPrimitive;

const DISPLAY_SIZE = 240;
const COLOR_FALLBACK = "#000000";
const DEFAULT_GIF_SIZE = 80;
const DEFAULT_SPRITE_FPS = 8;
const MAX_TEXT_FONT_SIZE = 30;
const TEXT_SELECTION_HEIGHT_SCALE = 1.2;
const DEFAULT_FRAME = {
  v: 2,
  provider: "vibetv",
  label: "VibeTV",
  session: 62,
  weekly: 62,
  resetSecs: 3600,
  usageMode: "remaining",
  activity: "preview",
  sessionTokens: 12000,
  weekTokens: 82000,
  totalTokens: 248000,
  time: "12:00",
  date: "03.07",
};
const RETIRED_AI_THEME_STORAGE_PREFIX = "vibetv.controlCenter.aiTheme";

const VARIABLE_TOKENS = [
  { label: "Label", token: "{label}" },
  { label: "Session", token: "{session}" },
  { label: "Weekly", token: "{weekly}" },
  { label: "Reset", token: "{reset}" },
  { label: "Mode", token: "{usageMode}" },
  { label: "Time", token: "{time}" },
];

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
    message: "Import GIF or sprite assets when the theme needs them.",
  });
  const [libraryStatus, setLibraryStatus] = useState<EditorStatus | null>(() =>
    saveBlockedReason
      ? { message: saveBlockedReason, tone: "attention" }
      : null,
  );

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
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

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
      className="mx-auto max-w-[1540px] text-[#1B1B1B] lg:h-screen lg:max-w-none lg:overflow-hidden"
      data-theme-studio-root
    >
      <h2 className="sr-only">Theme Studio</h2>
      <section className="grid gap-4 py-4 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)]">
        <header className="grid gap-4 border-b border-[#747A60] pb-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="grid justify-items-start gap-3">
              {onBackToLibrary ? (
                <div ref={libraryButtonRef}>
                  <DarkButton
                    fullWidth={false}
                    icon={<ArrowLeft size={16} aria-hidden />}
                    label="Library"
                    onClick={requestBackToLibrary}
                  />
                </div>
              ) : null}
              <h3 className="truncate text-3xl font-black leading-tight text-[#1B1B1B]">
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
        </header>

        <section className="grid min-h-0 items-start gap-4 lg:grid-cols-[240px_minmax(360px,1fr)_300px] lg:overflow-hidden 2xl:grid-cols-[300px_minmax(560px,1fr)_360px]">
          <aside className="order-2 grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 lg:order-1 lg:max-h-full lg:overflow-y-auto">
            <div>
              <PanelTitle icon={<LayoutGrid size={16} aria-hidden />} title="Layers" />
              <div className="grid grid-cols-3 gap-2">
                <AddButton
                  icon={<Type size={18} aria-hidden />}
                  label="Text"
                  onClick={() => addPrimitive("text")}
                />
                <AddButton
                  icon={<LayoutGrid size={18} aria-hidden />}
                  label="Bar"
                  onClick={() => addPrimitive("progress")}
                />
                <AddButton
                  icon={<Square size={18} aria-hidden />}
                  label="Rect"
                  onClick={() => addPrimitive("rect")}
                />
                <AddButton
                  icon={<Film size={18} aria-hidden />}
                  label="GIF"
                  onClick={() => gifInputRef.current?.click()}
                />
                <AddButton
                  icon={<ImagePlus size={18} aria-hidden />}
                  label="Sprite"
                  onClick={() => spriteInputRef.current?.click()}
                />
              </div>
            </div>

            <div className="grid max-h-[440px] gap-2 overflow-y-auto pr-1">
              {spec.primitives.map((primitive, index) => (
                <button
                  className={`grid min-h-12 min-w-0 grid-cols-[28px_70px_minmax(0,1fr)] items-center gap-2 border px-3 py-2 text-left text-xs transition ${
                    visibleSelectedIndices.includes(index)
                      ? "border-[#5E7200] bg-[#CCFF00] text-[#1B1B1B] shadow-[inset_3px_0_0_#1B1B1B]"
                      : "border-[#747A60] bg-[#F9F9F9] text-[#444933] hover:bg-[#EEEEEE]"
                  }`}
                  key={`${primitive.type}-${index}`}
                  onClick={(event) =>
                    selectPrimitiveIndex(
                      index,
                      event.shiftKey || event.metaKey || event.ctrlKey,
                    )
                  }
                  type="button"
                >
                  <span className="font-mono text-[#444933]">{index + 1}</span>
                  <strong className="truncate text-[#1B1B1B]">
                    {primitive.type}
                  </strong>
                  <span className="truncate">{primitiveTitle(primitive)}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <DarkButton
                disabled={visibleSelectedIndices.length === 0}
                icon={<ArrowUp size={15} aria-hidden />}
                label="Bring forward"
                onClick={() => reorderSelectedPrimitives("forward")}
              />
              <DarkButton
                disabled={visibleSelectedIndices.length === 0}
                icon={<ArrowDown size={15} aria-hidden />}
                label="Send backward"
                onClick={() => reorderSelectedPrimitives("backward")}
              />
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
                  <PanelTitle icon={<Palette size={16} aria-hidden />} title="Project" />
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
                  <DarkButton
                    icon={<RefreshCw size={15} aria-hidden />}
                    label={loadingPreset ? "Loading" : "Mini theme"}
                    onClick={() => void loadBuiltInTheme("mini-classic")}
                  />
                  <DarkButton
                    icon={<FileUp size={16} aria-hidden />}
                    label="Import theme JSON"
                    onClick={() => fileInputRef.current?.click()}
                  />
                </section>
                ),

                assets: (
                <section
                  aria-labelledby="theme-studio-tab-assets"
                  className="grid gap-2"
                  id="theme-studio-panel-assets"
                  role="tabpanel"
                >
                  <PanelTitle icon={<FileUp size={16} aria-hidden />} title="Assets" />
                  <div className="grid grid-cols-2 gap-2">
                    <DarkButton
                      icon={<Film size={15} aria-hidden />}
                      label="Upload GIF"
                      onClick={() => gifInputRef.current?.click()}
                    />
                    <DarkButton
                      icon={<ImagePlus size={15} aria-hidden />}
                      label="Upload sprite"
                      onClick={() => spriteInputRef.current?.click()}
                    />
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
                    <p className="border border-[#747A60] bg-[#F9F9F9] p-3 text-xs leading-5 text-[#444933]">
                      No custom assets in this draft.
                    </p>
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
                  <PanelTitle icon={<Code2 size={16} aria-hidden />} title="JSON" />
                  <textarea
                    aria-label="Theme JSON"
                    className="min-h-[220px] w-full resize-y border border-[#747A60] bg-[#F9F9F9] p-3 font-mono text-xs leading-5 text-[#1B1B1B] outline-none focus:border-[#5E7200]"
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
                    <DarkButton
                      icon={<Code2 size={16} aria-hidden />}
                      label="Apply JSON"
                      onClick={applyJson}
                    />
                    <DarkButton
                      icon={<RefreshCw size={16} aria-hidden />}
                      label="Reset JSON"
                      onClick={() => {
                        setJsonText(prettyJson(spec));
                        setJsonDirty(false);
                        setJsonStatus({ tone: "ready", message: "JSON reset." });
                      }}
                    />
                  </div>
                </section>
                ),
              }}
            />
          </aside>

          <main className="order-1 grid min-h-0 min-w-0 place-items-center lg:order-2 lg:h-full">
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
              pack={previewPack}
              selectedIndex={selectedIndex}
              selectedIndices={visibleSelectedIndices}
              spec={spec}
            />
          </main>

          <aside className="order-3 grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 lg:max-h-full lg:overflow-y-auto">
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
                <p className="border border-[#747A60] bg-[#EEEEEE] p-3 text-sm text-[#444933]">
                  Select an element.
                </p>
              )}
            </div>

            {validation.errors.length > 0 || validation.warnings.length > 0 ? (
              <div className="border border-[#747A60] bg-[#EEEEEE] p-3">
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
              </div>
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

function EditableThemePreview({
  onInteractionCancel,
  onInteractionCommit,
  onInteractionStart,
  onMoveMany,
  onResize,
  onSelect,
  onSelectMany,
  pack,
  selectedIndex,
  selectedIndices,
  spec,
}: {
  onInteractionCancel: () => void;
  onInteractionCommit: () => void;
  onInteractionStart: () => void;
  onMoveMany: (moves: PrimitiveMove[]) => void;
  onResize: (index: number, size: ResizeSize) => void;
  onSelect: (index: number, additive?: boolean) => void;
  onSelectMany: (indices: number[]) => void;
  pack: ThemeRenderPack;
  selectedIndex: number;
  selectedIndices: number[];
  spec: ThemeStudioSpec;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) =>
      setPrefersReducedMotion(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  function pointerPoint(event: ReactPointerEvent<SVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * DISPLAY_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * DISPLAY_SIZE,
    };
  }

  function startDrag(
    event: ReactPointerEvent<SVGRectElement>,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    const primitive = spec.primitives[index];
    if (isFullCanvasRect(primitive)) {
      startSelection(event);
      return;
    }
    const normalizedSelection = normalizeSelectedIndices(
      selectedIndices,
      spec.primitives.length,
    );
    const shouldMoveSelection =
      normalizedSelection.length > 1 &&
      normalizedSelection.includes(index) &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey;
    const moveIndices = shouldMoveSelection ? normalizedSelection : [index];
    dragRef.current = {
      mode: "move",
      origins: moveIndices.flatMap((moveIndex) => {
        const movePrimitive = spec.primitives[moveIndex];
        if (!movePrimitive) {
          return [];
        }
        const bounds = primitiveBounds(movePrimitive);
        return [{
          height: bounds.height,
          index: moveIndex,
          width: bounds.width,
          x: movePrimitive.x,
          y: movePrimitive.y,
        }];
      }),
      startX: point.x,
      startY: point.y,
    };
    onInteractionStart();
    if (!shouldMoveSelection) {
      onSelect(index, event.shiftKey || event.metaKey || event.ctrlKey);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startSelection(event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    const point = pointerPoint(event);
    dragRef.current = {
      currentX: point.x,
      currentY: point.y,
      mode: "select",
      startX: point.x,
      startY: point.y,
    };
    setSelectionBox(normalizedSelectionBox(point.x, point.y, point.x, point.y));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startResize(
    event: ReactPointerEvent<SVGElement>,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPoint(event);
    const primitive = spec.primitives[index];
    const bounds = primitiveBounds(primitive);
    dragRef.current = {
      edgeOffsetX: point.x - (primitive.x + bounds.width),
      edgeOffsetY: point.y - (primitive.y + bounds.height),
      index,
      mode: "resize",
      originHeight: bounds.height,
      originWidth: bounds.width,
      originX: primitive.x,
      originY: primitive.y,
    };
    onInteractionStart();
    onSelect(index, event.metaKey || event.ctrlKey);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<SVGElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    event.preventDefault();
    const point = pointerPoint(event);
    if (drag.mode === "select") {
      drag.currentX = point.x;
      drag.currentY = point.y;
      setSelectionBox(
        normalizedSelectionBox(drag.startX, drag.startY, point.x, point.y),
      );
      return;
    }
    if (drag.mode === "resize") {
      const primitive = spec.primitives[drag.index];
      if (!primitive) {
        return;
      }
      const maxWidth = DISPLAY_SIZE - drag.originX;
      const maxHeight = DISPLAY_SIZE - drag.originY;
      const freeSize = {
        height: clampInt(point.y - drag.originY - drag.edgeOffsetY, 1, maxHeight),
        width: clampInt(point.x - drag.originX - drag.edgeOffsetX, 1, maxWidth),
      };
      onResize(
        drag.index,
        event.shiftKey
          ? aspectLockedResizeSize({
              maxHeight,
              maxWidth,
              originHeight: drag.originHeight,
              originWidth: drag.originWidth,
              targetHeight: freeSize.height,
              targetWidth: freeSize.width,
            })
          : freeSize,
      );
      return;
    }
    if (drag.origins.length === 0) {
      return;
    }
    const delta = clampedMoveDelta(
      drag.origins,
      point.x - drag.startX,
      point.y - drag.startY,
    );
    onMoveMany(
      drag.origins.map((origin) => ({
        index: origin.index,
        x: origin.x + delta.x,
        y: origin.y + delta.y,
      })),
    );
  }

  function stopDrag(outcome: "cancel" | "commit" | "selection" = "commit") {
    const drag = dragRef.current;
    dragRef.current = null;
    setSelectionBox(null);
    if (!drag || drag.mode === "select" || outcome === "selection") {
      return;
    }
    if (outcome === "cancel") {
      onInteractionCancel();
    } else {
      onInteractionCommit();
    }
  }

  function finishPointer(event: ReactPointerEvent<SVGElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.mode === "select") {
      event.preventDefault();
      const box = normalizedSelectionBox(
        drag.startX,
        drag.startY,
        drag.currentX,
        drag.currentY,
      );
      onSelectMany(
        box.width < 2 && box.height < 2
          ? []
          : selectedPrimitiveIndices(spec.primitives, box),
      );
    }
    stopDrag(drag.mode === "select" ? "selection" : "commit");
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !dragRef.current) {
        return;
      }
      event.preventDefault();
      stopDrag("cancel");
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  });

  return (
    <div className="relative aspect-square w-full max-w-[480px] overflow-hidden border border-[#1B1B1B] bg-black p-0">
      <ThemeSpecPreview
        animate={!prefersReducedMotion}
        pack={pack}
        status="ready"
        themeId={spec.themeId}
      />
      <svg
        aria-label="Editable 240x240 preview"
        className="absolute inset-0 h-full w-full [touch-action:none]"
        onPointerCancel={() => stopDrag("cancel")}
        onPointerMove={movePointer}
        onPointerUp={finishPointer}
        ref={svgRef}
        viewBox="0 0 240 240"
      >
        <rect
          aria-hidden="true"
          className="cursor-crosshair"
          fill="transparent"
          height={DISPLAY_SIZE}
          onPointerDown={startSelection}
          width={DISPLAY_SIZE}
          x="0"
          y="0"
        />
        {spec.primitives.map((primitive, index) => {
          const bounds = primitiveBounds(primitive);
          const selected = selectedIndices.includes(index);
          const active = selectedIndex === index;
          return (
            <g key={`${primitive.type}-${index}`}>
              <rect
                aria-label={`Select ${primitive.type} ${index + 1}`}
                className="cursor-move"
                fill="transparent"
                height={Math.max(8, bounds.height)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") {
                    return;
                  }
                  event.preventDefault();
                  onSelect(
                    index,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  );
                }}
                onPointerDown={(event) => startDrag(event, index)}
                role="button"
                stroke={selected ? "#C7FF68" : "transparent"}
                strokeDasharray={active ? "4 3" : "2 2"}
                strokeWidth={selected ? (active ? 1.5 : 1) : 0}
                tabIndex={0}
                width={Math.max(8, bounds.width)}
                x={primitive.x}
                y={primitive.y}
              />
              {active ? (
                <g
                  aria-hidden="true"
                  className="cursor-se-resize"
                  onPointerDown={(event) => startResize(event, index)}
                >
                  <rect
                    fill="transparent"
                    height="14"
                    pointerEvents="all"
                    width="14"
                    x={primitive.x + Math.max(8, bounds.width) - 7}
                    y={primitive.y + Math.max(8, bounds.height) - 7}
                  />
                  <circle
                    cx={primitive.x + Math.max(8, bounds.width)}
                    cy={primitive.y + Math.max(8, bounds.height)}
                    fill="#C7FF68"
                    pointerEvents="none"
                    r="3"
                  />
                </g>
              ) : null}
            </g>
          );
        })}
        {selectionBox ? (
          <rect
            fill="#CCFF0033"
            height={selectionBox.height}
            pointerEvents="none"
            stroke="#CCFF00"
            strokeDasharray="4 3"
            strokeWidth="1"
            width={selectionBox.width}
            x={selectionBox.x}
            y={selectionBox.y}
          />
        ) : null}
      </svg>
    </div>
  );
}

function PrimitiveInspector({
  onChange,
  onDelete,
  onInsertToken,
  primitive,
}: {
  onChange: (field: FieldKey, value: unknown) => void;
  onDelete: () => void;
  onInsertToken: (token: string) => void;
  primitive: ThemeStudioPrimitive;
}) {
  const bounds = primitiveBounds(primitive);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="X"
          value={primitive.x}
          onChange={(value) => onChange("x", value)}
        />
        <NumberField
          label="Y"
          value={primitive.y}
          onChange={(value) => onChange("y", value)}
        />
      </div>

      {(primitive.type === "rect" ||
        primitive.type === "progress" ||
        primitive.type === "gif" ||
        primitive.type === "sprite" ||
        primitive.type === "pixels" ||
        primitive.width !== undefined) ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Width"
            value={primitive.type === "text" ? bounds.width : primitive.width ?? bounds.width}
            onChange={(value) => onChange("width", value)}
          />
          <NumberField
            label="Height"
            value={primitive.height ?? bounds.height}
            onChange={(value) => onChange("height", value)}
          />
        </div>
      ) : null}

      {primitive.type === "text" ? (
        <>
          <TextField
            label="Text"
            value={primitive.text || ""}
            onChange={(value) => {
              onChange("text", value);
              if (value) {
                onChange("binding", "");
              }
            }}
          />
          <SelectField
            label="Binding"
            value={primitive.binding || ""}
            onChange={(value) => {
              onChange("binding", value);
              if (value) {
                onChange("text", "");
              }
            }}
            options={[
              ["", "None"],
              ["label", "Label"],
              ["session", "Session"],
              ["weekly", "Weekly"],
              ["reset", "Reset"],
              ["usageMode", "Mode"],
              ["time", "Time"],
              ["date", "Date"],
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Font size"
              value={primitive.fontSize ?? 2}
              onChange={(value) => onChange("fontSize", value)}
            />
            <SelectField
              label="Align"
              value={primitive.align || "left"}
              onChange={(value) => onChange("align", value)}
              options={[
                ["left", "Left"],
                ["center", "Center"],
                ["right", "Right"],
              ]}
            />
          </div>
          <ColorField
            label="Text color"
            value={primitive.color || "#FFFFFF"}
            onChange={(value) => onChange("color", value)}
          />
          <div className="grid gap-2">
            <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
              Variables
            </span>
            <div className="grid grid-cols-2 gap-2">
              {VARIABLE_TOKENS.map((item) => (
                <button
                  className="min-w-0 border border-[#747A60] bg-[#F9F9F9] px-2 py-2 text-left text-xs text-[#1B1B1B] outline-none transition hover:bg-[#EEEEEE] focus-visible:border-[#5E7200]"
                  key={item.token}
                  onClick={() => onInsertToken(item.token)}
                  type="button"
                >
                  <span className="block truncate font-black">{item.label}</span>
                  <code className="block truncate text-[11px] text-[#5E7200]">
                    {item.token}
                  </code>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {primitive.type === "progress" ? (
        <>
          <SelectField
            label="Binding"
            value={primitive.binding || "session"}
            onChange={(value) => onChange("binding", value)}
            options={[
              ["session", "Session"],
              ["weekly", "Weekly"],
            ]}
          />
          <SelectField
            label="Style"
            value={primitive.progressStyle || "solid"}
            onChange={(value) =>
              onChange("progressStyle", value === "solid" ? "" : value)
            }
            options={[
              ["solid", "Solid"],
              ["segments", "Segments"],
            ]}
          />
          {primitive.progressStyle === "segments" ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Segments"
                value={primitive.segments ?? 12}
                onChange={(value) => onChange("segments", value)}
              />
              <NumberField
                label="Gap"
                value={primitive.segmentGap ?? 1}
                onChange={(value) => onChange("segmentGap", value)}
              />
            </div>
          ) : null}
          <ColorField
            label="Bar color"
            value={primitive.color || "#C7FF68"}
            onChange={(value) => onChange("color", value)}
          />
          <ColorField
            label="Track color"
            value={primitive.bgColor || "#111111"}
            onChange={(value) => onChange("bgColor", value)}
          />
          <ColorField
            label="Border color"
            value={primitive.borderColor || "#3B4552"}
            onChange={(value) => onChange("borderColor", value)}
          />
        </>
      ) : null}

      {primitive.type === "rect" ? (
        <ColorField
          label="Fill color"
          value={primitive.color || "#222222"}
          onChange={(value) => onChange("color", value)}
        />
      ) : null}

      {primitive.type === "gif" || primitive.type === "sprite" ? (
        <TextField
          label="Asset path"
          value={primitive.assetPath || ""}
          onChange={(value) => onChange("assetPath", value)}
        />
      ) : null}

      {primitive.type === "sprite" ? (
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="Frames"
            value={primitive.frameCount ?? 1}
            onChange={(value) => onChange("frameCount", value)}
          />
          <NumberField
            label="FPS"
            value={primitive.fps ?? DEFAULT_SPRITE_FPS}
            onChange={(value) => onChange("fps", value)}
          />
          <NumberField
            label="Columns"
            value={primitive.sheetColumns ?? primitive.frameCount ?? 1}
            onChange={(value) => onChange("sheetColumns", value)}
          />
        </div>
      ) : null}

      <button
        className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 border border-[#7D2633] bg-[#FFE3E8] px-3 text-sm font-black text-[#7D2633] outline-none hover:bg-[#FFD1DA] focus-visible:border-[#7D2633]"
        onClick={onDelete}
        type="button"
      >
        <Trash2 size={16} aria-hidden />
        <span>Delete</span>
      </button>
    </div>
  );
}

function DarkButton({
  busy = false,
  className = "",
  disabled = false,
  fullWidth = true,
  icon,
  label,
  onClick,
  variant = "default",
}: {
  busy?: boolean;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "accent" | "default";
}) {
  return (
    <ControlCenterButton
      busy={busy}
      className={className}
      disabled={disabled}
      fullWidth={fullWidth}
      icon={icon}
      label={label}
      onClick={onClick}
      size="default"
      variant={variant === "accent" ? "primary" : "secondary"}
    />
  );
}

function AddButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="grid min-h-14 min-w-0 place-items-center gap-1 border border-[#747A60] bg-[#F9F9F9] p-1.5 text-center text-[10px] font-black text-[#1B1B1B] outline-none hover:bg-[#EEEEEE] focus-visible:border-[#5E7200]"
      onClick={onClick}
      type="button"
    >
      <span className="grid size-7 place-items-center border border-[#747A60] text-[#5E7200]">
        {icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function AssetRow({
  asset,
  onRemove,
  onUse,
  path,
  referenced,
}: {
  asset: ThemeStudioAsset;
  onRemove: () => void;
  onUse: () => void;
  path: string;
  referenced: boolean;
}) {
  return (
    <div className="grid gap-2 border border-[#747A60] bg-[#F9F9F9] p-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-[#1B1B1B]">
          {assetFileName(path)}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap gap-2 text-[11px] text-[#444933]">
          <span>{assetKindLabel(path)}</span>
          <span>{formatBytes(themeAssetByteLength(asset))}</span>
          <span className={referenced ? "text-[#5E7200]" : "text-[#8A6D00]"}>
            {referenced ? "Used" : "Unused"}
          </span>
        </div>
        <code className="mt-1 block truncate text-[11px] text-[#5E7200]">
          {path}
        </code>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className="min-h-10 border border-[#5E7200] bg-[#F1FFD0] px-2 text-xs font-black text-[#3B5200] outline-none hover:bg-[#E3FFA6] focus-visible:border-[#5E7200]"
          onClick={onUse}
          type="button"
        >
          Use
        </button>
        <button
          className="min-h-10 border border-[#7D2633] bg-[#FFE3E8] px-2 text-xs font-black text-[#7D2633] outline-none hover:bg-[#FFD1DA] focus-visible:border-[#7D2633]"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-normal text-[#1B1B1B]">
      <span className="text-[#5E7200]">{icon}</span>
      <span>{title}</span>
    </div>
  );
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

function prettyJson(spec: ThemeStudioSpec): string {
  return JSON.stringify(JSON.parse(deviceThemeSpecJson(spec)), null, 2);
}

function defaultPrimitive(
  type: "progress" | "rect" | "text",
  count: number,
): ThemeStudioPrimitive {
  const offset = Math.min(42, count * 8);
  if (type === "text") {
    return {
      type,
      x: 24 + offset,
      y: 24 + offset,
      text: "Text",
      fontSize: 2,
      color: "#EEF2F6",
    };
  }
  if (type === "progress") {
    return {
      type,
      x: 24,
      y: 118 + Math.min(40, offset),
      width: 190,
      height: 16,
      binding: "session",
      color: "#C7FF68",
      bgColor: "#111111",
      borderColor: "#3B4552",
    };
  }
  return {
    type,
    x: 32 + offset,
    y: 32 + offset,
    width: 56,
    height: 36,
    color: "#24313D",
  };
}

function setPrimitiveField(
  primitive: ThemeStudioPrimitive,
  field: FieldKey,
  value: unknown,
) {
  if (value === "") {
    delete primitive[field];
    return;
  }
  (primitive as Record<FieldKey, unknown>)[field] = value;
}

function primitiveBounds(primitive: ThemeStudioPrimitive) {
  if (
    primitive.type === "rect" ||
    primitive.type === "progress" ||
    primitive.type === "gif" ||
    primitive.type === "sprite" ||
    primitive.type === "pixels"
  ) {
    return {
      height: primitive.height || 16,
      width: primitive.width || 16,
    };
  }
  const fontSize = primitive.fontSize || 1;
  const visibleWidth = Math.max(
    primitive.width || 0,
    textPrimitiveNaturalWidth(primitive, fontSize),
  );
  const visibleHeight = textPrimitiveSelectionHeight(primitive, fontSize);
  return {
    height: Math.min(
      Math.max(1, DISPLAY_SIZE - primitive.y),
      Math.max(8, visibleHeight),
    ),
    width: Math.min(
      Math.max(1, DISPLAY_SIZE - primitive.x),
      Math.max(24, visibleWidth),
    ),
  };
}

function aspectLockedResizeSize({
  maxHeight,
  maxWidth,
  originHeight,
  originWidth,
  targetHeight,
  targetWidth,
}: {
  maxHeight: number;
  maxWidth: number;
  originHeight: number;
  originWidth: number;
  targetHeight: number;
  targetWidth: number;
}): ResizeSize {
  if (originWidth <= 0 || originHeight <= 0) {
    return {
      height: clampInt(targetHeight, 1, maxHeight),
      width: clampInt(targetWidth, 1, maxWidth),
    };
  }
  const widthScale = targetWidth / originWidth;
  const heightScale = targetHeight / originHeight;
  const dominantScale =
    Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
      ? widthScale
      : heightScale;
  const minScale = Math.max(1 / originWidth, 1 / originHeight);
  const maxScale = Math.min(maxWidth / originWidth, maxHeight / originHeight);
  const scale = Math.max(minScale, Math.min(maxScale, dominantScale));

  return {
    height: clampInt(originHeight * scale, 1, maxHeight),
    width: clampInt(originWidth * scale, 1, maxWidth),
  };
}

function clampedMoveDelta(
  origins: DragMoveOrigin[],
  rawDeltaX: number,
  rawDeltaY: number,
) {
  const minDeltaX = Math.max(...origins.map((origin) => -origin.x));
  const maxDeltaX = Math.min(
    ...origins.map((origin) => DISPLAY_SIZE - origin.x - origin.width),
  );
  const minDeltaY = Math.max(...origins.map((origin) => -origin.y));
  const maxDeltaY = Math.min(
    ...origins.map((origin) => DISPLAY_SIZE - origin.y - origin.height),
  );

  return {
    x: clampInt(rawDeltaX, minDeltaX, maxDeltaX),
    y: clampInt(rawDeltaY, minDeltaY, maxDeltaY),
  };
}

function normalizeSelectedIndices(indices: number[], primitiveCount: number): number[] {
  return [...new Set(indices)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < primitiveCount,
  );
}

function normalizedSelectionBox(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): SelectionBox {
  const minX = Math.max(0, Math.min(startX, currentX));
  const minY = Math.max(0, Math.min(startY, currentY));
  const maxX = Math.min(DISPLAY_SIZE, Math.max(startX, currentX));
  const maxY = Math.min(DISPLAY_SIZE, Math.max(startY, currentY));
  return {
    height: Math.max(0, maxY - minY),
    width: Math.max(0, maxX - minX),
    x: minX,
    y: minY,
  };
}

function selectedPrimitiveIndices(
  primitives: ThemeStudioPrimitive[],
  selection: SelectionBox,
): number[] {
  const hits = primitives.flatMap((primitive, index) => {
    const bounds = primitiveBounds(primitive);
    const box = {
      height: bounds.height,
      width: bounds.width,
      x: primitive.x,
      y: primitive.y,
    };
    return selectionBoxesIntersect(selection, box) ? [index] : [];
  });
  const foregroundHits = hits.filter((index) => !isFullCanvasRect(primitives[index]));
  return foregroundHits.length > 0 ? foregroundHits : hits;
}

function selectionBoxesIntersect(a: SelectionBox, b: SelectionBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function isFullCanvasRect(primitive: ThemeStudioPrimitive | undefined): boolean {
  return Boolean(
    primitive &&
      primitive.type === "rect" &&
      primitive.x === 0 &&
      primitive.y === 0 &&
      primitive.width === DISPLAY_SIZE &&
      primitive.height === DISPLAY_SIZE,
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "a" ||
    tagName === "button" ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function textPrimitiveNaturalWidth(
  primitive: ThemeStudioPrimitive,
  fontSize = primitive.fontSize || 1,
) {
  const text = primitive.binding
    ? boundText(primitive.binding)
    : substituteText(primitive.text || "Text");
  const renderFontSize = textPrimitiveRenderFontSize(primitive, fontSize);
  return Math.min(
    Math.max(1, DISPLAY_SIZE - primitive.x),
    Math.ceil(text.length * renderFontSize * 0.6),
  );
}

function textPrimitiveRenderFontSize(
  primitive: ThemeStudioPrimitive,
  fontSize = primitive.fontSize || 1,
) {
  const scale = Math.max(1, fontSize);
  switch (primitive.font || 1) {
    case 2:
      return 16 * scale;
    case 4:
      return 26 * scale;
    case 6:
    case 7:
      return 48 * scale;
    case 8:
      return 75 * scale;
    case 1:
    default:
      return 8 * scale;
  }
}

function textPrimitiveSelectionHeight(
  primitive: ThemeStudioPrimitive,
  fontSize = primitive.fontSize || 1,
) {
  return Math.ceil(
    textPrimitiveRenderFontSize(primitive, fontSize) *
      TEXT_SELECTION_HEIGHT_SCALE,
  );
}

function textPrimitiveFontSizeFromVisualHeight(
  primitive: ThemeStudioPrimitive,
  height: number,
) {
  const baseHeight = textPrimitiveRenderFontSize({ ...primitive, fontSize: 1 }, 1);
  return Math.round(height / (baseHeight * TEXT_SELECTION_HEIGHT_SCALE));
}

function primitiveTitle(primitive: ThemeStudioPrimitive): string {
  if (primitive.type === "text") {
    return primitive.text || primitive.binding || "Text";
  }
  if (primitive.type === "progress") {
    return primitive.binding || "session";
  }
  if (primitive.type === "gif" || primitive.type === "sprite") {
    return primitive.assetPath?.split("/").pop() || "Asset";
  }
  if (primitive.type === "pixels") {
    return `${primitive.width ?? 0}x${primitive.height ?? 0}`;
  }
  return primitive.color || "Rect";
}

function boundText(binding: string): string {
  switch (binding) {
    case "label":
      return DEFAULT_FRAME.label;
    case "provider":
      return DEFAULT_FRAME.provider;
    case "session":
    case "sessionPercent":
      return String(DEFAULT_FRAME.session);
    case "weekly":
    case "weeklyPercent":
      return String(DEFAULT_FRAME.weekly);
    case "reset":
    case "resetCountdown":
      return "1h";
    case "usageMode":
      return DEFAULT_FRAME.usageMode;
    case "activity":
      return DEFAULT_FRAME.activity;
    case "time":
      return DEFAULT_FRAME.time;
    case "date":
      return DEFAULT_FRAME.date;
    case "sessionTokens":
      return String(DEFAULT_FRAME.sessionTokens);
    case "weekTokens":
      return String(DEFAULT_FRAME.weekTokens);
    case "totalTokens":
      return String(DEFAULT_FRAME.totalTokens);
    default:
      return "";
  }
}

function substituteText(value: string): string {
  return value.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key: string) =>
    boundText(key),
  );
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.max(min, Math.min(Math.max(min, max), rounded));
}

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
