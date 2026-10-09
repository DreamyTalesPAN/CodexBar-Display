import { referencedThemeAssetPaths, type ThemeStudioPrimitive } from "./theme-studio";
import { usageSectionIndices } from "@/components/theme-studio/design-controls";
import { decodeSprite } from "@/components/live-vibetv-preview";
import {
  applySceneMotion,
  removeSceneMotion,
  sceneMotionPlan,
  sceneMotionEffect,
} from "./ai-scene-motion";
import {
  cloneDocument,
  type ThemeStudioDocument,
} from "@/components/theme-studio/theme-studio-editor-state";
import {
  AI_THEME_ANIMATION_ASSET_PATH as ANIMATION,
  AI_THEME_SCREENMASTER_ASSET_PATH as ART,
  AI_THEME_SCENE_LOOP_ASSET_PATH as LOOP,
  encodeAIThemeCBA1,
  isAttachedSceneAnimation,
  isCompanionSprite,
  type AIThemeCompanion,
  type AIThemeCandidate,
  type AIThemeConcept,
} from "./ai-theme";

// Merge only generated layers. Manual labels, positions, removed layers and
// custom assets belong to the document, not to a stale AI conversation.
export function applyAIThemeCandidate(
  current: ThemeStudioDocument,
  candidate: AIThemeCandidate,
  target: "scene" | "animation" | "auto",
): ThemeStudioDocument {
  // A new design in the app starts as one display-filling backdrop. Drawn on
  // top of the scene it would hide the whole picture, so it counts as empty.
  const untouched = current.spec.primitives.every(
    (p) => p.type === "rect" && p.x === 0 && p.y === 0 && p.width === 240 && p.height === 240 && !p.binding,
  );
  if (untouched)
    return {
      assets: candidate.assets,
      spec: candidate.spec,
      packName: candidate.packName,
      usage: current.usage,
    };
  const next = cloneDocument(current);
  if (target === "auto") {
    const managed = (path?: string) =>
      path === ART || path === ANIMATION || isAttachedSceneAnimation(path) || isCompanionSprite(path);
    const artwork = current.spec.primitives.find((p) => p.assetPath === ART);
    const oldCharacter = current.spec.primitives.find(
      (p) => p.assetPath === ANIMATION,
    );
    // Only an attached scene loop dictates the artwork rectangle; independent
    // companion sprites leave manually placed artwork where the customer put it.
    const hasLoop = candidate.spec.primitives.some((p) => p.assetPath === LOOP);
    const incomingArt = candidate.spec.primitives.find((p) => p.assetPath === ART);
    // Fullscreen changes the picture geometry, not the customer's other layers.
    const drawnHeight = (assets: Record<string, { data: string }>) => Number(assets[ART]?.data.split("\n", 2)[1]?.split(" ")[1]);
    const layoutChanged = Boolean(artwork && incomingArt && !candidate.preserveArtwork &&
      (drawnHeight(candidate.assets) === 240) !== (drawnHeight(current.assets) === 240));
    const keepsPlace = Boolean(artwork && incomingArt && !hasLoop && !layoutChanged);
    const usage = new Set(usageSectionIndices(current.spec.primitives).flat());
    const dropped = candidate.hideUsage ? usage : new Set<number>();
    // Only the unchanged standard readout panel belongs to the template.
    const isPanelShape = (p: ThemeStudioPrimitive) => p.type === "rect" && p.x === 0 && p.y === 128 &&
      p.width === 240 && p.height === 112;
    const isPanel = (p: ThemeStudioPrimitive) => isPanelShape(p) && p.borderRadius === 0 &&
      p.color === p.bgColor && p.color === p.borderColor && !p.binding;
    for (const path of Object.keys(next.assets))
      if (managed(path)) delete next.assets[path];
    const generated = candidate.spec.primitives
      .filter((p) => managed(p.assetPath))
      .map((p) => {
        if (p.assetPath === ART && artwork && keepsPlace)
          return {
            ...p,
            x: artwork.x,
            y: artwork.y,
            width: artwork.width,
            height: artwork.height,
          };
        // Companion positions arrive relative to the picture at its default
        // place; follow the picture to where the customer put it.
        if (isCompanionSprite(p.assetPath) && keepsPlace) {
          const placed = { ...p, x: p.x + artwork!.x - incomingArt!.x, y: p.y + artwork!.y - incomingArt!.y };
          // A companion the customer put beside the picture was described to
          // the helper at the nearest spot on it. When the helper left it
          // there, it stays where the customer put it.
          const old = current.spec.primitives.find((q) => q.assetPath === p.assetPath);
          const described = old && onPicture(old, artwork!);
          return old && described && described.x + artwork!.x === placed.x && described.y + artwork!.y === placed.y && (old.width || 0) === placed.width
            ? { ...placed, x: old.x, y: old.y }
            : placed;
        }
        if (p.assetPath === ANIMATION && oldCharacter && !layoutChanged)
          return {
            ...p,
            x: oldCharacter.x,
            y: oldCharacter.y,
            width: oldCharacter.width,
            height: oldCharacter.height,
          };
        return { ...p };
      });
    // Replace existing artwork in place, keeping manual elements interleaved
    // with both figures and usage readouts. Only newly added layers need a slot.
    const oldPaths = new Set(current.spec.primitives.filter((p) => managed(p.assetPath)).map((p) => p.assetPath));
    const newLayers = generated.filter((p) => !oldPaths.has(p.assetPath));
    next.spec.primitives = next.spec.primitives.flatMap((p, i) => {
      if (dropped.has(i) || (layoutChanged && isPanel(p))) return [];
      if (!managed(p.assetPath)) return [p];
      let replacement = generated.find((q) => q.assetPath === p.assetPath);
      // An animation can become companions (or a scene loop) with new paths.
      // Use its old layer for the replacement rather than moving it past text.
      if (!replacement && p.assetPath !== ART) {
        const animation = newLayers.findIndex((q) => q.assetPath !== ART);
        if (animation >= 0) replacement = newLayers.splice(animation, 1)[0];
      }
      return replacement ? [replacement] : [];
    });
    next.spec.primitives.splice(next.spec.primitives.findLastIndex((p) => managed(p.assetPath)) + 1, 0, ...newLayers);
    if (layoutChanged && usage.size > 0 && !candidate.hideUsage) {
      const panel = candidate.spec.primitives.find(isPanel);
      // This is a background, so it must stay below every retained customer layer.
      if (panel && !next.spec.primitives.some(isPanelShape)) next.spec.primitives.unshift({ ...panel });
    }
    // A design without readouts that is asked to show usage again gets the
    // standard readouts of the new scene; one that has them keeps its own.
    if (candidate.showUsage && usageSectionIndices(current.spec.primitives).flat().length === 0)
      next.spec.primitives.push(...candidate.spec.primitives.filter((p) => !managed(p.assetPath)).map((p) => ({ ...p })));
    Object.assign(next.assets, candidate.assets);
    if (candidate.preserveArtwork && current.assets[ART]) next.assets[ART] = {...current.assets[ART]};
    for (const path of candidate.retainedCompanions || []) {
      if (current.assets[path]) {
        next.assets[path] = {...current.assets[path]};
        setAIAnimationSpeed(next,path,next.spec.primitives.find(p=>p.assetPath===path)?.fps ?? 4);
      }
    }
    next.spec.bgColor = candidate.spec.bgColor;
    return next;
  }
  const motion = sceneMotionPlan(current);
  const motionFPS =
    current.spec.primitives.find((p) => sceneMotionEffect(p.assetPath))?.fps ||
    4;
  // Never leave stale pixels over new artwork. Rebuild an attached loop from
  // the new picture, unless an independent animation replaces it.
  removeSceneMotion(next);
  const paths = target === "animation" ? [ANIMATION] : [ART, ANIMATION];
  for (const path of paths) {
    const incoming = candidate.spec.primitives.find(
      (p) => p.assetPath === path,
    );
    const existing = next.spec.primitives.findIndex(
      (p) => p.assetPath === path,
    );
    if (!incoming) {
      if (path === ANIMATION && existing >= 0)
        next.spec.primitives.splice(existing, 1);
      delete next.assets[path];
      continue;
    }
    next.assets[path] = candidate.assets[path];
    if (existing >= 0) {
      next.spec.primitives[existing] = {
        ...incoming,
        ...next.spec.primitives[existing],
        frameCount: incoming.frameCount,
      };
      if (path === ANIMATION)
        setAIAnimationSpeed(
          next,
          path,
          next.spec.primitives[existing].fps || 4,
        );
    } else if (path === ART) next.spec.primitives.unshift({ ...incoming });
    else
      next.spec.primitives.splice(
        Math.max(
          0,
          next.spec.primitives.findIndex((p) => p.assetPath === ART) + 1,
        ),
        0,
        { ...incoming },
      );
  }
  if (target === "scene") next.spec.bgColor = candidate.spec.bgColor;
  return motion &&
    !candidate.spec.primitives.some((p) => p.assetPath === ANIMATION)
    ? applySceneMotion(next, motion, false, motionFPS)
    : next;
}

