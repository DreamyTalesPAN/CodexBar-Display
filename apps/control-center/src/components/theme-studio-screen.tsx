"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Code2,
  Download,
  FileUp,
  Film,
  ImagePlus,
  LayoutGrid,
  Palette,
  RefreshCw,
  Save,
  Send,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildThemePack,
  cloneThemeSpec,
  createStarterThemeSpec,
  deviceThemeSpecJson,
  importThemeSpec,
  normalizeThemeSpec,
  referencedThemeAssetPaths,
  THEME_STUDIO_DRAFT_STORAGE_KEY,
  updateThemeColors,
  validateThemeSpec,
  type ThemeStudioAsset,
  type ThemeStudioDraft,
  type ThemeStudioPrimitive,
  type ThemeStudioSpec,
} from "@/lib/theme-studio";
import {
  ThemeSpecPreview,
  type ThemeRenderPack,
} from "./live-vibetv-preview";
import { ControlCenterButton } from "./control-center-button";
import { themeRenderPackUrl } from "./control-center-runtime";

type StudioStatus = {
  tone: "ready" | "attention" | "unknown";
  message: string;
};

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
const MAX_SPRITE_FRAME_WIDTH = 64;
const MAX_SPRITE_FRAME_HEIGHT = 64;
const MAX_SPRITE_FRAMES = 32;
const MAX_SPRITE_TOTAL_PIXELS = 32768;
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

export type ThemeStudioInstallPayload = {
  assets: Record<string, ThemeStudioAsset>;
  packName: string;
  spec: ThemeStudioSpec;
};

export type ThemeStudioScreenProps = {
  initialTheme?: ThemeStudioEditorTheme;
  onBackToLibrary?: () => void;
  onInstallTheme?: (payload: ThemeStudioInstallPayload) => Promise<boolean>;
  onSaveToLibrary?: (payload: ThemeStudioSavePayload) => void;
};

