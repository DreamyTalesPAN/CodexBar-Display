import { buildThemePack, type ThemeStudioAsset, type ThemeStudioSpec } from "./theme-studio";

type StoredCustomThemePack = {
  createdAt: number;
  fileName: string;
  name: string;
  themeId: string;
  token: string;
  zipBytes: Uint8Array;
};

type CustomThemePackStoreGlobal = typeof globalThis & {
  __vibetvCustomThemePacks?: Map<string, StoredCustomThemePack>;
};

const MAX_PACK_AGE_MS = 60 * 60 * 1000;

export function storeCustomThemePack({
  assets,
  packName,
  spec,
}: {
  assets?: Record<string, ThemeStudioAsset>;
  packName: string;
  spec: ThemeStudioSpec;
}) {
  const pack = buildThemePack(spec, packName, assets || {});
  const token = crypto.randomUUID();
  const id = crypto.randomUUID();
  const store = customThemePackStore();
  cleanupCustomThemePacks(store);
  store.set(id, {
    createdAt: Date.now(),
    fileName: pack.fileName,
    name: pack.manifest.name,
    themeId: pack.manifest.id,
    token,
    zipBytes: pack.zipBytes,
  });
  return {
    fileName: pack.fileName,
    id,
    name: pack.manifest.name,
    themeId: pack.manifest.id,
    token,
  };
}

export function readCustomThemePack(id: string, token: string) {
  const store = customThemePackStore();
  cleanupCustomThemePacks(store);
  const pack = store.get(id);
  if (!pack || pack.token !== token) {
    return null;
  }
  return pack;
}

function customThemePackStore() {
  const root = globalThis as CustomThemePackStoreGlobal;
  root.__vibetvCustomThemePacks ??= new Map();
  return root.__vibetvCustomThemePacks;
}

function cleanupCustomThemePacks(store: Map<string, StoredCustomThemePack>) {
  const expiresBefore = Date.now() - MAX_PACK_AGE_MS;
  for (const [id, pack] of store) {
    if (pack.createdAt < expiresBefore) {
      store.delete(id);
    }
  }
}
