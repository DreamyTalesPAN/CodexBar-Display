"use client";

import type { ThemeStudioAsset, ThemeStudioSpec, ThemeStudioUsage } from "@/lib/theme-studio";
import type { ThemeStudioDeviceCapabilities } from "@/lib/theme-studio-capabilities";
import type { ThemeStudioDocument } from "./theme-studio/theme-studio-editor-state";
import type { ThemeInstallStatus } from "./theme-library-screen";

export { AIThemeStudioScreen as ThemeStudioScreen } from "./theme-studio/ai-theme-studio-screen";

export type ThemeStudioEditorSource = "blank" | "custom" | "published";

export type ThemeStudioEditorTheme = {
  assets?: Record<string, ThemeStudioAsset>;
  libraryId?: string;
  packName: string;
  recovered?: boolean;
  source: ThemeStudioEditorSource;
  spec: ThemeStudioSpec;
  usage?: ThemeStudioUsage;
};

export type ThemeStudioSavePayload = {
  assets: Record<string, ThemeStudioAsset>;
  libraryId?: string;
  packName: string;
  source: ThemeStudioEditorSource;
  spec: ThemeStudioSpec;
  usage?: ThemeStudioUsage;
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
  usage?: ThemeStudioUsage;
};

export type ThemeStudioScreenProps = {
  installStatus?: ThemeInstallStatus | null;
  deviceCapabilities?: ThemeStudioDeviceCapabilities;
  initialTheme?: ThemeStudioEditorTheme;
  onBackToLibrary?: () => void;
  onInstallTheme?: (payload: ThemeStudioInstallPayload) => Promise<boolean>;
  onSaveToLibrary?: (
    payload: ThemeStudioSavePayload,
  ) => Promise<ThemeStudioSaveResult>;
  saveBlockedReason?: string;
  /** The app runs on Windows, where "Mac App" reads "app". */
  windowsHost?: boolean;
};

export function clearRetiredAiThemeStorage() {
  try {
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith("vibetv.controlCenter.aiTheme"));
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch { /* Storage may be unavailable. */ }
}
