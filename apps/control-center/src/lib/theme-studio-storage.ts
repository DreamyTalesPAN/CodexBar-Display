import {
  importThemeSpec,
  normalizeThemeSpec,
  THEME_STUDIO_DRAFT_STORAGE_KEY,
  type ThemeStudioAsset,
  type ThemeStudioSpec,
} from "./theme-studio";

export const USER_THEMES_STORAGE_KEY = "vibetv.controlCenter.userThemes";
export const THEME_STUDIO_STORAGE_SCHEMA_VERSION = 1 as const;

export type ThemeStudioDocument = {
  assets: Record<string, ThemeStudioAsset>;
  packName: string;
  spec: ThemeStudioSpec;
};

export type UserThemeRecord = {
  document: ThemeStudioDocument;
  id: string;
  originThemeId?: string;
  updatedAt: string;
};

export type StoredThemeLibraryV1 = {
  schemaVersion: typeof THEME_STUDIO_STORAGE_SCHEMA_VERSION;
  themes: UserThemeRecord[];
};

export type ThemeStudioRecoverySource = "blank" | "custom" | "published";

export type ThemeStudioRecovery = {
  baseUpdatedAt?: string;
  document: ThemeStudioDocument;
  libraryId?: string;
  originThemeId?: string;
  source: ThemeStudioRecoverySource;
  updatedAt: string;
};

export type StoredRecoveryV1 = {
  recovery: ThemeStudioRecovery;
  schemaVersion: typeof THEME_STUDIO_STORAGE_SCHEMA_VERSION;
};

export type ThemeStudioStorageErrorCode =
  | "storage_unavailable"
  | "read_failed"
  | "invalid_data"
  | "unsupported_version"
  | "write_failed"
  | "delete_failed";

export type ThemeStudioStorageError = {
  code: ThemeStudioStorageErrorCode;
  message: string;
};

export type StorageResult<T> =
  | { ok: true; value: T }
  | { data?: T; error: ThemeStudioStorageError; ok: false };

export type LoadedUserThemes = {
  migrated: boolean;
  themes: UserThemeRecord[];
};

export type ThemeStudioStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export function loadUserThemes(
  storage: ThemeStudioStorage | null = browserStorage(),
): StorageResult<LoadedUserThemes> {
  if (!storage) {
    return storageUnavailable<LoadedUserThemes>();
  }

  let raw: string | null;
  try {
    raw = storage.getItem(USER_THEMES_STORAGE_KEY);
  } catch (error) {
    return storageFailure(
      "read_failed",
      "Saved themes could not be read from this browser.",
      error,
    );
  }
  if (!raw) {
    return { ok: true, value: { migrated: false, themes: [] } };
  }

  const parsed = parseJson(raw);
  if (!parsed.ok) {
    return invalidStorageData<LoadedUserThemes>(
      "Saved themes contain invalid data. The original data was left unchanged.",
    );
  }

  if (Array.isArray(parsed.value)) {
    const themes = readThemeRecords(parsed.value, true);
    if (!themes) {
      return invalidStorageData<LoadedUserThemes>(
        "Saved themes contain an incomplete legacy record. The original data was left unchanged.",
      );
    }
    const migrated: StoredThemeLibraryV1 = {
      schemaVersion: THEME_STUDIO_STORAGE_SCHEMA_VERSION,
      themes,
    };
    const writeResult = writeJson(storage, USER_THEMES_STORAGE_KEY, migrated);
    if (!writeResult.ok) {
      return {
        data: { migrated: false, themes },
        error: writeResult.error,
        ok: false,
      };
    }
    return { ok: true, value: { migrated: true, themes } };
  }

  if (!isRecord(parsed.value)) {
    return invalidStorageData<LoadedUserThemes>(
      "Saved themes use an invalid format. The original data was left unchanged.",
    );
  }
  if (parsed.value.schemaVersion !== THEME_STUDIO_STORAGE_SCHEMA_VERSION) {
    return {
      error: {
        code: "unsupported_version",
        message:
          "Saved themes were created by a newer app version. Update the app before editing them.",
      },
      ok: false,
    };
  }
  if (!Array.isArray(parsed.value.themes)) {
    return invalidStorageData<LoadedUserThemes>(
      "Saved themes use an invalid format. The original data was left unchanged.",
    );
  }
  const themes = readThemeRecords(parsed.value.themes, false);
  if (!themes) {
    return invalidStorageData<LoadedUserThemes>(
      "Saved themes contain an incomplete record. The original data was left unchanged.",
    );
  }
  return { ok: true, value: { migrated: false, themes } };
}