export function setAIAnimationSpeed(
  document: ThemeStudioDocument,
  path: string,
  fps: number,
) {
  if (![0, 1, 2, 4, 8].includes(fps)) return;
  const asset = document.assets[path];
  if (!asset || asset.encoding !== "text" || !asset.data.startsWith("CBA1\n"))
    return;
  const lines = asset.data.split("\n"),
    header = lines[1].split(/\s+/);
  header[3] = String(fps);
  lines[1] = header.join(" ");
  document.assets[path] = { ...asset, data: lines.join("\n") };
  document.spec.primitives.forEach((p) => {
    if (p.assetPath === path) p.fps = fps;
  });
}

// A design made in the old editor, imported or built in has its picture under
// its own file name. For the helper that picture is the design's picture like
// any generated one: it is shown to the helper as the current picture and the
// redrawn picture takes its place, layer and size. The selected still image
// wins; otherwise the largest still image at least half the display wide.
export function adoptPicture(document: ThemeStudioDocument, selected: number[] = []): ThemeStudioDocument {
  if (document.spec.primitives.some((p) => p.assetPath === ART)) return document;
  const still = (i: number) => {
    const p = document.spec.primitives[i];
    if (!p?.assetPath || p.assetPath === ANIMATION || isCompanionSprite(p.assetPath) || isAttachedSceneAnimation(p.assetPath)) return 0;
    const sprite = decodeSprite(document.assets[p.assetPath]?.data || "");
    if (!sprite || sprite.frames.length !== 1) return 0;
    return (p.width || sprite.width) * (p.height || sprite.height);
  };
  let index = selected.find((i) => still(i) > 0) ?? -1;
  if (index < 0)
    document.spec.primitives.forEach((p, i) => {
      if (still(i) > (index < 0 ? 0 : still(index)) && (p.width || decodeSprite(document.assets[p.assetPath!].data)!.width) >= 120) index = i;
    });
  if (index < 0) return document;
  const next = cloneDocument(document);
  const picture = next.spec.primitives[index];
  const sprite = decodeSprite(next.assets[picture.assetPath!].data)!;
  next.assets[ART] = { ...next.assets[picture.assetPath!] };
  picture.width ||= sprite.width;
  picture.height ||= sprite.height;
  picture.assetPath = ART;
  return next;
}

