import { ControlCenterApp } from "@/components/control-center-app";
import { getThemeCatalog } from "@/lib/themes";

export default async function ThemeStudioPage() {
  const catalog = await getThemeCatalog();
  return <ControlCenterApp catalog={catalog} initialTab="theme-library" />;
}
