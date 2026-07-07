import { ControlCenterApp } from "@/components/control-center-app";
import { getStaticThemeIds, getThemeCatalog } from "@/lib/themes";

type Props = {
  params: Promise<{ themeId: string }>;
};

export default async function InstallPage({ params }: Props) {
  const [{ themeId }, catalog] = await Promise.all([params, getThemeCatalog()]);
  return <ControlCenterApp catalog={catalog} initialThemeId={themeId} />;
}

export async function generateStaticParams() {
  const themeIds = await getStaticThemeIds();
  return themeIds.map((themeId) => ({ themeId }));
}