export function writeUserThemes(
  themes: UserThemeRecord[],
  storage: ThemeStudioStorage | null = browserStorage(),
): StorageResult<StoredThemeLibraryV1> {
  if (!storage) {
    return storageUnavailable<StoredThemeLibraryV1>();
  }
  const checked = readThemeRecords(themes, false);
  if (!checked) {
    return invalidStorageData<StoredThemeLibraryV1>(
      "The theme library contains invalid data and was not saved.",
    );
  }
  const value: StoredThemeLibraryV1 = {
    schemaVersion: THEME_STUDIO_STORAGE_SCHEMA_VERSION,
    themes: checked,
  };
  const result = writeJson(storage, USER_THEMES_STORAGE_KEY, value);
  return result.ok ? { ok: true, value } : result;
}

export function loadThemeStudioRecovery(
  storage: ThemeStudioStorage | null = browserStorage(),
): StorageResult<ThemeStudioRecovery | null> {
  if (!storage) {
    return storageUnavailable<ThemeStudioRecovery | null>();
  }
  let raw: string | null;
  try {
    raw = storage.getItem(THEME_STUDIO_DRAFT_STORAGE_KEY);
  } catch (error) {
    return storageFailure(
      "read_failed",
      "Theme recovery could not be read from this browser.",
      error,
    );
  }
  if (!raw) {
    return { ok: true, value: null };
  }
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    return invalidStorageData<ThemeStudioRecovery | null>(
      "Theme recovery contains invalid data. The original data was left unchanged.",
    );
  }

  if (isLegacyDraft(parsed.value)) {
    const document = readDocument(parsed.value);
    if (!document) {
      return invalidStorageData<ThemeStudioRecovery | null>(
        "Theme recovery contains invalid data. The original data was left unchanged.",
      );
    }
    const recovery: ThemeStudioRecovery = {
      document,
      source: "blank",
      updatedAt: parsed.value.savedAt,
    };
    const migrated = writeThemeStudioRecovery(recovery, storage);
    if (!migrated.ok) {
      return { data: recovery, error: migrated.error, ok: false };
    }
    return { ok: true, value: recovery };
  }

  if (!isRecord(parsed.value)) {
    return invalidStorageData<ThemeStudioRecovery | null>(
      "Theme recovery uses an invalid format. The original data was left unchanged.",
    );
  }
  if (parsed.value.schemaVersion !== THEME_STUDIO_STORAGE_SCHEMA_VERSION) {
    return {
      error: {
        code: "unsupported_version",
        message:
          "Theme recovery was created by a newer app version. Update the app before resuming it.",
      },
      ok: false,
    };
  }
  const recovery = readRecovery(parsed.value.recovery);
  if (!recovery) {
    return invalidStorageData<ThemeStudioRecovery | null>(
      "Theme recovery contains invalid data. The original data was left unchanged.",
    );
  }
  return { ok: true, value: recovery };
}

export function writeThemeStudioRecovery(
  recovery: ThemeStudioRecovery,
  storage: ThemeStudioStorage | null = browserStorage(),
): StorageResult<StoredRecoveryV1> {
  if (!storage) {
    return storageUnavailable<StoredRecoveryV1>();
  }
  const checked = readRecovery(recovery);
  if (!checked) {
    return invalidStorageData<StoredRecoveryV1>(
      "The theme recovery contains invalid data and was not saved.",
    );
  }
  const value: StoredRecoveryV1 = {
    recovery: checked,
    schemaVersion: THEME_STUDIO_STORAGE_SCHEMA_VERSION,
  };
  const result = writeJson(storage, THEME_STUDIO_DRAFT_STORAGE_KEY, value);
  return result.ok ? { ok: true, value } : result;
}

export function clearThemeStudioRecovery(
  storage: ThemeStudioStorage | null = browserStorage(),
): StorageResult<null> {
  if (!storage) {
    return storageUnavailable<null>();
  }
  try {
    storage.removeItem(THEME_STUDIO_DRAFT_STORAGE_KEY);
    return { ok: true, value: null };
  } catch (error) {
    return storageFailure(
      "delete_failed",
      "Theme recovery could not be discarded.",
      error,
    );
  }
}

function readThemeRecords(
  values: unknown[],
  legacy: boolean,
): UserThemeRecord[] | null {
  const themes: UserThemeRecord[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    const theme = readThemeRecord(value, legacy);
    if (!theme || ids.has(theme.id)) {
      return null;
    }
    ids.add(theme.id);
    themes.push(theme);
  }
  return themes;
}

