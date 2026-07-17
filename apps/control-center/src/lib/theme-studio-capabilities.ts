import {
  deviceThemeSpecJson,
  normalizeThemeSpec,
  type ThemeStudioAsset,
  type ThemeStudioPrimitiveType,
  type ThemeStudioSpec,
} from "./theme-studio";

export type ThemeStudioDeviceCapabilities = {
  supportsThemeSpecV1?: boolean;
  supportsStoredThemes?: boolean;
  maxThemeSpecBytes?: number;
  maxStoredThemeSpecBytes?: number;
  maxThemePrimitives?: number;
  maxThemeGifAssets?: number;
  maxThemeGifBytes?: number;
  maxThemeGifWidth?: number;
  maxThemeGifHeight?: number;
  maxThemeGifPixels?: number;
  maxThemeGifLzwBits?: number;
  supportedPrimitiveTypes?: string[];
  builtinThemes?: string[];
  displayWidthPx?: number;
  displayHeightPx?: number;
};

export type ThemeStudioCapabilityValidation = {
  errors: string[];
  warnings: string[];
  bytes: number;
  primitiveCount: number;
  gifAssetCount: number;
};

/**
 * Checks a structurally valid theme against the capabilities advertised by the
 * connected VibeTV. Missing optional limits are not treated as incompatibility;
 * the Companion performs the authoritative validation before installation.
 */
export function validateThemeAgainstCapabilities(
  spec: ThemeStudioSpec,
  assets: Record<string, ThemeStudioAsset>,
  caps: ThemeStudioDeviceCapabilities,
): ThemeStudioCapabilityValidation {
  const normalized = normalizeThemeSpec(spec);
  const errors: string[] = [];
  const warnings: string[] = [];
  // buildThemePack writes one trailing newline after the compact ThemeSpec.
  const bytes = new TextEncoder().encode(
    `${deviceThemeSpecJson(normalized)}\n`,
  ).byteLength;

  if (caps.supportsThemeSpecV1 === false) {
    errors.push("This VibeTV does not support ThemeSpec v1.");
  } else if (caps.supportsThemeSpecV1 === undefined) {
    warnings.push(
      "ThemeSpec support was not advertised and will be checked when sending.",
    );
  }

  if (caps.supportsStoredThemes === false) {
    errors.push("This VibeTV does not support stored themes.");
  }

  const storedSpecLimit = positiveLimit(caps.maxStoredThemeSpecBytes)
    ? caps.maxStoredThemeSpecBytes
    : caps.maxThemeSpecBytes;
  if (positiveLimit(storedSpecLimit) && bytes > storedSpecLimit) {
    errors.push(
      `Theme file exceeds this VibeTV's stored-theme limit: ${bytes}/${storedSpecLimit} bytes.`,
    );
  }

  if (
    positiveLimit(caps.maxThemePrimitives) &&
    normalized.primitives.length > caps.maxThemePrimitives
  ) {
    errors.push(
      `Too many elements for this VibeTV: ${normalized.primitives.length}/${caps.maxThemePrimitives}.`,
    );
  }

  const supportedTypes = normalizePrimitiveTypes(
    caps.supportedPrimitiveTypes,
  );
  if (supportedTypes.size > 0) {
    normalized.primitives.forEach((primitive, index) => {
      if (!supportedTypes.has(primitive.type)) {
        errors.push(
          `Element ${index + 1}: type ${primitive.type} is not supported by this VibeTV.`,
        );
      }
    });
  }

  normalized.primitives.forEach((primitive, index) => {
    validateDisplayBounds(
      primitive,
      index,
      caps.displayWidthPx,
      caps.displayHeightPx,
      errors,
    );
  });

  const gifPaths = referencedGifAssetPaths(normalized);
  if (
    positiveLimit(caps.maxThemeGifAssets) &&
    gifPaths.length > caps.maxThemeGifAssets
  ) {
    errors.push(
      `Too many GIF assets for this VibeTV: ${gifPaths.length}/${caps.maxThemeGifAssets}.`,
    );
  }

  normalized.primitives.forEach((primitive, index) => {
    if (primitive.type !== "gif") {
      return;
    }
    const width = primitive.width ?? 0;
    const height = primitive.height ?? 0;
    if (positiveLimit(caps.maxThemeGifWidth) && width > caps.maxThemeGifWidth) {
      errors.push(
        `Element ${index + 1}: GIF width exceeds this VibeTV's limit: ${width}/${caps.maxThemeGifWidth}.`,
      );
    }
    if (
      positiveLimit(caps.maxThemeGifHeight) &&
      height > caps.maxThemeGifHeight
    ) {
      errors.push(
        `Element ${index + 1}: GIF height exceeds this VibeTV's limit: ${height}/${caps.maxThemeGifHeight}.`,
      );
    }
    if (
      positiveLimit(caps.maxThemeGifPixels) &&
      width * height > caps.maxThemeGifPixels
    ) {
      errors.push(
        `Element ${index + 1}: GIF area exceeds this VibeTV's limit: ${width * height}/${caps.maxThemeGifPixels} pixels.`,
      );
    }
  });

  if (positiveLimit(caps.maxThemeGifBytes)) {
    for (const assetPath of gifPaths) {
      const asset = assets[assetPath];
      if (!asset) {
        warnings.push(
          `${assetPath} is not loaded, so its device size cannot be checked yet.`,
        );
        continue;
      }
      const assetBytes = themeAssetByteLength(asset);
      if (assetBytes > caps.maxThemeGifBytes) {
        errors.push(
          `${assetPath} exceeds this VibeTV's GIF limit: ${assetBytes}/${caps.maxThemeGifBytes} bytes.`,
        );
      }
    }
  }

  return {
    errors,
    warnings,
    bytes,
    primitiveCount: normalized.primitives.length,
    gifAssetCount: gifPaths.length,
  };
}

