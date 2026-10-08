import { notFound } from "next/navigation";
import { ThemeStudioPreview } from "@/components/theme-studio/theme-studio-preview";

export default function ThemeStudioPreviewPage() {
  if (process.env.VIBETV_AI_THEME_PREVIEW !== "1") notFound();
  return <ThemeStudioPreview />;
}
