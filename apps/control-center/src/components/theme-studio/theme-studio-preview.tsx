"use client";

import { ControlCenterShell } from "@/components/control-center-shell";
import { AIThemeStudioScreen } from "./ai-theme-studio-screen";

// The development preview shows the editor inside the same shell as the app.
export function ThemeStudioPreview() {
  return (
    <ControlCenterShell activeTab="theme-library" device={null} onTabChange={() => {}}>
      <AIThemeStudioScreen />
    </ControlCenterShell>
  );
}
