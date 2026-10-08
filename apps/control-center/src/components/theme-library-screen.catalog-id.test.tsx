// @vitest-environment jsdom
//
// Checked on 2026-10-08 after #549: an awake VibeTV names its live theme by
// id, so a customer's own theme that arrived under a catalog theme's id would
// be taken for an old revision of it and replaced by the automatic update.
// Theme Studio has four ways to put a catalog id into the editor. None of them
// reaches VibeTV: a changed theme cannot be sent before it is saved, and Save
// gives it an id no catalog theme has.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { resolveActiveThemeUpgrade } from "@/lib/active-theme-upgrade";
import { buildThemePack, createBlankThemeSpec } from "@/lib/theme-studio";
import type { ThemeProduct } from "@/lib/themes";
import type { DeviceInfo } from "./control-center-types";
import { ThemeLibraryScreen } from "./theme-library-screen";
import type { ThemeStudioInstallPayload } from "./theme-studio-screen";

vi.mock("./theme-render-preview", () => ({ ThemeRenderPreview: () => null }));

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../dist/theme-packs",
);
const readJson = (file: string) =>
  JSON.parse(readFileSync(path.join(dist, file), "utf8"));
// The catalog this build ships, not a fixture.
const catalog: ThemeProduct[] = readJson("vibetv-theme-packs-v2.json").themes.map(
  (entry: ThemeProduct & { id: string }) => ({
    ...entry,
    isFree: true,
    priceLabel: "Free",
    source: "github-catalog",
    themeId: entry.id,
  }),
);
// A theme file of the customer's own that names itself like a catalog theme.
const ownThemeJson = JSON.stringify({
  ...createBlankThemeSpec(),
  themeId: "mini-classic",
});
const capabilities = {
  theme: {
    supportsThemeSpecV1: true,
    supportsUsageSlotsV1: true,
    supportsUsageWindowsV1: true,
    supportsProviderAssetsV1: true,
    supportsColorStopsV1: true,
    supportsTextValignV1: true,
    supportsProgressArcV1: true,
  },
};

// What the Themes library hands the Mac App for VibeTV.
const sent: ThemeStudioInstallPayload[] = [];

beforeEach(() => {
  sent.length = 0;
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const themeId = String(input).match(/theme-pack\/([a-z0-9-]+)/)?.[1];
      return {
        ok: Boolean(themeId),
        json: async () => readJson(`render/${themeId}.json`),
      } as Response;
    }),
  );
  render(
    <TooltipProvider>
      <ThemeLibraryScreen
        busyAction={null}
        companionStatus="online"
        device={{
          activeTheme: "synthwave",
          capabilities,
          connected: true,
          paired: true,
          ready: true,
        }}
        onInstallCustomTheme={async (payload) => {
          sent.push(payload);
          return true;
        }}
        onInstallTheme={vi.fn()}
        onSelectTheme={vi.fn()}
        selectedThemeId=""
        storefrontConfigured={false}
        themeInstallEnabled
        themes={catalog}
      />
    </TooltipProvider>,
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const idField = () => screen.getByLabelText("ID") as HTMLInputElement;
const tab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }));

// The automatic update's verdict on an awake VibeTV showing this theme. The
// pack is built the way installCustomTheme in control-center-app.tsx builds
// it; VibeTV reports the id from the theme file and the path from the manifest.
function automaticUpdate({ assets, packName, spec, usage }: ThemeStudioInstallPayload) {
  const pack = buildThemePack(spec, packName, assets, usage);
  const device: DeviceInfo = {
    activeTheme: JSON.parse(pack.themeJson).id,
    capabilities,
    connected: true,
    display: { themeSpec: { active: true, path: pack.manifest.themeSpec.path } },
  };
  return resolveActiveThemeUpgrade(catalog, device);
}

it.each<[string, () => void]>([
  ["the Mini theme button", () => fireEvent.click(button("Mini theme"))],
  [
    "the ID field",
    () => fireEvent.change(idField(), { target: { value: "mini-classic" } }),
  ],
  [
    "Import theme JSON",
    () =>
      fireEvent.change(document.querySelector('input[accept*=".json"]')!, {
        target: { files: [new File([ownThemeJson], "mini-classic.json")] },
      }),
  ],
  [
    "Apply JSON",
    () => {
      tab("JSON");
      fireEvent.change(screen.getByLabelText("Theme JSON"), {
        target: { value: ownThemeJson },
      });
      fireEvent.click(button("Apply JSON"));
      tab("Project");
    },
  ],
])("never sends a theme under a catalog id taken from %s", async (_way, takeCatalogId) => {
  fireEvent.click(button("Create Theme"));
  fireEvent.click(button("Advanced"));
  expect(idField().value).toBe("my-theme");

  takeCatalogId();
  await waitFor(() => expect(idField().value).toBe("mini-classic"));
  expect(button("Send to VibeTV").disabled).toBe(true);

  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(idField().value).toBe("mini-classic-2"));
  fireEvent.click(button("Send to VibeTV"));
  await waitFor(() => expect(sent).toHaveLength(1));

  // The saved theme goes out under the same id from its library row.
  fireEvent.click(button("Library"));
  const ownRow = screen
    .getAllByRole("listitem")
    .find((row) => within(row).queryByText("Custom"))!;
  fireEvent.click(within(ownRow).getByRole("button", { name: "Install" }));
  await waitFor(() => expect(sent).toHaveLength(2));

  for (const theme of sent) {
    expect(theme.spec.themeId).toBe("mini-classic-2");
    expect(automaticUpdate(theme)).toEqual({
      needed: false,
      needsFirmwareCapability: false,
      needsThemeSpec: false,
      unresolved: false,
    });
  }
  // Why the id matters: the same theme under the catalog id would be replaced.
  expect(
    automaticUpdate({
      ...sent[0],
      spec: { ...sent[0].spec, themeId: "mini-classic" },
    }),
  ).toMatchObject({ needed: true, theme: { themeId: "mini-classic" } });
});

// Save never stores a theme without a name: it names it after its id, and
// the name field shows that name.
it.each(["", "   "])("names a theme saved with the name %j after its id", async (name) => {
  fireEvent.click(button("Create Theme"));
  const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;
  fireEvent.change(nameField(), { target: { value: name } });

  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(nameField().value).toBe("My Theme"));
  expect(screen.getByText("Saved to library.")).toBeTruthy();
});

// An unchanged copy opened with Edit already carries its own id. It is still
// a draft that no list contains, so it is saved before it can be sent.
it("sends a copy of a catalog theme under its own id, once it is saved", async () => {
  const miniClassic = screen
    .getAllByRole("listitem")
    .find((row) => within(row).queryByText("Mini Classic"))!;
  fireEvent.click(within(miniClassic).getByRole("button", { name: "Edit" }));
  fireEvent.click(await screen.findByRole("button", { name: "Advanced" }));
  await waitFor(() => expect(idField().value).toBe("mini-classic-custom"));
  expect(button("Send to VibeTV").disabled).toBe(true);

  fireEvent.click(button("Save theme"));
  await waitFor(() => expect(button("Send to VibeTV").disabled).toBe(false));
  fireEvent.click(button("Send to VibeTV"));
  await waitFor(() => expect(sent).toHaveLength(1));

  expect(sent[0].spec.themeId).toBe("mini-classic-custom");
  expect(automaticUpdate(sent[0]).needed).toBe(false);
});