function readThemeRecord(value: unknown, legacy: boolean): UserThemeRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawDocument = legacy ? value.draft : value.document;
  const document = readDocument(rawDocument);
  if (!document) {
    return null;
  }
  const legacySavedAt =
    legacy && isRecord(value.draft) && typeof value.draft.savedAt === "string"
      ? value.draft.savedAt
      : "";
  const id = readNonEmptyString(value.id) || document.spec.themeId;
  const updatedAt = readNonEmptyString(value.updatedAt) || legacySavedAt;
  if (!id || !updatedAt) {
    return null;
  }
  const originThemeId = optionalString(value.originThemeId);
  if (originThemeId === null) {
    return null;
  }
  return {
    document,
    id,
    ...(originThemeId ? { originThemeId } : {}),
    updatedAt,
  };
}

function readDocument(value: unknown): ThemeStudioDocument | null {
  if (!isRecord(value) || typeof value.packName !== "string") {
    return null;
  }
  const packName = value.packName.trim();
  if (!packName || !isRecord(value.spec) || !Array.isArray(value.spec.primitives)) {
    return null;
  }
  const assets = readAssets(value.assets);
  if (!assets) {
    return null;
  }
  try {
    return {
      assets,
      packName,
      spec: normalizeThemeSpec(importThemeSpec(value.spec)),
    };
  } catch {
    return null;
  }
}

function readRecovery(value: unknown): ThemeStudioRecovery | null {
  if (!isRecord(value)) {
    return null;
  }
  const document = readDocument(value.document);
  const updatedAt = readNonEmptyString(value.updatedAt);
  if (!document || !updatedAt || !isRecoverySource(value.source)) {
    return null;
  }
  const libraryId = optionalString(value.libraryId);
  const originThemeId = optionalString(value.originThemeId);
  const baseUpdatedAt = optionalString(value.baseUpdatedAt);
  if (libraryId === null || originThemeId === null || baseUpdatedAt === null) {
    return null;
  }
  return {
    ...(baseUpdatedAt ? { baseUpdatedAt } : {}),
    document,
    ...(libraryId ? { libraryId } : {}),
    ...(originThemeId ? { originThemeId } : {}),
    source: value.source,
    updatedAt,
  };
}

function readAssets(value: unknown): Record<string, ThemeStudioAsset> | null {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return null;
  }
  const assets: Record<string, ThemeStudioAsset> = {};
  for (const [path, rawAsset] of Object.entries(value)) {
    if (
      !path.trim() ||
      !isRecord(rawAsset) ||
      typeof rawAsset.contentType !== "string" ||
      typeof rawAsset.data !== "string" ||
      (rawAsset.encoding !== "base64" && rawAsset.encoding !== "text")
    ) {
      return null;
    }
    assets[path] = {
      contentType: rawAsset.contentType,
      data: rawAsset.data,
      encoding: rawAsset.encoding,
    };
  }
  return assets;
}

function isLegacyDraft(value: unknown): value is {
  assets?: unknown;
  packName: string;
  savedAt: string;
  spec: unknown;
} {
  return (
    isRecord(value) &&
    typeof value.packName === "string" &&
    typeof value.savedAt === "string" &&
    isRecord(value.spec)
  );
}

function isRecoverySource(value: unknown): value is ThemeStudioRecoverySource {
  return value === "blank" || value === "custom" || value === "published";
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function writeJson<T>(
  storage: ThemeStudioStorage,
  key: string,
  value: T,
): StorageResult<T> {
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true, value };
  } catch (error) {
    return storageFailure(
      "write_failed",
      storageWriteMessage(error),
      error,
    );
  }
}

function parseJson(raw: string): StorageResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return storageFailure(
      "invalid_data",
      "Stored Theme Studio data is not valid JSON.",
      error,
    );
  }
}

function invalidStorageData<T>(message: string): StorageResult<T> {
  return { error: { code: "invalid_data", message }, ok: false };
}

function storageUnavailable<T>(): StorageResult<T> {
  return {
    error: {
      code: "storage_unavailable",
      message: "Browser storage is unavailable. Themes cannot be saved safely.",
    },
    ok: false,
  };
}

function storageFailure<T>(
  code: ThemeStudioStorageErrorCode,
  message: string,
  _cause: unknown,
): StorageResult<T> {
  void _cause;
  return { error: { code, message }, ok: false };
}

function storageWriteMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "Browser storage is full. Remove unused themes or assets, then try again.";
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return "Browser storage is blocked. Allow local storage before saving themes.";
  }
  return "Theme data could not be saved to this browser.";
}

function browserStorage(): ThemeStudioStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
