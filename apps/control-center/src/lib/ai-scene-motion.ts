import { decodeSprite } from "@/components/live-vibetv-preview";
import {
  cloneDocument,
  type ThemeStudioDocument,
} from "@/components/theme-studio/theme-studio-editor-state";
import { AI_THEME_SCREENMASTER_ASSET_PATH as ART } from "./ai-theme";
import { spriteMetadata } from "./theme-studio-assets";

export const SCENE_MOTION_EFFECTS = {
  breathe: "Gentle breathing",
  sway: "Soft swaying",
  flicker: "Light flicker",
  scroll: "Monitor scrolling",
} as const;
export type SceneMotionPlan = {
  x: number;
  y: number;
  width: number;
  height: number;
  effect: keyof typeof SCENE_MOTION_EFFECTS;
};
export function sceneMotionEffect(
  path?: string,
): SceneMotionPlan["effect"] | undefined {
  return (
    Object.keys(SCENE_MOTION_EFFECTS) as SceneMotionPlan["effect"][]
  ).find((effect) => path === `/themes/u/ai-scene-${effect}.cba`);
}
export function sceneMotionPlan(
  document: ThemeStudioDocument,
): SceneMotionPlan | undefined {
  const p = document.spec.primitives.find((p) =>
    sceneMotionEffect(p.assetPath),
  );
  const effect = sceneMotionEffect(p?.assetPath);
  return p && effect
    ? { x: p.x, y: p.y, width: p.width!, height: p.height!, effect }
    : undefined;
}
export function removeSceneMotion(document: ThemeStudioDocument) {
  document.spec.primitives = document.spec.primitives.filter(
    (p) => !sceneMotionEffect(p.assetPath),
  );
  for (const path of Object.keys(document.assets))
    if (sceneMotionEffect(path)) delete document.assets[path];
}

export function sceneMotionHasChanges(document: ThemeStudioDocument): boolean {
  const p = document.spec.primitives.find((p) =>
    sceneMotionEffect(p.assetPath),
  );
  const raw = p?.assetPath ? document.assets[p.assetPath]?.data : undefined;
  if (!raw) return false;
  const lines = raw.split("\n");
  const height = Number(lines[1].split(" ")[1]);
  const rows = lines.slice(3 + Number(lines[2]));
  const first = rows.slice(0, height).join("\n");
  return Array.from({ length: 7 }, (_, i) =>
    rows.slice((i + 1) * height, (i + 2) * height).join("\n"),
  ).some((frame) => frame !== first);
}

// The moving window is made from the scene's exact palette and pixels. Its
// boundary is fixed; it is an attached region, never a transparent character.
export function applySceneMotion(
  current: ThemeStudioDocument,
  plan: SceneMotionPlan,
  replaceAnimation = false,
  fps = 4,
): ThemeStudioDocument {
  const art = current.spec.primitives.find((p) => p.assetPath === ART);
  const source = decodeSprite(current.assets[ART]?.data || "");
  if (
    !art ||
    art.x !== 0 ||
    art.y !== 0 ||
    art.width !== 240 ||
    art.height !== 128 ||
    !source ||
    source.width !== 240 ||
    source.height !== 128
  )
    throw new Error(
      "Scene motion needs the original full-size AI artwork. Undo its position or size change first.",
    );
  if (
    !Object.hasOwn(SCENE_MOTION_EFFECTS, plan.effect) ||
    ![plan.x, plan.y, plan.width, plan.height].every(Number.isInteger) ||
    plan.width < 8 ||
    plan.height < 8 ||
    plan.width > 64 ||
    plan.height > 64 ||
    plan.x < 0 ||
    plan.y < 0 ||
    plan.x + plan.width > 240 ||
    plan.y + plan.height > 128 ||
    ![1, 2, 4, 8].includes(fps)
  )
    throw new Error(
      "Choose a motion area inside the artwork, between 8 and 64 pixels wide and high.",
    );
  const otherAnimations = current.spec.primitives.filter(
    (p) =>
      !sceneMotionEffect(p.assetPath) &&
      p.assetPath &&
      (spriteMetadata(current.assets[p.assetPath]?.data)?.frameCount || 0) > 1,
  );
  if (otherAnimations.length && !replaceAnimation)
    throw new Error(
      "VibeTV plays one animation at a time. Replace the current animation to animate this scene.",
    );
  const pixels = Array<string>(240 * 128).fill("#000000");
  for (const rect of source.frames[0])
    for (let y = rect.y; y < rect.y + rect.height; y++)
      for (let x = rect.x; x < rect.x + rect.width; x++)
        pixels[y * 240 + x] = rect.color;
  const palette = [...new Set(pixels)];
  if (palette.length > 26)
    throw new Error("This artwork has too many colors for scene motion.");
  const luminance = (color: string) =>
    parseInt(color.slice(1, 3), 16) * 0.2126 +
    parseInt(color.slice(3, 5), 16) * 0.7152 +
    parseInt(color.slice(5, 7), 16) * 0.0722;
  const dimmer = new Map(
    palette.map((color) => {
      const l = luminance(color);
      const candidates = palette.filter(
        (c) => luminance(c) < l && luminance(c) > l - 65,
      );
      return [
        color,
        candidates.sort((a, b) => luminance(b) - luminance(a))[0] || color,
      ];
    }),
  );
  const { x, y, width, height, effect } = plan;
  const frames: string[][] = [];
  for (let frame = 0; frame < 8; frame++) {
    const wave = Math.sin((frame * Math.PI) / 4);
    const rows: string[] = [];
    for (let py = 0; py < height; py++) {
      let row = "";
      for (let px = 0; px < width; px++) {
        const edge = Math.min(px, py, width - px - 1, height - py - 1);
        const weight = Math.min(1, Math.max(0, (edge - 2) / 6));
        let sx = px,
          sy = py;
        if (effect === "breathe") sy += Math.round(wave * weight * 1.4);
        if (effect === "sway") sx += Math.round(wave * weight * 1.4);
        if (effect === "scroll" && edge > 2)
          sy =
            3 +
            ((py - 3 + Math.round((frame * (height - 6)) / 8)) % (height - 6));
        let color = pixels[(y + sy) * 240 + x + sx];
        if (effect === "flicker" && weight > 0.5 && [2, 5].includes(frame))
          color = dimmer.get(color)!;
        row += String.fromCharCode(97 + palette.indexOf(color));
      }
      rows.push(
        row.replace(
          /(.)\1*/g,
          (run) => (run.length > 1 ? run.length : "") + run[0],
        ),
      );
    }
    frames.push(rows);
  }
  const next = cloneDocument(current);
  removeSceneMotion(next);
  if (replaceAnimation)
    next.spec.primitives = next.spec.primitives.filter(
      (p) =>
        !p.assetPath ||
        !otherAnimations.some((other) => other.assetPath === p.assetPath),
    );
  const path = `/themes/u/ai-scene-${effect}.cba`;
  next.assets[path] = {
    contentType: "text/plain",
    encoding: "text",
    data: [
      "CBA1",
      `${width} ${height} 8 ${fps}`,
      palette.length,
      ...palette,
      ...frames.flat(),
      "",
    ].join("\n"),
  };
  next.spec.primitives.splice(
    next.spec.primitives.findIndex((p) => p.assetPath === ART) + 1,
    0,
    {
      type: "sprite",
      x,
      y,
      width,
      height,
      assetPath: path,
      frameCount: 8,
      fps,
      sheetColumns: 8,
    },
  );
  return next;
}
