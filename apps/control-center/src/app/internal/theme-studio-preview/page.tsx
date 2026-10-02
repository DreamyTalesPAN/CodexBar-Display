import { notFound } from "next/navigation";
import { AIThemeStudioScreen } from "@/components/theme-studio/ai-theme-studio-screen";

export default function ThemeStudioPreviewPage() {
  if (process.env.VIBETV_AI_THEME_PREVIEW !== "1") notFound();
  return <AIThemeStudioScreen />;
}