// Reconstruct references from the current saved/undone document, never from a
// Where a companion is for the helper: relative to the picture and on it.
function onPicture(p: { x: number; y: number; width?: number }, picture: { x: number; y: number; height?: number }) {
  const size = p.width || 48;
  return {
    x: Math.max(0, Math.min(p.x - picture.x, 240 - size)),
    y: Math.max(0, Math.min(p.y - picture.y, (picture.height || 128) - size)),
  };
}
// previous full-resolution response kept outside the document's undo history.
export function conceptFromDocument(
  document: ThemeStudioDocument,
): AIThemeConcept | undefined {
  const art = document.assets[ART];
  if (!art || !document.spec.primitives.some((p) => p.assetPath === ART))
    return undefined;
  const attached = document.spec.primitives.find((p) =>
    isAttachedSceneAnimation(p.assetPath),
  );
  const animation = document.assets[attached?.assetPath || ANIMATION];
  const animated = Boolean(
    animation &&
    document.spec.primitives.some(
      (p) => p.assetPath === ANIMATION || isAttachedSceneAnimation(p.assetPath),
    ),
  );
  const textColor =
    document.spec.primitives.find((p) => p.type === "text")?.color || "#EEEEEE";
  const placed = document.spec.primitives.find((p) => p.assetPath === ART)!;
  const companions: AIThemeCompanion[] = document.spec.primitives.filter(p=>isCompanionSprite(p.assetPath)).map(p=>({
    id: p.assetPath!.includes("pet-1") ? "pet-1" : "pet-2",
    // The helper places companions on the picture; one dragged off it is described at the nearest spot on it.
    ...onPicture(p, placed),size:p.width || 48,fps:p.fps ?? 4,frameCount:8,keyColor:"#FF00FF",reuse:true,sheetBase64:spritePNG(document.assets[p.assetPath!].data,true),
  }));
  return {
    ...(companions.length ? {companions} : {}),
    imageBase64: spritePNG(art.data, false),
    referenceImageBase64: sceneReferencePNG(document),
    showsUsage: usageSectionIndices(document.spec.primitives).flat().length > 0,
    imageContentType: "image/png",
    ...(animated
      ? {
          animation: {
            spriteSheetBase64: spritePNG(animation.data, true),
            fps: 4,
            keyColor: "#FF00FF",
          },
        }
      : {}),
    style: {
      packName: document.packName.slice(0, 48) || "My theme",
      title: document.packName.slice(0, 18) || "My theme",
      notes: "Refine the supplied current artwork.",
      artPrompt:
        "Preserve the recognizable subject in the supplied image unless explicitly changed.",
      environmentPrompt:
        "Use the supplied current image as the authoritative environment and style reference.",
      animationMode: attached
        ? "scene_loop"
        : animated || companions.length > 0
          ? "four_frame"
          : "static",
      animationPrompt: animated || companions.length > 0
        ? "Preserve the supplied sprite motion unless explicitly changed."
        : "",
      backgroundColor: document.spec.bgColor || "#101820",
      panelColor: document.spec.bgColor || "#101820",
      textColor,
      sessionColor:
        document.spec.primitives.find((p) => p.binding === "session" || p.binding === "usageSlot1Percent")?.color ||
        "#CCFF00",
      weeklyColor:
        document.spec.primitives.find((p) => p.binding === "weekly" || p.binding === "usageSlot2Percent")?.color ||
        "#CCFF00",
      progressStyle: "solid",
      borderRadius: 0,
    },
  };
}