function positiveLimit(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizePrimitiveTypes(
  values: string[] | undefined,
): Set<ThemeStudioPrimitiveType> {
  const aliases: Record<string, ThemeStudioPrimitiveType> = {
    g: "gif",
    image: "sprite",
    img: "sprite",
    p: "progress",
    px: "pixels",
    r: "rect",
    rectangle: "rect",
    sp: "sprite",
    tx: "text",
  };
  return new Set(
    (values || [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map(
        (value) =>
          aliases[value] || (value as ThemeStudioPrimitiveType),
      ),
  );
}

function validateDisplayBounds(
  primitive: ThemeStudioSpec["primitives"][number],
  index: number,
  displayWidth: number | undefined,
  displayHeight: number | undefined,
  errors: string[],
) {
  const prefix = `Element ${index + 1}`;
  if (positiveLimit(displayWidth)) {
    if (primitive.x < 0 || primitive.x >= displayWidth) {
      errors.push(
        `${prefix}: x=${primitive.x} is outside this VibeTV's ${displayWidth}px display.`,
      );
    } else if (
      primitive.width !== undefined &&
      primitive.x + primitive.width > displayWidth
    ) {
      errors.push(
        `${prefix}: right edge is outside this VibeTV's ${displayWidth}px display.`,
      );
    }
  }
  if (positiveLimit(displayHeight)) {
    if (primitive.y < 0 || primitive.y >= displayHeight) {
      errors.push(
        `${prefix}: y=${primitive.y} is outside this VibeTV's ${displayHeight}px display.`,
      );
    } else if (
      primitive.height !== undefined &&
      primitive.y + primitive.height > displayHeight
    ) {
      errors.push(
        `${prefix}: bottom edge is outside this VibeTV's ${displayHeight}px display.`,
      );
    }
  }
}

function referencedGifAssetPaths(spec: ThemeStudioSpec): string[] {
  const paths = new Set<string>();
  for (const primitive of spec.primitives) {
    if (primitive.type !== "gif") {
      continue;
    }
    if (primitive.assetPath) {
      paths.add(primitive.assetPath);
    }
    for (const assetPath of Object.values(primitive.stateAssets || {})) {
      if (assetPath) {
        paths.add(assetPath);
      }
    }
  }
  return [...paths];
}

function themeAssetByteLength(asset: ThemeStudioAsset): number {
  if (asset.encoding === "text") {
    return new TextEncoder().encode(asset.data).byteLength;
  }
  const compact = asset.data.replace(/\s+/g, "");
  if (compact.length === 0) {
    return 0;
  }
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}
