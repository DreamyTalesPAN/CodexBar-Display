// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAIThemeCapabilities, generateAIThemeConcept, planAIThemeLayout } from "@/lib/ai-theme";
import { AIThemeStudioScreen } from "./ai-theme-studio-screen";

vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ open: true, setOpen: () => {} }),
}));

vi.mock("@/lib/ai-theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-theme")>()),
  fetchAIThemeCapabilities: vi.fn(),
  planAIThemeLayout: vi.fn(),
  generateAIThemeConcept: vi.fn(),
  buildAIThemeCandidate: vi.fn(),
  saveAIThemeCredential: vi.fn(),
  verifyAIThemeCredential: vi.fn(),
  deleteAIThemeCredential: vi.fn(),
}));

const PLANNING = ["Understanding your idea…", "Sketching a plan…", "Picking a palette…"];
const DRAWING = ["Getting the paint ready…", "Mixing the colors…", "Drawing the picture…", "Placing every pixel…", "Checking the light…", "Letting the paint dry…", "Cleaning the brushes…"];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** The one visible status line: a span whose text starts with the "> " prefix. */
function statusLines() {
  return screen.queryAllByText(/^> /, { selector: "span" });
}

beforeAll(() => {
  // jsdom lacks these browser APIs the editor uses for layout.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
});

afterEach(() => cleanup());

beforeEach(() => {
  vi.mocked(fetchAIThemeCapabilities).mockResolvedValue({
    enabled: true,
    providers: [{ id: "openai", configured: true, verificationRequired: false }],
  } as unknown as Awaited<ReturnType<typeof fetchAIThemeCapabilities>>);
  vi.mocked(planAIThemeLayout).mockReset();
  vi.mocked(generateAIThemeConcept).mockReset();
});

async function sendIdea() {
  const idea = await screen.findByLabelText("Your idea");
  fireEvent.change(idea, { target: { value: "A tiny office at dusk" } });
  const create = within(screen.getByRole("region", { name: "AI creation" })).getByRole("button", { name: "Create" });
  await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
  fireEvent.click(create);
}

describe("Theme Studio progress line", () => {
  it("shows one status line that swaps words only within the planning step, then jumps to the drawing step", async () => {
    const plan = deferred<Awaited<ReturnType<typeof planAIThemeLayout>>>();
    vi.mocked(planAIThemeLayout).mockReturnValue(plan.promise);
    vi.mocked(generateAIThemeConcept).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    await sendIdea();

    await waitFor(() => expect(statusLines()).toHaveLength(1));
    expect(PLANNING).toContain(statusLines()[0].textContent?.replace(/^> /, ""));
    expect(statusLines()[0].textContent).toBe("> Understanding your idea…");

    // Within the planning step the word swaps after 2.5 s, still one line.
    await waitFor(() => expect(statusLines()[0].textContent).not.toBe("> Understanding your idea…"), { timeout: 4000 });
    expect(statusLines()).toHaveLength(1);
    expect(PLANNING).toContain(statusLines()[0].textContent?.replace(/^> /, ""));

    // Real step 2 begins: the line jumps to the drawing step's first word.
    await act(async () => {
      plan.resolve({ mode: "scene", edits: [], notes: "" } as unknown as Awaited<ReturnType<typeof planAIThemeLayout>>);
    });
    await waitFor(() => expect(statusLines()[0]?.textContent).toBe("> Getting the paint ready…"));
    expect(statusLines()).toHaveLength(1);
    expect(DRAWING).toContain(statusLines()[0].textContent?.replace(/^> /, ""));
  });

  it("has no seconds counter", async () => {
    vi.mocked(planAIThemeLayout).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    await sendIdea();
    await waitFor(() => expect(statusLines()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByText(/^\d+ s$/)).toBeNull();
    expect(document.querySelector(".animate-bounce")).toBeNull();
  });
});

describe("Theme Studio header", () => {
  it("puts a File menu with five icon entries in the header and removes the gear dialog", async () => {
    render(<AIThemeStudioScreen />);
    expect(screen.queryByRole("button", { name: "Design settings" })).toBeNull();

    const header = document.querySelector("header") as HTMLElement;
    fireEvent.click(within(header).getByRole("button", { name: "File" }));
    const entries = ["New design", "Open saved design…", "Open design file…", "Download editable design", "Export theme pack"];
    for (const name of entries) {
      const item = await screen.findByRole("button", { name });
      expect(item.querySelector("svg")).not.toBeNull();
    }
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo last edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo edit" })).toBeTruthy();
  });
});
