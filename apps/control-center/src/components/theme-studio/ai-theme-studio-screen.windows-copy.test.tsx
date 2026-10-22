// @vitest-environment jsdom
//
// Theme Studio shows its error in a red line under the AI box. The Companion's
// own words can reach that line, so on Windows they must read as the Windows
// app words them ("App", "this computer"); on a Mac they stay unchanged.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AIThemeStudioScreen } from "./ai-theme-studio-screen";

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({ ok: false, error: { message: "Mac App is restarting." } }),
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

beforeAll(() => {
  // The chat scrolls its end into view, which jsdom lacks.
  Element.prototype.scrollIntoView = () => {};
  // Layout observers are missing in jsdom.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // The sidebar reads the screen width through matchMedia, which jsdom lacks.
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});

async function renderStudioWithError(windowsHost: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <SidebarProvider>
        <AIThemeStudioScreen windowsHost={windowsHost} />
      </SidebarProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { host, cleanup: () => root.unmount() };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Theme Studio error wording", () => {
  it("reads App on Windows", async () => {
    const { host, cleanup } = await renderStudioWithError(true);
    const alert = host.querySelector("#ai-theme-error");
    expect(alert?.textContent).toBe("App is restarting.");
    await act(async () => cleanup());
  });

  it("keeps Mac App on a Mac", async () => {
    const { host, cleanup } = await renderStudioWithError(false);
    const alert = host.querySelector("#ai-theme-error");
    expect(alert?.textContent).toBe("Mac App is restarting.");
    await act(async () => cleanup());
  });
});
