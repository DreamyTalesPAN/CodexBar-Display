import {
  loadThemeStudioRecovery,
  loadUserThemes,
  type ThemeStudioDocument,
  type ThemeStudioStorage,
} from "./theme-studio-storage";
import { validateThemeSpec } from "./theme-studio";

export type LocalThemeRenderPack = {
  assets: ThemeStudioDocument["assets"];
  name: string;
  ok: true;
  spec: ThemeStudioDocument["spec"];
  specPath: string;
  themeId: string;
};

export function loadLocalThemeRenderPack(
  themeId: string,
  activeThemeSpecPath: string | undefined,
  storage?: ThemeStudioStorage | null,
): LocalThemeRenderPack | null {
  const recoveryResult =
    storage === undefined
      ? loadThemeStudioRecovery()
      : loadThemeStudioRecovery(storage);
  const themesResult =
    storage === undefined ? loadUserThemes() : loadUserThemes(storage);
  const recovery = recoveryResult.ok
    ? recoveryResult.value
    : recoveryResult.data || null;
  const themes = themesResult.ok
    ? themesResult.value.themes
    : themesResult.data?.themes || [];
  const documents = [
    ...(recovery ? [recovery.document] : []),
    ...themes.map((theme) => theme.document),
  ];
  const normalizedThemeId = normalizeThemeId(themeId);
  const normalizedSpecPath = normalizeSpecPath(activeThemeSpecPath);

  for (const document of documents) {
    if (normalizeThemeId(document.spec.themeId) !== normalizedThemeId) {
      continue;
    }
    const validation = validateThemeSpec(document.spec, document.assets);
    if (validation.errors.length > 0) {
      continue;
    }
    if (
      normalizedSpecPath &&
      normalizeSpecPath(validation.themeSpecPath) !== normalizedSpecPath
    ) {
      continue;
    }
    return {
      assets: document.assets,
      name: document.packName,
      ok: true,
      spec: document.spec,
      specPath: validation.themeSpecPath,
      themeId: document.spec.themeId,
    };
  }
  return null;
}

function normalizeThemeId(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeSpecPath(value: string | undefined): string {
  return (value || "").trim();
}
