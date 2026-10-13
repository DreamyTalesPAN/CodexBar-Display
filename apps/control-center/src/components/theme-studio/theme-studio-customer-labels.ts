import type {
  ThemeStudioAsset,
  ThemeStudioPrimitive,
} from "@/lib/theme-studio";
import {
  AI_THEME_ANIMATION_ASSET_PATH,
  AI_THEME_SCREENMASTER_ASSET_PATH,
} from "@/lib/ai-theme";
import { spriteMetadata } from "@/lib/theme-studio-assets";
import { sceneMotionEffect } from "@/lib/ai-scene-motion";

const readings: Record<string, string> = {
  session: "Session usage",
  weekly: "Weekly usage",
  usageMode: "Usage direction",
  sessionTokens: "Session tokens",
  weekTokens: "Weekly tokens",
  totalTokens: "Total tokens",
  time: "Clock",
  date: "Date",
  label: "Account name",
  provider: "Provider name",
  activity: "Activity",
  usageSlot1Label: "First usage window name",
  usageSlot2Label: "Second usage window name",
  usageSlot1Percent: "First usage reading",
  usageSlot2Percent: "Second usage reading",
  usageSlot1Reset: "First usage reset",
  usageSlot2Reset: "Second usage reset",
  providerSlot1Label: "First provider name",
  providerSlot2Label: "Second provider name",
  providerSlot1Percent: "First provider usage",
  providerSlot2Percent: "Second provider usage",
  providerSlot1Reset: "First provider reset",
  providerSlot2Reset: "Second provider reset",
};

export function friendlyElementName(
  p: ThemeStudioPrimitive,
  assets: Record<string, ThemeStudioAsset>,
): string {
  if (p.type === "sprite" || p.type === "gif") {
    if (sceneMotionEffect(p.assetPath)) return "Scene motion area";
    if (p.assetPath === AI_THEME_ANIMATION_ASSET_PATH)
      return "Animated character";
    if (p.assetPath === AI_THEME_SCREENMASTER_ASSET_PATH)
      return "Background artwork";
    const frames = p.assetPath
      ? spriteMetadata(assets[p.assetPath]?.data)?.frameCount
      : 0;
    return p.type === "gif" || (frames || p.frameCount || 0) > 1
      ? "Animation"
      : "Image";
  }
  if (p.type === "progress") return "Usage bar";
  if (p.type === "rect") return "Background shape";
  if (p.type === "pixels") return "Pixel artwork";
  if (p.binding) return readings[p.binding] || "Live reading";
  if (p.text?.includes("{")) {
    const token = p.text.match(/\{([^}]+)\}/)?.[1];
    return readings[token || ""] || "Live reading";
  }
  return p.text?.trim().slice(0, 64) || "Text";
}
