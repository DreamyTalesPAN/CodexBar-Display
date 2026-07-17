import { notFound } from "next/navigation";

import { VibeTvUiKit } from "@/components/vibetv-ui-kit";

export default function UiKitPage() {
  const uiKitEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.VIBETV_ENABLE_UI_KIT === "1";

  if (!uiKitEnabled) {
    notFound();
  }

  return <VibeTvUiKit />;
}
