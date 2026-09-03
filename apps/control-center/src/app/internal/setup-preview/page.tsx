import { notFound } from "next/navigation";

import { SetupPreviewGallery } from "@/components/setup/setup-preview-gallery";

export default function SetupPreviewPage() {
  const previewEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.VIBETV_ENABLE_UI_KIT === "1";

  if (!previewEnabled) {
    notFound();
  }

  return <SetupPreviewGallery />;
}
