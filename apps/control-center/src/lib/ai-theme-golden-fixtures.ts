import type { AIThemeConcept } from "./ai-theme";

const baseStyle = {
  animationMode: "static" as const,
  animationPrompt: "",
  backgroundColor: "#081426",
  borderRadius: 3,
  panelColor: "#101F36",
  progressStyle: "segments" as const,
  sessionColor: "#F6B85F",
  textColor: "#FFF3CF",
  weeklyColor: "#EF6A8A",
};

export const AI_THEME_GOLDEN_FIXTURES: Array<{ concept: AIThemeConcept; name: string; prompt: string }> = [
  ["cat", "Create a premium cat theme.", "Moon Cat", "CAT MODE", "A large orange pixel cat beneath a cream moon."],
  ["terminal", "Create an amber terminal theme.", "Amber Terminal", "TERMINAL", "A bold amber command cursor on a dark terminal grid."],
  ["synthwave", "Create a synthwave theme.", "Neon Drive", "NEON DRIVE", "A neon sunset above a simple perspective grid."],
].map(([name, prompt, packName, title, artPrompt]) => ({
  name,
  prompt,
  concept: {
    imageBase64: "session-only",
    imageContentType: "image/png",
    style: { ...baseStyle, artPrompt, notes: `${packName} screenmaster`, packName, title },
  },
}));
