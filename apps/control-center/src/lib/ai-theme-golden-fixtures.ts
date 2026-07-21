import type { ThemeStudioSpec } from "./theme-studio";

export const AI_THEME_GOLDEN_FIXTURES: Array<{
  name: string;
  prompt: string;
  spec: ThemeStudioSpec;
}> = [
  { name: "minimal", prompt: "Create a calm minimal usage theme.", spec: { themeSpecVersion: 1, themeId: "ai-minimal", themeRev: 1, bgColor: "#101114", primitives: [
    { type: "text", x: 20, y: 28, text: "SESSION", fontSize: 2, color: "#FFFFFF" },
    { type: "progress", x: 20, y: 62, width: 200, height: 16, binding: "session", color: "#8BE9FD", bgColor: "#282A36" },
    { type: "progress", x: 20, y: 104, width: 200, height: 16, binding: "weekly", color: "#50FA7B", bgColor: "#282A36" },
  ] } },
  { name: "retro", prompt: "Create an amber retro terminal theme.", spec: { themeSpecVersion: 1, themeId: "ai-retro", themeRev: 1, bgColor: "#140C00", primitives: [
    { type: "rect", x: 8, y: 8, width: 224, height: 224, color: "#2A1700", borderColor: "#FFB000" },
    { type: "text", x: 20, y: 24, text: "VIBETV OS", fontSize: 2, color: "#FFB000" },
    { type: "progress", x: 20, y: 80, width: 200, height: 12, binding: "session", color: "#FFB000" },
    { type: "progress", x: 20, y: 120, width: 200, height: 12, binding: "weekly", color: "#FF6A00" },
  ] } },
  { name: "finance", prompt: "Create a professional finance dashboard.", spec: { themeSpecVersion: 1, themeId: "ai-finance", themeRev: 1, bgColor: "#071A2B", primitives: [
    { type: "text", x: 16, y: 18, text: "AI BUDGET", fontSize: 3, color: "#E8F1F8" },
    { type: "text", x: 16, y: 62, binding: "sessionTokens", fontSize: 2, color: "#54D2D2" },
    { type: "progress", x: 16, y: 96, width: 208, height: 18, binding: "session", color: "#54D2D2", bgColor: "#163A55" },
    { type: "progress", x: 16, y: 142, width: 208, height: 18, binding: "weekly", color: "#F2C14E", bgColor: "#163A55" },
  ] } },
  { name: "neon", prompt: "Create a high contrast neon night theme.", spec: { themeSpecVersion: 1, themeId: "ai-neon", themeRev: 1, bgColor: "#050014", primitives: [
    { type: "rect", x: 10, y: 10, width: 220, height: 220, color: "#12002E", borderColor: "#FF2BD6", borderRadius: 10 },
    { type: "text", x: 28, y: 28, text: "NEON LIMITS", fontSize: 3, color: "#00F5FF" },
    { type: "progress", x: 28, y: 92, width: 184, height: 18, binding: "session", color: "#FF2BD6" },
    { type: "progress", x: 28, y: 140, width: 184, height: 18, binding: "weekly", color: "#00F5FF" },
  ] } },
  { name: "cat pixel art", prompt: "Create a cute cat using compatible pixel art.", spec: { themeSpecVersion: 1, themeId: "ai-cat-pixels", themeRev: 1, bgColor: "#21182F", primitives: [
    { type: "pixels", x: 84, y: 24, width: 16, height: 12, p: ["#000000", "#F7C873", "#FFFFFF"], r: ["01100000000110", "01110000001110", "01111111111110", "01112211122110", "01111100111110", "00111111111100"] },
    { type: "progress", x: 24, y: 150, width: 192, height: 14, binding: "session", color: "#F7C873" },
    { type: "progress", x: 24, y: 184, width: 192, height: 14, binding: "weekly", color: "#C79BF2" },
  ] } },
];