export function ThemeStudioScreen({
  initialTheme,
  onBackToLibrary,
  onInstallTheme,
  onSaveToLibrary,
}: ThemeStudioScreenProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const spriteInputRef = useRef<HTMLInputElement>(null);
  const [spec, setSpec] = useState<ThemeStudioSpec>(() =>
    createStarterThemeSpec(),
  );
  const [assets, setAssets] = useState<Record<string, ThemeStudioAsset>>({});
  const [packName, setPackName] = useState("Mini Classic");
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0]);
  const [jsonText, setJsonText] = useState(() =>
    prettyJson(createStarterThemeSpec()),
  );
  const [jsonDirty, setJsonDirty] = useState(false);
  const [, setSavedAt] = useState("");
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [sending, setSending] = useState(false);
  const [jsonStatus, setJsonStatus] = useState<StudioStatus>({
    tone: "unknown",
    message: "Draft ready.",
  });
  const [, setExportStatus] = useState<StudioStatus>({
    tone: "unknown",
    message: "Export is ready after validation.",
  });
  const [deviceStatus, setDeviceStatus] = useState<StudioStatus>({
    tone: "unknown",
    message: "Nothing is sent until you click Send.",
  });
  const [assetStatus, setAssetStatus] = useState<StudioStatus>({
    tone: "unknown",
    message: "Import GIF or sprite assets when the theme needs them.",
  });
  const [libraryStatus, setLibraryStatus] = useState<StudioStatus | null>(null);

  const validation = useMemo(
    () => validateThemeSpec(spec, assets),
    [assets, spec],
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
      replaceLoadedTheme({
        assets: initialTheme.assets || {},
        packName: initialTheme.packName,
        spec: initialTheme.spec,
        status: { tone: "ready", message: "Theme opened." },
      });
      return;
    }

    let cancelled = false;

    async function loadInitialTheme() {
      const draft = readDraft();
      if (draft) {
        if (cancelled) {
          return;
        }
        replaceLoadedTheme({
          assets: draft.assets || {},
          packName: draft.packName,
          spec: draft.spec,
          status: { tone: "ready", message: "Draft restored." },
        });
        setSavedAt(formatSavedAt(draft.savedAt));
        return;
      }
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

  useEffect(() => {
    if (initialTheme || !spec.themeId) {
      return;
    }
    const timer = window.setTimeout(() => {
      const draft: ThemeStudioDraft = {
        assets,
        packName,
        savedAt: new Date().toISOString(),
        spec,
      };
      window.localStorage.setItem(
        THEME_STUDIO_DRAFT_STORAGE_KEY,
        JSON.stringify(draft),
      );
      setSavedAt(formatSavedAt(draft.savedAt));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [assets, initialTheme, packName, spec]);

  function replaceLoadedTheme({
    assets: nextAssets,
    packName: nextPackName,
    spec: nextSpec,
    status,
  }: {
    assets?: Record<string, ThemeStudioAsset>;
    packName: string;
    spec: ThemeStudioSpec;
    status?: StudioStatus;
  }) {
    const normalized = normalizeThemeSpec(nextSpec);
    setAssets(nextAssets || {});
    setSpec(normalized);
    setPackName(nextPackName);
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

  const updateSpec = useCallback((updater: (draft: ThemeStudioSpec) => void) => {
    setSpec((current) => {
      const draft = cloneThemeSpec(current);
      updater(draft);
      const normalized = normalizeThemeSpec(draft);
      if (!jsonDirty) {
        setJsonText(prettyJson(normalized));
      }
      return normalized;
    });
  }, [jsonDirty]);

  function saveThemeToLibrary() {
    if (!onSaveToLibrary) {
      return;
    }
    if (validation.errors.length > 0) {
      setLibraryStatus({
        tone: "attention",
        message: validation.errors[0],
      });
      return;
    }
    onSaveToLibrary({
      assets,
      libraryId: initialTheme?.libraryId,
      packName,
      source: initialTheme?.source || "custom",
      spec,
    });
    setLibraryStatus({
      tone: "ready",
      message: "Saved to library.",
    });
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
      setAssets((current) => ({ ...current, [assetPath]: asset }));
      updateSpec((draft) => {
        draft.primitives.push({
          type: "gif",
          x: 24,
          y: 24,
          width: DEFAULT_GIF_SIZE,
          height: DEFAULT_GIF_SIZE,
          assetPath,
        });
        setSelectedIndices([draft.primitives.length - 1]);
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
      setAssets((current) => ({ ...current, [imported.assetPath]: imported.asset }));
      updateSpec((draft) => {
        draft.primitives.push({
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
        setSelectedIndices([draft.primitives.length - 1]);
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
    setAssets((current) => {
      const next = { ...current };
      delete next[assetPath];
      return next;
    });
    setAssetStatus({
      tone: "unknown",
      message: `${assetFileName(assetPath)} removed from this draft.`,
    });
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
  const showAssetStatus = assetStatus.tone === "attention";
  const showDeviceStatus =
    deviceStatus.tone === "attention" ||
    deviceStatus.message !== "Nothing is sent until you click Send.";
  const showJsonStatus = jsonStatus.tone === "attention";

  return (
    <div className="mx-auto max-w-[1540px] text-[#1B1B1B]">
      <h2 className="sr-only">Theme Studio</h2>
      <section className="grid gap-5 py-5">
        <header className="grid gap-4 border-b border-[#747A60] pb-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="min-w-0">
            <div className="grid justify-items-start gap-3">
              {onBackToLibrary ? (
                <DarkButton
                  fullWidth={false}
                  icon={<ArrowLeft size={16} aria-hidden />}
                  label="Library"
                  onClick={onBackToLibrary}
                />
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
              </div>
            </div>
          </div>

          <div
            className={`grid gap-2 sm:grid-cols-2 ${
              onSaveToLibrary ? "xl:min-w-[500px] xl:grid-cols-3" : "xl:min-w-[330px]"
            }`}
          >
            <DarkButton
              disabled={validation.errors.length > 0}
              icon={<Download size={16} aria-hidden />}
              label="Export ZIP"
              onClick={exportThemePack}
            />
            {onSaveToLibrary ? (
              <DarkButton
                disabled={validation.errors.length > 0}
                icon={<Save size={16} aria-hidden />}
                label="Save theme"
                onClick={saveThemeToLibrary}
                variant="accent"
              />
            ) : null}
            <DarkButton
              busy={sending}
              disabled={sending || validation.errors.length > 0}
              icon={<Send size={16} aria-hidden />}
              label={sending ? "Sending" : "Send to VibeTV"}
              onClick={() => void sendTheme()}
            />
          </div>
        </header>

        <section className="grid items-start gap-5 xl:grid-cols-[280px_minmax(420px,1fr)_340px] 2xl:grid-cols-[300px_minmax(560px,1fr)_360px]">
          <aside className="order-2 grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4 xl:order-1">
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

            <details className="border border-[#747A60] bg-[#EEEEEE] p-3">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-normal text-[#1B1B1B]">
                Advanced
              </summary>
              <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px] font-black text-[#444933]">
                <span className="border border-[#747A60] bg-[#F9F9F9] px-1 py-1">
                  Project
                </span>
                <span className="border border-[#747A60] bg-[#F9F9F9] px-1 py-1">
                  Assets
                </span>
                <span className="border border-[#747A60] bg-[#F9F9F9] px-1 py-1">
                  JSON
                </span>
                <span className="border border-[#747A60] bg-[#F9F9F9] px-1 py-1">
                  Device
                </span>
              </div>

              <div className="mt-4 grid gap-4">
                <section className="grid gap-3">
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
                      setSpec((current) =>
                        updateThemeColors(current, { background: value }),
                      )
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

                <section className="grid gap-2">
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
                  {showAssetStatus ? (
                    <StatusLine
                      detail={assetStatus.message}
                      icon={<FileUp size={16} aria-hidden />}
                      title="Assets"
                      tone={assetStatus.tone}
                    />
                  ) : null}
                </section>

                {showDeviceStatus ? (
                  <StatusLine
                    icon={<Send size={16} aria-hidden />}
                    tone={deviceStatus.tone}
                    title="VibeTV"
                    detail={deviceStatus.message}
                  />
                ) : null}

                <section className="grid gap-3">
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
                    {showJsonStatus ? (
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
                  </div>
                </section>
              </div>
            </details>
          </aside>

          <main className="order-1 grid min-w-0 place-items-center xl:order-2">
            <EditableThemePreview
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

          <aside className="order-3 grid gap-4 border border-[#747A60] bg-[#F9F9F9] p-4">
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
            {libraryStatus?.tone === "attention" ? (
              <StatusLine
                detail={libraryStatus.message}
                icon={<AlertTriangle size={16} aria-hidden />}
                title="Library"
                tone="attention"
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
    </div>
  );
}

function EditableThemePreview({
  onMoveMany,
  onResize,
  onSelect,
  onSelectMany,
  pack,
  selectedIndex,
  selectedIndices,
  spec,
}: {
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

  function stopDrag() {
    dragRef.current = null;
    setSelectionBox(null);
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
    stopDrag();
  }

  return (
    <div className="relative aspect-square w-full max-w-[480px] overflow-hidden border border-[#1B1B1B] bg-black p-0">
      <ThemeSpecPreview pack={pack} status="ready" themeId={spec.themeId} />
      <svg
        aria-label="Editable 240x240 preview"
        className="absolute inset-0 h-full w-full [touch-action:none]"
        onPointerCancel={stopDrag}
        onPointerLeave={stopDrag}
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
                  aria-label={`Resize ${primitive.type} ${index + 1}`}
                  className="cursor-se-resize"
                  onPointerDown={(event) => startResize(event, index)}
                  role="button"
                  tabIndex={0}
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

function TextField({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "password" | "text";
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <input
        className="min-h-11 w-full border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <input
        className="min-h-11 w-full border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        min={0}
        onChange={(event) => onChange(integerOrDefault(event.target.value, 0))}
        type="number"
        value={value}
      />
    </label>
  );
}

function ColorField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const safeValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : COLOR_FALLBACK;
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <span className="grid min-h-11 grid-cols-[44px_minmax(0,1fr)] overflow-hidden border border-[#747A60] bg-[#F9F9F9]">
        <input
          aria-label={`${label} swatch`}
          className="h-11 w-11 cursor-pointer border-0 bg-transparent p-1"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={safeValue}
        />
        <input
          className="min-w-0 border-0 bg-[#F9F9F9] px-3 font-mono text-sm text-[#1B1B1B] outline-none"
          onChange={(event) => onChange(event.target.value)}
          value={safeValue.toUpperCase()}
        />
      </span>
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-black uppercase tracking-normal text-[#444933]">
        {label}
      </span>
      <select
        className="min-h-11 w-full border border-[#747A60] bg-[#F9F9F9] px-3 text-sm text-[#1B1B1B] outline-none focus:border-[#5E7200]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusPill({
  icon,
  label,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  tone: "attention" | "neutral" | "ready" | "warn";
}) {
  const toneClass =
    tone === "attention"
      ? "border-[#7D2633] bg-[#FFE3E8] text-[#7D2633]"
      : tone === "ready"
        ? "border-[#5E7200] bg-[#F1FFD0] text-[#3B5200]"
        : tone === "warn"
          ? "border-[#8A6D00] bg-[#FFF2B8] text-[#4D3D00]"
          : "border-[#747A60] bg-[#EEEEEE] text-[#444933]";
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1.5 border px-3 text-xs font-black ${toneClass}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

function StatusLine({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  tone: StudioStatus["tone"];
}) {
  const toneClass =
    tone === "attention"
      ? "border-[#7D2633] bg-[#FFE3E8] text-[#7D2633]"
      : tone === "ready"
        ? "border-[#5E7200] bg-[#F1FFD0] text-[#3B5200]"
        : "border-[#747A60] bg-[#EEEEEE] text-[#444933]";
  return (
    <div className={`flex min-w-0 gap-3 border p-3 ${toneClass}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-[#1B1B1B]">{title}</div>
        <div className="mt-1 break-words text-sm leading-5">{detail}</div>
      </div>
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

function readDraft(): ThemeStudioDraft | null {
  try {
    const raw = window.localStorage.getItem(THEME_STUDIO_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ThemeStudioDraft>;
    if (!parsed.spec) {
      return null;
    }
    return {
      assets: parsed.assets || {},
      packName: parsed.packName || titleFromThemeId(parsed.spec.themeId),
      savedAt: parsed.savedAt || new Date().toISOString(),
      spec: normalizeThemeSpec(parsed.spec),
    };
  } catch {
    return null;
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

type SpriteImportResult = {
  asset: ThemeStudioAsset;
  assetPath: string;
  fps: number;
  frameCount: number;
  height: number;
  sheetColumns: number;
  width: number;
};

type EncodedSprite = {
  fps: number;
  frameCount: number;
  frames: string[][];
  height: number;
  palette: string[];
  width: number;
};

async function importSpriteFile(file: File): Promise<SpriteImportResult> {
  if (isSpriteTextFile(file)) {
    const raw = ensureTrailingNewline(await file.text());
    const metadata = spriteMetadata(raw);
    if (!metadata) {
      throw new Error("Sprite file must be CBI1 or CBA1.");
    }
    const extension = raw.trimStart().startsWith("CBA1") ? ".cba" : ".cbi";
    return {
      asset: {
        contentType: "text/plain",
        data: raw,
        encoding: "text",
      },
      assetPath: themeAssetPathForFile(file.name, extension),
      fps: metadata.fps,
      frameCount: metadata.frameCount,
      height: metadata.height,
      sheetColumns: metadata.frameCount,
      width: metadata.width,
    };
  }

  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Choose a PNG, JPEG, WebP, CBI, or CBA file.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const frame = inferSpriteSheetFrame(bitmap.width, bitmap.height);
    const sprite = spriteFromBitmap(bitmap, frame);
    return {
      asset: {
        contentType: "text/plain",
        data: encodeSpriteAsset(sprite),
        encoding: "text",
      },
      assetPath: themeAssetPathForFile(file.name, ".cba"),
      fps: sprite.fps,
      frameCount: sprite.frameCount,
      height: sprite.height,
      sheetColumns: frame.columns,
      width: sprite.width,
    };
  } finally {
    bitmap.close();
  }
}

function inferSpriteSheetFrame(width: number, height: number) {
  let frameWidth = width;
  let frameHeight = height;
  if (
    width !== height ||
    width > MAX_SPRITE_FRAME_WIDTH ||
    height > MAX_SPRITE_FRAME_HEIGHT
  ) {
    const commonSizes = [64, 48, 32, 24, 16, 8];
    const squareCell = commonSizes.find((size) => {
      const frames = (width / size) * (height / size);
      return (
        width % size === 0 &&
        height % size === 0 &&
        frames >= 2 &&
        frames <= MAX_SPRITE_FRAMES &&
        size <= MAX_SPRITE_FRAME_WIDTH &&
        size <= MAX_SPRITE_FRAME_HEIGHT
      );
    });
    if (squareCell) {
      frameWidth = squareCell;
      frameHeight = squareCell;
    } else if (height <= MAX_SPRITE_FRAME_HEIGHT && width % height === 0) {
      frameWidth = height;
      frameHeight = height;
    } else {
      frameWidth = Math.min(width, MAX_SPRITE_FRAME_WIDTH);
      frameHeight = Math.min(height, MAX_SPRITE_FRAME_HEIGHT);
    }
  }
  frameWidth = clampInt(frameWidth, 1, Math.min(MAX_SPRITE_FRAME_WIDTH, width));
  frameHeight = clampInt(frameHeight, 1, Math.min(MAX_SPRITE_FRAME_HEIGHT, height));
  const columns = Math.max(1, Math.floor(width / frameWidth));
  const rows = Math.max(1, Math.floor(height / frameHeight));
  const frameCount = Math.min(
    MAX_SPRITE_FRAMES,
    columns * rows,
    Math.max(1, Math.floor(MAX_SPRITE_TOTAL_PIXELS / (frameWidth * frameHeight))),
  );
  return { columns, frameCount, height: frameHeight, width: frameWidth };
}

function spriteFromBitmap(
  bitmap: ImageBitmap,
  frame: { columns: number; frameCount: number; height: number; width: number },
): EncodedSprite {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      fps: 0,
      frameCount: 1,
      frames: [Array.from({ length: frame.height }, () => `${frame.width}.`)],
      height: frame.height,
      palette: ["#FFFFFF"],
      width: frame.width,
    };
  }

  const rawFrames: Array<Array<string | null>> = [];
  const colorCounts = new Map<string, number>();
  for (let frameIndex = 0; frameIndex < frame.frameCount; frameIndex += 1) {
    const sx = (frameIndex % frame.columns) * frame.width;
    const sy = Math.floor(frameIndex / frame.columns) * frame.height;
    context.clearRect(0, 0, frame.width, frame.height);
    context.drawImage(
      bitmap,
      sx,
      sy,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );
    const image = context.getImageData(0, 0, frame.width, frame.height).data;
    const pixels: Array<string | null> = [];
    for (let offset = 0; offset < image.length; offset += 4) {
      const alpha = image[offset + 3] ?? 0;
      if (alpha < 128) {
        pixels.push(null);
        continue;
      }
      const color = quantizedHexColor(
        image[offset] ?? 0,
        image[offset + 1] ?? 0,
        image[offset + 2] ?? 0,
      );
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      pixels.push(color);
    }
    rawFrames.push(pixels);
  }

  const nonEmptyFrames = rawFrames.filter((pixels) =>
    pixels.some((color) => color !== null),
  );
  const framesToEncode = nonEmptyFrames.length > 0 ? nonEmptyFrames : rawFrames.slice(0, 1);
  const palette = Array.from(colorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 26)
    .map(([color]) => color);
  if (palette.length === 0) {
    palette.push("#FFFFFF");
  }

  const frames = framesToEncode.map((pixels) => {
    const rows: string[] = [];
    for (let row = 0; row < frame.height; row += 1) {
      const tokens: string[] = [];
      for (let col = 0; col < frame.width; col += 1) {
        const color = pixels[row * frame.width + col];
        tokens.push(color ? paletteTokenForColor(color, palette) : ".");
      }
      rows.push(encodeRleTokenRow(tokens));
    }
    return rows;
  });

  return {
    fps: frames.length > 1 ? DEFAULT_SPRITE_FPS : 0,
    frameCount: frames.length,
    frames,
    height: frame.height,
    palette,
    width: frame.width,
  };
}

function encodeSpriteAsset(sprite: EncodedSprite): string {
  if (sprite.frameCount <= 1) {
    return ensureTrailingNewline(
      [
        "CBI1",
        `${sprite.width} ${sprite.height}`,
        String(sprite.palette.length),
        ...sprite.palette,
        ...(sprite.frames[0] || []),
      ].join("\n"),
    );
  }
  return ensureTrailingNewline(
    [
      "CBA1",
      `${sprite.width} ${sprite.height} ${sprite.frameCount} ${sprite.fps}`,
      String(sprite.palette.length),
      ...sprite.palette,
      ...sprite.frames.flat(),
    ].join("\n"),
  );
}

function encodeRleTokenRow(tokens: string[]): string {
  let output = "";
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index] || ".";
    let count = 1;
    while (tokens[index + count] === token) {
      count += 1;
    }
    output += `${count > 1 ? count : ""}${token}`;
    index += count;
  }
  return output;
}

function quantizedHexColor(r: number, g: number, b: number): string {
  const quantize = (value: number) => clampInt(Math.round(value / 17) * 17, 0, 255);
  return `#${[quantize(r), quantize(g), quantize(b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function paletteTokenForColor(color: string, palette: string[]): string {
  const exactIndex = palette.indexOf(color);
  const index = exactIndex >= 0 ? exactIndex : nearestPaletteIndex(color, palette);
  return String.fromCharCode(97 + clampInt(index, 0, palette.length - 1));
}

function nearestPaletteIndex(color: string, palette: string[]): number {
  const [r, g, b] = rgbFromHex(color);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((candidate, index) => {
    const [cr, cg, cb] = rgbFromHex(candidate);
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function rgbFromHex(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function spriteMetadata(
  raw: string | undefined,
): { width: number; height: number; frameCount: number; fps: number } | null {
  if (!raw) {
    return null;
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const kind = lines[0];
  if (kind !== "CBI1" && kind !== "CBA1") {
    return null;
  }
  const header = (lines[1] || "").split(/\s+/).map(Number);
  const width = header[0] || 0;
  const height = header[1] || 0;
  const frameCount = kind === "CBA1" ? header[2] || 0 : 1;
  const fps = kind === "CBA1" ? header[3] || 0 : 0;
  const paletteSize = Number(lines[2] || 0);
  if (
    width <= 0 ||
    height <= 0 ||
    frameCount <= 0 ||
    paletteSize <= 0 ||
    paletteSize > 26
  ) {
    return null;
  }
  return { width, height, frameCount, fps };
}

function themeAssetPathForFile(
  name: string,
  extension: ".cba" | ".cbi" | ".gif",
): string {
  return `/themes/u/${safeAssetName(name, extension)}`;
}

function safeAssetName(name: string, extension: ".cba" | ".cbi" | ".gif"): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const withoutExtension = cleaned.replace(/\.[a-z0-9]+$/i, "");
  const withExtension = cleaned.endsWith(extension)
    ? cleaned
    : `${withoutExtension || "asset"}${extension}`;
  if (withExtension.length <= 21) {
    return withExtension;
  }
  const base = withExtension.slice(0, -extension.length);
  const maxBase = 21 - extension.length;
  return `${base.slice(0, maxBase).replace(/[._-]+$/g, "") || "asset"}${extension}`;
}

function isSpriteTextFile(file: File): boolean {
  return /\.(cbi|cba)$/i.test(file.name) || file.type === "text/plain";
}

async function fileToBase64(file: File): Promise<string> {
  return arrayBufferToBase64(await file.arrayBuffer());
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function themeAssetByteLength(asset: ThemeStudioAsset): number {
  if (asset.encoding === "text") {
    return new TextEncoder().encode(asset.data).byteLength;
  }
  return Math.floor((asset.data.replace(/=+$/, "").length * 3) / 4);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  return `${Math.round(value / 1024)} KB`;
}

function assetKind(path: string): "gif" | "sprite" | null {
  if (/\.gif$/i.test(path)) {
    return "gif";
  }
  if (/\.(cbi|cba)$/i.test(path)) {
    return "sprite";
  }
  return null;
}

function assetKindLabel(path: string): string {
  const kind = assetKind(path);
  return kind === "gif" ? "GIF" : kind === "sprite" ? "Sprite" : "Asset";
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
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

function assetFileName(path: string): string {
  return path.split("/").pop()?.trim() || "asset.bin";
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

function integerOrDefault(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function titleFromThemeId(themeId: string): string {
  return themeId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
