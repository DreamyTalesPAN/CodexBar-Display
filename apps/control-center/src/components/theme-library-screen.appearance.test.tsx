// @vitest-environment jsdom
//
// One Appearance page: a segment switch (All / Themes / Screensavers), a name
// search, a Filters popover with chips, and one Create button.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THEME_CARD_TITLE_CLASS } from "@/lib/theme-grid";
import type { ThemeProduct } from "@/lib/themes";
import {
  ThemeLibraryScreen,
  type ThemeLibraryScreenProps,
  type ThemeLibraryUsage,
} from "./theme-library-screen";

vi.mock("@/lib/theme-studio-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadUserThemes: () => ({ ok: true, value: { themes: [] } }),
  loadThemeStudioRecovery: () => ({ ok: true, value: null }),
}));

const created = vi.hoisted(() => ({ spec: undefined as undefined | { usage?: string } }));
vi.mock("./theme-studio-screen", () => ({
  ThemeStudioScreen: ({ initialTheme }: { initialTheme?: { usage?: string; packName: string } }) => {
    created.spec = initialTheme;
    return <p>Editor open: {initialTheme?.packName}</p>;
  },
}));

beforeEach(() => {
  vi.stubGlobal("fetch", async () => ({ ok: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  created.spec = undefined;
});

const product = (
  themeId: string,
  title: string,
  usage: "live" | "screensaver",
  extra: Partial<ThemeProduct> & { tags?: string[] } = {},
): ThemeProduct =>
  ({
    id: themeId,
    isFree: true,
    packSha256: "a".repeat(64),
    packSizeBytes: 100,
    packUrl: `https://example.com/${themeId}.zip`,
    priceLabel: "Free",
    source: "github-catalog",
    themeId,
    title,
    usage,
    ...extra,
  }) as ThemeProduct;

const plain = [
  product("claude-creature", "Claude Creature", "live"),
  product("clippy", "Clippy", "live"),
  product("gauge", "Gauge", "live"),
  product("night-clock", "Night Clock", "screensaver"),
  product("reset-countdown", "Reset Countdown", "screensaver"),
];

// What a catalog with tags carries (protocol/theme_tags.json).
const withTags = [
  product("claude-creature", "Claude Creature", "live", { tags: ["animated", "pixel-art", "providers-1"] }),
  product("clippy", "Clippy", "live", { tags: ["animated", "agent-states", "providers-2"] }),
  product("gauge", "Gauge", "live", { tags: ["providers-1"] }),
  product("night-clock", "Night Clock", "screensaver", { tags: ["clock", "providers-2"] }),
  product("reset-countdown", "Reset Countdown", "screensaver", { tags: ["pixel-art", "providers-1"] }),
];

function Page(props: Partial<ThemeLibraryScreenProps> & { start?: ThemeLibraryUsage }) {
  const { start = "all", ...rest } = props;
  const [usage, setUsage] = useState<ThemeLibraryUsage>(start);
  return (
    <ThemeLibraryScreen
      busyAction={null}
      companionStatus="online"
      device={null}
      onInstallCustomTheme={async () => false}
      onInstallTheme={vi.fn()}
      onSelectTheme={vi.fn()}
      onUsageChange={setUsage}
      selectedThemeId=""
      storefrontConfigured={false}
      themeInstallEnabled={false}
      themes={plain}
      usage={usage}
      {...rest}
    />
  );
}

const names = () =>
  screen
    .queryAllByRole("listitem")
    .map((item) => within(item).getByRole("button", { name: /^Preview / }).getAttribute("aria-label"));

const filtersButton = () => screen.getByRole("button", { name: /^Filters/ });
async function openFilters() {
  fireEvent.click(filtersButton());
  return await screen.findByRole("group", { name: "Status" });
}

it("lists both types on All, with the count of each type in the segment", () => {
  render(<Page />);
  expect(screen.getByRole("radio", { name: "All 5" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "Themes 3" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Screensavers 2" })).toBeTruthy();
  expect(names()).toEqual([
    "Preview Claude Creature",
    "Preview Clippy",
    "Preview Gauge",
    "Preview Night Clock",
    "Preview Reset Countdown",
  ]);
  // Each card says what it is, so All is readable.
  const items = screen.getAllByRole("listitem");
  expect(within(items[0]).getByText("Theme")).toBeTruthy();
  expect(within(items[3]).getByText("Screensaver")).toBeTruthy();
});

it("keeps the card's inner space at the template's 8 px: 1 px border plus 7 px padding", () => {
  render(<Page />);
  const card = screen.getAllByRole("listitem")[0];
  expect(card.classList).toContain("p-[7px]");
  expect(card.classList).not.toContain("p-2");
});

// 7197 review, point 8: cards 200 px wide, 32 px apart, as many in a row as fit, as a group in the middle.
it("lays the cards out as 200 px columns with 32 px gaps, centred", () => {
  render(<Page />);
  const group = screen.getAllByRole("listitem")[0].parentElement!;
  expect(group.style.gridTemplateColumns).toBe("repeat(auto-fill, 200px)");
  expect(group.classList).toContain("gap-8!");
  expect(group.classList).toContain("justify-center");
});

// 7197 review, point 8: the type sits under the name, not beside it.
it("puts the type under the name", () => {
  render(<Page />);
  const card = screen.getAllByRole("listitem")[0];
  const type = within(card).getByText(/^(Theme|Screensaver)$/);
  expect(type.previousElementSibling?.getAttribute("data-slot")).toBe("item-title");
  expect(type.parentElement?.classList).toContain("flex-col");
});

it("switches the list with the segment by click; the arrow keys move between the segments", async () => {
  render(<Page />);
  fireEvent.click(screen.getByRole("radio", { name: "Screensavers 2" }));
  expect(names()).toEqual(["Preview Night Clock", "Preview Reset Countdown"]);
  fireEvent.click(screen.getByRole("radio", { name: "Themes 3" }));
  expect(names()).toHaveLength(3);
  const themes = screen.getByRole("radio", { name: "Themes 3" });
  themes.focus();
  fireEvent.keyDown(themes, { key: "ArrowRight" });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Screensavers 2" })),
  );
});

it("shows the screensaver-off notice, with a link to Settings, only under Screensavers", () => {
  const onOpenScreensaverSettings = vi.fn();
  const off = { brightnessPercent: 20, enabled: false, timeoutMinutes: 10 };
  render(<Page onOpenScreensaverSettings={onOpenScreensaverSettings} standby={off} />);
  expect(screen.queryByText(/Screensaver is off\./)).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Themes 3" }));
  expect(screen.queryByText(/Screensaver is off\./)).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Screensavers 2" }));
  expect(screen.getByText(/Screensaver is off\./).textContent).toBe(
    "Screensaver is off. Turn it on in Settings.",
  );
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  expect(onOpenScreensaverSettings).toHaveBeenCalledTimes(1);
});

it("pins the Active marker to the top right of the card picture, outside the title row", () => {
  render(
    <Page
      device={{ connected: true, paired: true, ready: true, activeTheme: "clippy" }}
      selectedThemeId="clippy"
      themes={plain}
    />,
  );
  const pill = within(document.getElementById("catalog-theme-clippy")!).getByTestId("theme-status-pill");
  expect(pill.textContent).toBe("Active");
  const picture = pill.closest('[data-slot="item-media"]');
  expect(picture).not.toBeNull();
  expect(picture?.classList).toContain("relative");
  expect(pill.parentElement?.classList).toContain("absolute");
  expect(pill.parentElement?.classList).toContain("top-2");
  expect(pill.parentElement?.classList).toContain("right-2");
  expect(pill.closest('[data-slot="item-title"]')).toBeNull();
});

// Keep the established title-row height and alignment when the pill moves back to the picture.
it("keeps every title row at the established height so the cards line up", () => {
  render(
    <Page
      device={{ connected: true, paired: true, ready: true, activeTheme: "clippy" }}
      selectedThemeId="clippy"
      themes={plain}
    />,
  );
  const pillHeight = within(document.getElementById("catalog-theme-clippy")!)
    .getByTestId("theme-status-pill").className.match(/(?:^|\s)h-(\d+)(?:\s|$)/)![1];
  const titles = document.querySelectorAll<HTMLElement>('[id^="catalog-theme-"] [data-slot="item-title"]');
  expect(titles.length).toBeGreaterThan(2);
  for (const title of titles) {
    expect(title.classList.contains(`min-h-${pillHeight}`), title.textContent ?? "").toBe(true);
  }
});

it("marks only a verifiably enabled, device-installed screensaver Active", () => {
  const night = product("night-clock", "Night Clock", "screensaver", {
    themeSpecPath: "/themes/s/night.json",
  });
  const device = {
    connected: true,
    paired: true,
    ready: true,
    activeTheme: "clippy",
    standby: { active: false, screensaverPath: night.themeSpecPath },
  };
  const standby = { brightnessPercent: 20, enabled: true, timeoutMinutes: 10 };
  const page = (overrides: Partial<ThemeLibraryScreenProps> = {}) => (
    <Page
      device={device}
      selectedThemeId="clippy"
      selectedScreensaverId="night-clock"
      standby={standby}
      themes={[plain[1], night]}
      {...overrides}
    />
  );
  const { rerender } = render(page());
  const nightCard = () => within(document.getElementById("catalog-theme-night-clock")!);
  // Enabled is the setting, not whether the idle timeout has elapsed.
  expect(nightCard().getByTestId("theme-status-pill").textContent).toBe("Active");
  for (const overrides of [
    { standby: { ...standby, enabled: false } },
    { standby: null },
    { companionStatus: "missing" as const },
    { companionStatus: "unknown" as const },
    { device: { ...device, connected: false, ready: false } },
    { device: { ...device, ready: false, connectionState: "display_render_failed" } },
  ]) {
    rerender(page(overrides));
    expect(nightCard().getByTestId("theme-status-pill").textContent).toBe("Installed");
    // The agreed fix leaves the existing live-theme rule alone.
    expect(within(document.getElementById("catalog-theme-clippy")!).getByText("Active")).toBeTruthy();
  }
  // A selection and a just-completed job cannot stand in for the device slot.
  rerender(page({
    device: { ...device, standby: { active: false } },
    busyAction: "install",
    installStatus: {
      phase: "complete", themeId: night.themeId, title: night.title,
      startedAt: "10:00:00", logs: [],
    },
  }));
  expect(nightCard().getByTestId("theme-status-pill").textContent).toBe("Installed");
});

it.each(["clippy", "night-clock"])("shows Installing only for the %s job, with both slots selected", (themeId) => {
  const job = plain.find((theme) => theme.themeId === themeId)!;
  render(
    <Page
      busyAction="install"
      device={{ connected: true, paired: true, ready: true }}
      installStatus={{
        phase: "installing", themeId, title: job.title,
        startedAt: "10:00:00", logs: [],
      }}
      selectedThemeId="clippy"
      selectedScreensaverId="night-clock"
      standby={{ brightnessPercent: 20, enabled: true, timeoutMinutes: 10 }}
      themeInstallEnabled
    />,
  );
  expect(screen.getAllByRole("button", { name: "Installing" })).toHaveLength(1);
  const installing = within(document.getElementById(`catalog-theme-${themeId}`)!)
    .getByRole("button", { name: "Installing" });
  expect(installing.querySelector('[data-slot="spinner"]')).not.toBeNull();
  const otherId = themeId === "clippy" ? "night-clock" : "clippy";
  const otherCard = within(document.getElementById(`catalog-theme-${otherId}`)!);
  expect(otherCard.queryByRole("button", { name: "Installing" })).toBeNull();
  expect(otherCard.getByText("Wait")).toBeTruthy();
  expect(otherCard.queryByRole("button", { name: "Install" })).toBeNull();
});

it("searches by name only, ignoring case, and Esc clears the field", () => {
  render(<Page themes={withTags} />);
  const search = screen.getByRole("searchbox", { name: "Search" });
  fireEvent.change(search, { target: { value: "CLI" } });
  expect(names()).toEqual(["Preview Clippy"]);
  // Tags and type words are not searched.
  fireEvent.change(search, { target: { value: "pixel" } });
  expect(names()).toEqual([]);
  expect(screen.getByText("Nothing matches your search or filters.")).toBeTruthy();
  fireEvent.keyDown(search, { key: "Escape" });
  expect((search as HTMLInputElement).value).toBe("");
  expect(names()).toHaveLength(5);
});

it("searches inside the chosen segment", () => {
  render(<Page />);
  fireEvent.click(screen.getByRole("radio", { name: "Screensavers 2" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "c" } });
  expect(names()).toEqual(["Preview Night Clock", "Preview Reset Countdown"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "gauge" } });
  expect(names()).toEqual([]);
});

it("offers only the Status group while the catalog carries no tags", async () => {
  render(<Page />);
  await openFilters();
  expect(screen.queryByRole("group", { name: "Features" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Providers shown" })).toBeNull();
  const status = screen.getByRole("group", { name: "Status" });
  expect(within(status).getByRole("checkbox", { name: "Installed" })).toBeTruthy();
  expect(within(status).getByRole("checkbox", { name: "Update available" })).toBeTruthy();
});

it("filters by status from what VibeTV holds", async () => {
  render(
    <Page device={{ connected: true, paired: true, ready: true, activeTheme: "clippy" }} />,
  );
  const status = await openFilters();
  expect(within(status).getByRole("checkbox", { name: "Installed" }).closest("label")?.textContent).toBe(
    "Installed1",
  );
  fireEvent.click(within(status).getByRole("checkbox", { name: "Installed" }));
  expect(names()).toEqual(["Preview Clippy"]);
});

// #857: the keyboard user who pressed Update on a card keeps the place when the
// update completes and the card leaves the Update available list.
it("moves the focus to the Filters button when an updated card leaves the Update available list", async () => {
  const earlier = "/themes/u/mt-3-123456.json";
  const current = "/themes/u/mt-4-abcdef.json";
  const updatable = product("clippy", "Clippy", "live", {
    earlierThemeSpecPaths: [earlier],
    themeSpecPath: current,
  });
  const page = (path: string) => (
    <Page
      device={{
        connected: true,
        paired: true,
        ready: true,
        activeTheme: "clippy",
        display: { themeSpec: { path } },
      }}
      themeInstallEnabled
      themes={[updatable, ...plain.filter((theme) => theme.themeId !== "clippy")]}
    />
  );
  const { rerender } = render(page(earlier));
  const status = await openFilters();
  fireEvent.click(within(status).getByRole("checkbox", { name: "Update available" }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(names()).toEqual(["Preview Clippy"]);
  const update = screen.getByRole("button", { name: "Update" });
  update.focus();
  fireEvent.click(update);
  rerender(page(current));
  expect(names()).toEqual([]);
  expect(document.activeElement).toBe(filtersButton());
});

it("groups the tags, counts for the current segment, ORs within a group and ANDs across", async () => {
  render(<Page themes={withTags} />);
  fireEvent.click(screen.getByRole("radio", { name: "Themes 3" }));
  await openFilters();
  const features = screen.getByRole("group", { name: "Features" });
  const providers = screen.getByRole("group", { name: "Providers shown" });
  const label = (group: HTMLElement, name: string) =>
    within(group).getByRole("checkbox", { name }).closest("label")?.textContent;
  // Counts are for the Themes segment only.
  expect(label(features, "Agent states")).toBe("Agent states1");
  expect(label(features, "Animated")).toBe("Animated2");
  expect(label(features, "Clock")).toBe("Clock0");
  expect(label(features, "Pixel art")).toBe("Pixel art1");
  expect(label(providers, "1 provider")).toBe("1 provider2");
  expect(label(providers, "2 providers")).toBe("2 providers1");
  expect(label(providers, "3 or more")).toBe("3 or more0");

  // OR within a group.
  fireEvent.click(within(features).getByRole("checkbox", { name: "Agent states" }));
  fireEvent.click(within(features).getByRole("checkbox", { name: "Pixel art" }));
  expect(names()).toEqual(["Preview Claude Creature", "Preview Clippy"]);
  // AND across groups.
  fireEvent.click(within(providers).getByRole("checkbox", { name: "2 providers" }));
  expect(names()).toEqual(["Preview Clippy"]);
  expect(screen.getByText("1 result")).toBeTruthy();
  expect(filtersButton().textContent).toContain("3");
});

it("shows the picked options as chips that remove one, and Clear all removes all", async () => {
  render(<Page themes={withTags} />);
  await openFilters();
  fireEvent.click(screen.getByRole("checkbox", { name: "Animated" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "2 providers" }));
  expect(names()).toEqual(["Preview Clippy"]);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(screen.queryByRole("group", { name: "Status" })).toBeNull();

  // The chips stay under the bar when the popover is closed.
  expect(screen.getByRole("button", { name: "Remove filter Animated" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove filter 2 providers" }));
  expect(names()).toEqual(["Preview Claude Creature", "Preview Clippy"]);
  expect(screen.queryByRole("button", { name: "Remove filter 2 providers" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(names()).toHaveLength(5);
  expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
  expect(filtersButton().textContent).toBe("Filters");
});

it.each([
  { picked: ["Animated", "Clock", "2 providers"], removed: "Clock", next: "2 providers" },
  { picked: ["Animated", "Clock", "2 providers"], removed: "2 providers", next: "Clock" },
  { picked: ["Clock"], removed: "Clock", next: null },
])("keeps keyboard focus after removing $removed from $picked", async ({ picked, removed, next }) => {
  render(<Page themes={withTags} />);
  await openFilters();
  for (const name of picked) fireEvent.click(screen.getByRole("checkbox", { name }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  const chip = screen.getByRole("button", { name: `Remove filter ${removed}` });
  chip.focus();
  fireEvent.click(chip, { detail: 0 });
  expect(screen.queryByRole("button", { name: `Remove filter ${removed}` })).toBeNull();
  expect(document.activeElement).toBe(next
    ? screen.getByRole("button", { name: `Remove filter ${next}` })
    : filtersButton());
});

it("returns keyboard focus to Filters after the chip row Clear all disappears", async () => {
  render(<Page themes={withTags} />);
  await openFilters();
  fireEvent.click(screen.getByRole("checkbox", { name: "Clock" }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  const clear = screen.getByRole("button", { name: "Clear all" });
  clear.focus();
  fireEvent.click(clear, { detail: 0 });
  expect(screen.queryByRole("button", { name: /^Remove filter/ })).toBeNull();
  expect(document.activeElement).toBe(filtersButton());
});

it("leaves focus alone when removing an unfocused chip", async () => {
  render(<Page themes={withTags} />);
  await openFilters();
  fireEvent.click(screen.getByRole("checkbox", { name: "Clock" }));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  const search = screen.getByRole("searchbox", { name: "Search" });
  search.focus();
  fireEvent.click(screen.getByRole("button", { name: "Remove filter Clock" }));
  expect(document.activeElement).toBe(search);
});

it("keeps search, segment and filters working together", async () => {
  render(<Page themes={withTags} />);
  await openFilters();
  fireEvent.click(screen.getByRole("checkbox", { name: "1 provider" }));
  expect(names()).toEqual([
    "Preview Claude Creature",
    "Preview Gauge",
    "Preview Reset Countdown",
  ]);
  fireEvent.click(screen.getByRole("radio", { name: "Screensavers 2" }));
  expect(names()).toEqual(["Preview Reset Countdown"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "night" } });
  expect(names()).toEqual([]);
});

it("creates a theme or a screensaver directly in its own segment", () => {
  render(<Page start="live" />);
  fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
  expect(screen.getByText("Editor open: New Theme")).toBeTruthy();
  expect(created.spec?.usage).toBeUndefined();
  cleanup();

  render(<Page start="screensaver" />);
  fireEvent.click(screen.getByRole("button", { name: "Create screensaver" }));
  expect(screen.getByText("Editor open: New Screensaver")).toBeTruthy();
  expect(created.spec?.usage).toBe("screensaver");
});

// Build 2 QA: the shell hides its header row while the Studio draws its own,
// so it has to be told when the Studio opens and when the screen goes away.
it("tells the shell while the Studio is open and resets it when the screen goes away", () => {
  const onStudioOpenChange = vi.fn();
  const { unmount } = render(<Page start="live" onStudioOpenChange={onStudioOpenChange} />);
  expect(onStudioOpenChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "Create theme" }));
  expect(onStudioOpenChange).toHaveBeenLastCalledWith(true);
  unmount();
  expect(onStudioOpenChange).toHaveBeenLastCalledWith(false);
});

it("asks Theme or Screensaver when Create is pressed on All", async () => {
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const menu = await screen.findByRole("button", { name: "Screensaver" });
  expect(screen.getByRole("button", { name: "Theme" })).toBeTruthy();
  fireEvent.click(menu);
  expect(screen.getByText("Editor open: New Screensaver")).toBeTruthy();
  expect(created.spec?.usage).toBe("screensaver");
});

it("keeps the search, the Filters button and the segments able to wrap on a narrow window", () => {
  render(<Page />);
  const row = screen.getByRole("searchbox", { name: "Search" }).closest("div")!.parentElement!;
  expect(row.className).toContain("flex-wrap");
});

// 7197 review, point 9: the picture in the preview dialog is centred and has the card picture's 6 px corners.
it("centres the preview picture in the dialog with the same 6 px corners as the card picture", () => {
  render(<Page />);
  const cardPicture = screen.getAllByRole("listitem")[0].querySelector("span.relative.block");
  fireEvent.click(screen.getByRole("button", { name: "Preview Claude Creature" }));
  const dialog = screen.getByRole("dialog");
  const picture = dialog.querySelector("span.relative.block")!;
  expect(picture.parentElement?.classList).toContain("mx-auto");
  expect(picture.classList).toContain("rounded-[6px]");
  expect(cardPicture?.classList).toContain("rounded-[6px]");
});

it("wraps a long card title to a second line instead of running past the card edge", () => {
  render(<Page themes={[product("long", "Fixture Future Firmware Theme", "live")]} />);
  const title = within(screen.getByRole("listitem")).getByText("Fixture Future Firmware Theme");
  expect(title.className).toContain(THEME_CARD_TITLE_CLASS);
  expect(title.classList).not.toContain("truncate");
});