function sceneReferencePNG(document: ThemeStudioDocument): string {
  const canvas = window.document.createElement("canvas");
  const placed = document.spec.primitives.find((p) => p.assetPath === ART);
  canvas.width = 240;
  canvas.height = placed?.height || 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image preparation is unavailable.");
  for (const p of document.spec.primitives) {
    if (
      p.assetPath !== ART &&
      p.assetPath !== ANIMATION &&
      !isCompanionSprite(p.assetPath) &&
      !isAttachedSceneAnimation(p.assetPath)
    )
      continue;
    const decoded = decodeSprite(document.assets[p.assetPath!]?.data || "");
    if (!decoded) continue;
    const sx = (p.width || decoded.width) / decoded.width,
      sy = (p.height || decoded.height) / decoded.height;
    for (const r of decoded.frames[0]) {
      ctx.fillStyle = r.color;
      ctx.fillRect(p.x - (placed?.x || 0) + r.x * sx, p.y - (placed?.y || 0) + r.y * sy, r.width * sx, r.height * sy);
    }
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

export function spritePNG(raw: string, sheet: boolean): string {
  const sprite = decodeSprite(raw);
  if (
    !sprite ||
    sprite.width > 240 ||
    sprite.height > 240 ||
    sprite.frames.length > 32
  )
    throw new Error("This artwork cannot be used as an AI reference.");
  const canvas = document.createElement("canvas");
  // Keep the complete previous cycle, including its return leg. Four-frame
  // character references retain their original provider layout.
  const cell = sprite.width;
  const frames = sheet ? sprite.frames : sprite.frames.slice(0, 1);
  const columns = sheet ? Math.min(4, frames.length) : 1;
  const rows = Math.ceil(frames.length / columns);
  canvas.width = cell * columns;
  canvas.height = sheet && rows === 1 ? Math.round((canvas.width * 8) / 15) : rows * sprite.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image preparation is unavailable.");
  if (sheet) {
    ctx.fillStyle = "#FF00FF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  frames.forEach(
    (frame, i) =>
      frame.forEach((rect) => {
        ctx.fillStyle = rect.color;
        ctx.fillRect(
          (i % columns) * cell + rect.x,
          rect.y +
            (rows > 1 ? Math.floor(i / columns) * sprite.height : sheet ? Math.round((canvas.height - sprite.height) / 2) : 0),
          rect.width,
          rect.height,
        );
      }),
  );
  return canvas.toDataURL("image/png").split(",")[1];
}

export function pruneUnusedThemeAssets(document: ThemeStudioDocument): void {
  const used = new Set(referencedThemeAssetPaths(document.spec));
  for (const path of Object.keys(document.assets)) {
    if (!used.has(path)) delete document.assets[path];
  }
}

// The device cannot blend an animated sprite with what lies beneath it: it
// fills the sprite's transparent pixels with the theme background colour. For
// the copy that goes to the device, paint the picture and the coloured areas
// drawn before each companion into its frames. The editable document keeps the
// transparent sprite.
export function flattenCompanionSprites(document: ThemeStudioDocument): ThemeStudioDocument {
  if (!document.spec.primitives.some((p) => isCompanionSprite(p.assetPath))) return document;
  const SIZE = 240;
  const backdrop = new Array<string | undefined>(SIZE * SIZE);
  const fill = (target: Array<string | undefined>, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: string) => {
    for (let y = Math.max(0, Math.floor(y1)); y < Math.min(height, Math.ceil(y2)); y++)
      for (let x = Math.max(0, Math.floor(x1)); x < Math.min(width, Math.ceil(x2)); x++) target[y * width + x] = color;
  };
  const next = cloneDocument(document);
  for (const p of next.spec.primitives) {
    const sprite = p.type === "sprite" ? decodeSprite(next.assets[p.assetPath || ""]?.data || "") : null;
    if (p.type === "rect" && p.color) fill(backdrop, SIZE, SIZE, p.x, p.y, p.x + (p.width || 0), p.y + (p.height || 0), p.color);
    if (!sprite) continue;
    const scaleX = (p.width || sprite.width) / sprite.width, scaleY = (p.height || sprite.height) / sprite.height;
    if (!isCompanionSprite(p.assetPath)) {
      if (sprite.frames.length === 1)
        for (const r of sprite.frames[0]) fill(backdrop, SIZE, SIZE, p.x + r.x * scaleX, p.y + r.y * scaleY, p.x + (r.x + r.width) * scaleX, p.y + (r.y + r.height) * scaleY, r.color);
      continue;
    }
    const { width, height } = sprite;
    const frames = sprite.frames.map((rects) => {
      const colors = new Array<string | undefined>(width * height);
      for (let y = 0; y < height; y++) {
        const shownY = p.y + Math.floor((y + 0.5) * scaleY);
        for (let x = 0; x < width; x++) {
          const shownX = p.x + Math.floor((x + 0.5) * scaleX);
          if (shownX >= 0 && shownY >= 0 && shownX < SIZE && shownY < SIZE) colors[y * width + x] = backdrop[shownY * SIZE + shownX];
        }
      }
      for (const r of rects) fill(colors, width, height, r.x, r.y, r.x + r.width, r.y + r.height, r.color);
      const rgba = new Uint8ClampedArray(width * height * 4);
      colors.forEach((color, i) => {
        if (!color) return;
        const value = Number.parseInt(color.slice(1), 16);
        rgba.set([value >> 16, (value >> 8) & 255, value & 255, 255], i * 4);
      });
      return rgba;
    });
    next.assets[p.assetPath!] = { ...next.assets[p.assetPath!], data: encodeAIThemeCBA1(frames, width, height, sprite.fps) };
  }
  return next;
}
