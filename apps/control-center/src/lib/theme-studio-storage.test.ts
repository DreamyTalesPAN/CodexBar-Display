import { describe, expect, it } from "vitest";
import {
  clearThemeStudioRecovery,
  loadThemeStudioRecovery,
  loadUserThemes,
  THEME_STUDIO_STORAGE_SCHEMA_VERSION,
  USER_THEMES_STORAGE_KEY,
  writeThemeStudioRecovery,
  writeUserThemes,
  type ThemeStudioRecovery,
  type ThemeStudioStorage,
  type UserThemeRecord,
} from "./theme-studio-storage";
import { THEME_STUDIO_DRAFT_STORAGE_KEY } from "./theme-studio";

class MemoryStorage implements ThemeStudioStorage {
  readonly values = new Map<string, string>();
  getError?: unknown;
  removeError?: unknown;
  setError?: unknown;

  getItem(key: string) {
    if (this.getError) {
      throw this.getError;
    }
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    if (this.removeError) {
      throw this.removeError;
    }
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.setError) {
      throw this.setError;
    }
    this.values.set(key, value);
  }
}

function record(overrides: Partial<UserThemeRecord> = {}): UserThemeRecord {
  return {
    document: {
      assets: {},
      packName: "My Theme",
      spec: {
        bgColor: "#000000",
        fallbackTheme: "mini",
        primitives: [{ color: "#FFFFFF", text: "Hi", type: "text", x: 1, y: 2 }],
        themeId: "my-theme",
        themeRev: 1,
        themeSpecVersion: 1,
      },
    },
    id: "my-theme",
    updatedAt: "2026-07-15T08:00:00.000Z",
    ...overrides,
  };
}

function recovery(): ThemeStudioRecovery {
  return {
    baseUpdatedAt: "2026-07-15T07:00:00.000Z",
    document: record().document,
    libraryId: "my-theme",
    source: "custom",
    updatedAt: "2026-07-15T08:30:00.000Z",
  };
}

describe("Theme Studio library storage", () => {
  it("migrates a complete legacy array to schema version 1", () => {
    const storage = new MemoryStorage();
    const theme = record();
    storage.values.set(
      USER_THEMES_STORAGE_KEY,
      JSON.stringify([
        {
          draft: {
            ...theme.document,
            savedAt: theme.updatedAt,
          },
          id: theme.id,
          updatedAt: theme.updatedAt,
        },
      ]),
    );

    const result = loadUserThemes(storage);

    expect(result).toMatchObject({
      ok: true,
      value: { migrated: true, themes: [{ id: "my-theme" }] },
    });
    expect(JSON.parse(storage.values.get(USER_THEMES_STORAGE_KEY)!)).toMatchObject({
      schemaVersion: THEME_STUDIO_STORAGE_SCHEMA_VERSION,
      themes: [{ document: { packName: "My Theme" }, id: "my-theme" }],
    });
  });

  it("does not overwrite partially invalid legacy data", () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([
      { draft: { packName: "Broken", savedAt: "now", spec: {} }, id: "broken" },
    ]);
    storage.values.set(USER_THEMES_STORAGE_KEY, raw);

    const result = loadUserThemes(storage);

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_data" } });
    expect(storage.values.get(USER_THEMES_STORAGE_KEY)).toBe(raw);
  });

  it("preserves invalid JSON and future schema versions", () => {
    const invalidStorage = new MemoryStorage();
    invalidStorage.values.set(USER_THEMES_STORAGE_KEY, "{not-json");
    expect(loadUserThemes(invalidStorage)).toMatchObject({
      ok: false,
      error: { code: "invalid_data" },
    });
    expect(invalidStorage.values.get(USER_THEMES_STORAGE_KEY)).toBe("{not-json");

    const futureStorage = new MemoryStorage();
    const future = JSON.stringify({ schemaVersion: 2, themes: [] });
    futureStorage.values.set(USER_THEMES_STORAGE_KEY, future);
    expect(loadUserThemes(futureStorage)).toMatchObject({
      ok: false,
      error: { code: "unsupported_version" },
    });
    expect(futureStorage.values.get(USER_THEMES_STORAGE_KEY)).toBe(future);
  });

  it("returns migrated themes but blocks mutation when migration cannot be written", () => {
    const storage = new MemoryStorage();
    const theme = record();
    storage.values.set(
      USER_THEMES_STORAGE_KEY,
      JSON.stringify([
        {
          draft: { ...theme.document, savedAt: theme.updatedAt },
          id: theme.id,
          updatedAt: theme.updatedAt,
        },
      ]),
    );
    storage.setError = new DOMException("full", "QuotaExceededError");

    const result = loadUserThemes(storage);

    expect(result).toMatchObject({
      data: { migrated: false, themes: [{ id: "my-theme" }] },
      error: { code: "write_failed" },
      ok: false,
    });
    if (!result.ok) {
      expect(result.error.message).toContain("storage is full");
    }
  });

  it("writes the complete versioned library or reports the storage error", () => {
    const storage = new MemoryStorage();
    expect(writeUserThemes([record()], storage)).toMatchObject({ ok: true });
    expect(JSON.parse(storage.values.get(USER_THEMES_STORAGE_KEY)!)).toMatchObject({
      schemaVersion: 1,
      themes: [{ id: "my-theme" }],
    });

    storage.setError = new DOMException("blocked", "SecurityError");
    const failed = writeUserThemes([record({ id: "other" })], storage);
    expect(failed).toMatchObject({ ok: false, error: { code: "write_failed" } });
    if (!failed.ok) {
      expect(failed.error.message).toContain("storage is blocked");
    }
  });
});

describe("Theme Studio recovery storage", () => {
  it("round-trips and clears a versioned recovery", () => {
    const storage = new MemoryStorage();
    expect(writeThemeStudioRecovery(recovery(), storage)).toMatchObject({ ok: true });
    expect(loadThemeStudioRecovery(storage)).toMatchObject({
      ok: true,
      value: { libraryId: "my-theme", source: "custom" },
    });
    expect(clearThemeStudioRecovery(storage)).toEqual({ ok: true, value: null });
    expect(loadThemeStudioRecovery(storage)).toEqual({ ok: true, value: null });
  });

  it("migrates the previous draft shape without silently opening it", () => {
    const storage = new MemoryStorage();
    const theme = record();
    storage.values.set(
      THEME_STUDIO_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...theme.document,
        savedAt: "2026-07-15T09:00:00.000Z",
      }),
    );

    const result = loadThemeStudioRecovery(storage);

    expect(result).toMatchObject({
      ok: true,
      value: { source: "blank", updatedAt: "2026-07-15T09:00:00.000Z" },
    });
    expect(JSON.parse(storage.values.get(THEME_STUDIO_DRAFT_STORAGE_KEY)!)).toMatchObject({
      schemaVersion: 1,
      recovery: { document: { packName: "My Theme" }, source: "blank" },
    });
  });

  it("keeps corrupt recovery data untouched and exposes clear failures", () => {
    const storage = new MemoryStorage();
    storage.values.set(THEME_STUDIO_DRAFT_STORAGE_KEY, "broken");
    expect(loadThemeStudioRecovery(storage)).toMatchObject({
      ok: false,
      error: { code: "invalid_data" },
    });
    expect(storage.values.get(THEME_STUDIO_DRAFT_STORAGE_KEY)).toBe("broken");

    storage.removeError = new Error("denied");
    expect(clearThemeStudioRecovery(storage)).toMatchObject({
      ok: false,
      error: { code: "delete_failed" },
    });
  });
});
