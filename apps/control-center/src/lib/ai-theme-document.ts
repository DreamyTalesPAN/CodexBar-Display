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
  if (current.spec.primitives.length === 0)
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
    const hasLoop = candidate.spec.primitives.some((p) => p.assetPath === LOOP || isCompanionSprite(p.assetPath));
    next.spec.primitives = next.spec.primitives.filter(
      (p) => !managed(p.assetPath),
    );
    for (const path of Object.keys(next.assets))
      if (managed(path)) delete next.assets[path];
    const generated = candidate.spec.primitives
      .filter((p) => managed(p.assetPath))
      .map((p) => {
        if (p.assetPath === ART && artwork && !hasLoop)
          return {
            ...p,
            x: artwork.x,
            y: artwork.y,
            width: artwork.width,
            height: artwork.height,
          };
        if (p.assetPath === ANIMATION && oldCharacter)
          return {
            ...p,
            x: oldCharacter.x,
            y: oldCharacter.y,
            width: oldCharacter.width,
            height: oldCharacter.height,
          };
        return { ...p };
      });
    next.spec.primitives.unshift(...generated);
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

// Reconstruct references from the current saved/undone document, never from a
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
  const companions: AIThemeCompanion[] = document.spec.primitives.filter(p=>isCompanionSprite(p.assetPath)).map(p=>({
    id: p.assetPath!.includes("pet-1") ? "pet-1" : "pet-2", x:p.x,y:p.y,size:p.width || 48,fps:p.fps ?? 4,frameCount:8,keyColor:"#FF00FF",reuse:true,sheetBase64:spritePNG(document.assets[p.assetPath!].data,true),
  }));
  return {
    ...(companions.length ? {companions} : {}),
    imageBase64: spritePNG(art.data, false),
    referenceImageBase64: sceneReferencePNG(document),
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
        document.spec.primitives.find((p) => p.binding === "session")?.color ||
        "#CCFF00",
      weeklyColor:
        document.spec.primitives.find((p) => p.binding === "weekly")?.color ||
        "#CCFF00",
      progressStyle: "solid",
      borderRadius: 0,
    },
  };
}

function sceneReferencePNG(document: ThemeStudioDocument): string {
  const canvas = window.document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 128;
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
      ctx.fillRect(p.x + r.x * sx, p.y + r.y * sy, r.width * sx, r.height * sy);
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
