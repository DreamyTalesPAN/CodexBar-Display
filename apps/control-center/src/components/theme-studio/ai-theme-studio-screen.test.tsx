// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAIThemeCandidate, fetchAIThemeCapabilities, generateAIThemeConcept, planAIThemeLayout } from "@/lib/ai-theme";
import { createBlankThemeSpec } from "@/lib/theme-studio";
import { AIThemeStudioScreen } from "./ai-theme-studio-screen";
import { createDesignElement } from "./design-controls";

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
    // The line is the shared ProcessSteps component, single variant, and has no cursor block.
    const processSteps = document.querySelector('[data-slot="process-steps"]');
    expect(processSteps?.getAttribute("data-variant")).toBe("single");
    expect(processSteps?.querySelectorAll(":scope > div")).toHaveLength(1);
    expect(document.querySelector('[class*="vibetv-caret-blink"]')).toBeNull();
    expect(document.querySelector('[class*="caret"]')).toBeNull();

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

  // A first-time design has no companion yet: the motion word comes once the
  // new concept has a companion that moves.
  it("adds the motion word once the new concept has a companion that moves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(planAIThemeLayout).mockResolvedValue({ mode: "scene", edits: [], notes: "" } as unknown as Awaited<ReturnType<typeof planAIThemeLayout>>);
      vi.mocked(generateAIThemeConcept).mockResolvedValue({ companions: [{ id: "pet-1", x: 10, y: 10, size: 32, fps: 4 }] } as unknown as Awaited<ReturnType<typeof generateAIThemeConcept>>);
      vi.mocked(buildAIThemeCandidate).mockReturnValue(new Promise(() => {}));
      render(<AIThemeStudioScreen />);
      await sendIdea();
      await waitFor(() => expect(vi.mocked(buildAIThemeCandidate)).toHaveBeenCalled());

      let seen = false;
      for (let i = 0; i < 10 && !seen; i++) {
        act(() => { vi.advanceTimersByTime(2500); });
        seen = statusLines()[0]?.textContent === "> Teaching it to move…";
      }
      expect(seen).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

describe("Theme Studio notices", () => {
  it("shows a notice in the header row, right-aligned and left of Save, not in the chat column", async () => {
    render(<AIThemeStudioScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Add manually" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Text/ }));

    const notice = await screen.findByText("Element added. Select it on the display to make it yours.");
    const header = document.querySelector("header") as HTMLElement;
    expect(header.contains(notice)).toBe(true);
    expect(notice.parentElement?.className).toContain("text-right");
    expect(notice.className).toContain("font-normal");
    expect(notice.compareDocumentPosition(screen.getByRole("button", { name: "Save" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("region", { name: "AI creation" }).contains(notice)).toBe(false);
    // The buttons keep their width, so a long notice wraps instead of pushing them out of the window.
    expect(screen.getByRole("button", { name: "Save" }).parentElement?.className).toContain("shrink-0");
    // The notice keeps a reserved width (two lines at most) and the design name is what gives way:
    // the header stays one row from 960 px up, so it does not grow taller.
    expect(notice.parentElement?.className).toContain("min-w-40");
    expect(notice.parentElement?.className).not.toContain("min-w-0");
    // Below 960 px the header wraps into two rows instead of pushing the buttons out of the window.
    expect(header.className.split(" ")).toContain("flex-wrap");
    expect(header.className.split(" ")).not.toContain("flex-nowrap");
    expect(header.className.split(" ")).toContain("min-[960px]:flex-nowrap");
  });

  it("cuts a long design name with an ellipsis and shows it in full on hover", () => {
    render(<AIThemeStudioScreen initialTheme={{ packName: "Freche Sonnenbrillen-Sammlung", source: "custom", spec: createBlankThemeSpec() }} />);
    const name = screen.getByLabelText("Design name") as HTMLInputElement;
    expect(name.title).toBe("Freche Sonnenbrillen-Sammlung");
    expect(name.className).toContain("text-ellipsis");
    fireEvent.change(name, { target: { value: "Neu" } });
    expect(name.value).toBe("Neu");
    expect(name.title).toBe("Neu");
  });

  it("does not touch the navigation, so the sidebar stays as the customer left it (no provider needed)", () => {
    render(<AIThemeStudioScreen />);
    expect(screen.getByLabelText("Design name")).toBeTruthy();
  });

  it("sets the chat text at 13 px", async () => {
    vi.mocked(planAIThemeLayout).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    expect(screen.getByText(/Describe a design, ask for a change/).className).toContain("text-[13px]");
    await sendIdea();
    expect((await screen.findByText("A tiny office at dusk")).className).toContain("text-[13px]");
  });

  it("sets the File menu entries in regular weight", async () => {
    render(<AIThemeStudioScreen />);
    fireEvent.click(within(document.querySelector("header") as HTMLElement).getByRole("button", { name: "File" }));
    for (const name of ["New design", "Open saved design…", "Open design file…", "Download editable design", "Export theme pack"]) {
      expect((await screen.findByRole("button", { name })).className).toContain("font-normal");
    }
  });

  it("opens the key dialog with a plain heading and no subtitle", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue({ enabled: true, providers: [{ id: "openai", configured: false }] } as never);
    vi.mocked(planAIThemeLayout).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    await sendIdea();
    const dialog = await screen.findByRole("dialog", { name: "Add OpenAI key" });
    expect(dialog.textContent).not.toContain("Create with AI");
    expect(dialog.textContent).not.toContain("Connect OpenAI to create your design.");
  });
});

describe("Theme Studio composer (master 19.10.)", () => {
  it("keeps Add/Cancel, Attach and the round Send button in the one input frame", async () => {
    render(<AIThemeStudioScreen />);
    const idea = await screen.findByLabelText("Your idea");
    const frame = idea.parentElement as HTMLElement;
    for (const name of ["Add manually", "Attach reference images", "Create"]) {
      expect(frame.contains(screen.getByRole("button", { name }))).toBe(true);
    }
    expect(screen.getByRole("button", { name: "Create" }).getAttribute("class")).toContain("size-8 rounded-full");
  });

  it("draws the composer in the template's sizes: 32 px buttons, 12 px gaps, no space under it, editor 520 px high in an 800 px window", async () => {
    render(<AIThemeStudioScreen />);
    const classes = (element: Element) => element.getAttribute("class")?.split(/\s+/) ?? [];
    const idea = await screen.findByLabelText("Your idea");
    const row = screen.getByRole("button", { name: "Create" }).parentElement as HTMLElement;
    // Textarea and button row each start 11 px under the line above (plus the 1 px frame), the row ends 7 px above it.
    expect(classes(idea)).toEqual(expect.arrayContaining(["min-h-0", "pt-[11px]"]));
    expect(classes(row)).toEqual(expect.arrayContaining(["pt-[11px]", "pb-[7px]"]));
    expect(classes(screen.getByRole("button", { name: "Add manually" }))).toContain("size-8");
    expect(classes(screen.getByRole("button", { name: "Attach reference images" }))).toContain("size-8");
    // The round Send button wins over the shell's own radius rule only with the important marker.
    expect(classes(screen.getByRole("button", { name: "Create" }))).toContain("rounded-full!");
    // The empty alert area under the composer takes no margin.
    expect(classes(screen.getByRole("region", { name: "AI creation" }).nextElementSibling!)).toContain("empty:mt-0");
    // The composer sits on the bottom edge: no fixed margin under the editor.
    expect(classes(document.querySelector("[data-theme-studio-root] main")!)).not.toContain("lg:mb-[98px]");
  });

  it("says what the field is for once there is a conversation, instead of a typed idea", async () => {
    vi.mocked(planAIThemeLayout).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    await sendIdea();

    const idea = screen.getByLabelText("Your idea") as HTMLTextAreaElement;
    await waitFor(() => expect(idea.placeholder).toBe("Describe your design or what to change…"));
  });
});

describe("Theme Studio small window", () => {
  it("keeps the chat input in a bounded chat column while the preview scrolls above it", async () => {
    render(<AIThemeStudioScreen />);
    const classes = (element: Element) => element.getAttribute("class")?.split(/\s+/) ?? [];
    const root = document.querySelector("[data-theme-studio-root]") as HTMLElement;
    const preview = document.getElementById("theme-design-canvas")!.parentElement!;
    const chatColumn = (await screen.findByRole("region", { name: "AI creation" })).parentElement!;

    // Below the wide layout the editor has the window height and only the preview scrolls.
    expect(classes(root)).toContain("h-[calc(100svh-86px)]");
    expect(classes(preview)).toContain("overflow-y-auto");
    // The chat column keeps its height, so the message list scrolls and the input stays visible.
    expect(classes(chatColumn)).toEqual(expect.arrayContaining(["max-lg:max-h-[40svh]", "max-lg:shrink-0"]));
    expect(chatColumn.contains(document.getElementById("ai-scene-request"))).toBe(true);
  });

  it("splits the wide editor 50/50, centers the preview and starts the chat at the top", async () => {
    render(<AIThemeStudioScreen />);
    const classes = (element: Element) => element.getAttribute("class")?.split(/\s+/) ?? [];
    const preview = document.getElementById("theme-design-canvas")!.parentElement!;
    const chatColumn = (await screen.findByRole("region", { name: "AI creation" })).parentElement!;
    for (const column of [preview, chatColumn]) expect(classes(column)).toEqual(expect.arrayContaining(["lg:flex-1", "lg:basis-0"]));
    expect(classes(chatColumn)).not.toContain("lg:w-[464px]");
    const frame = document.querySelector('[aria-label="Selection workspace"]')!.querySelector(":scope > div") as HTMLElement;
    expect(classes(frame)).toContain("row-start-2");
    expect(classes(frame.firstElementChild!)).toContain("mx-auto");
    expect(classes(screen.getByRole("log", { name: "Conversation" }))).not.toContain("[&>:first-child]:mt-auto");
  });
});

describe("Theme Studio Details in a low window", () => {
  it("gives Details their natural height so the left column scrolls as one and the colour field and palette are never cut off", async () => {
    const text = { ...createDesignElement("text", 1), text: "Hello" };
    render(<AIThemeStudioScreen initialTheme={{ packName: "Palette", source: "custom", spec: { ...createBlankThemeSpec(), primitives: [text] } }} />);
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    const picked = document.querySelector('[aria-label^="Select "]') as Element;
    fireEvent.pointerDown(picked, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(picked, { button: 0, pointerId: 1 });
    const trigger = await screen.findByRole("button", { name: "Details" });
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
    const tools = await screen.findByRole("region", { name: "Selected element tools" });
    const column = document.getElementById("theme-design-canvas")!.parentElement!;
    // Between the Details content and the left column only the column scrolls: no scroll area of its own that would cut the palette off.
    for (let node: HTMLElement | null = tools.parentElement; node && node !== column; node = node.parentElement) {
      expect(node.className, node.className).not.toMatch(/overflow-y-auto|overflow-auto|overflow-hidden/);
      expect(node.className, node.className).not.toMatch(/(^|\s)(lg:)?max-h-/);
    }
    expect(column.className).toContain("overflow-y-auto");
  });
});

describe("Theme Studio reference images", () => {
  function stubImageDecoding() {
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 10, height: 10, close: () => {} })) as unknown as typeof createImageBitmap;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,QUJD");
  }
  async function attachPicture() {
    const input = document.querySelector('input[type="file"][accept="image/png,image/jpeg,image/webp"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "IMG_2454.png", { type: "image/png" })] } });
    await waitFor(() => expect(document.querySelector('[aria-label="Attached reference images"]')).not.toBeNull());
  }

  it("moves the sent image into the message, empties the composer and sends it with the request", async () => {
    stubImageDecoding();
    vi.mocked(planAIThemeLayout).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    await attachPicture();
    await sendIdea();

    await waitFor(() => expect(vi.mocked(planAIThemeLayout)).toHaveBeenCalled());
    expect(vi.mocked(planAIThemeLayout).mock.calls[0][3]).toEqual(["QUJD"]);
    expect(document.querySelector('[aria-label="Attached reference images"]')).toBeNull();
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(within(log).getByRole("img", { name: "IMG_2454.png" })).toBeTruthy();
    expect(within(log).getByText("A tiny office at dusk")).toBeTruthy();
  });

  it("keeps only a 96 px thumbnail of the image in the finished turn, while the AI gets the full picture", async () => {
    globalThis.createImageBitmap = vi.fn(async () => ({ width: 1536, height: 1024, close: () => {} })) as unknown as typeof createImageBitmap;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: () => {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    // The data says how large each canvas was, so the test can read the size back.
    HTMLCanvasElement.prototype.toDataURL = vi.fn(function (this: HTMLCanvasElement) {
      return `data:image/png;base64,W${this.width}x${this.height}`;
    }) as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
    vi.mocked(planAIThemeLayout).mockResolvedValue({ mode: "answer", notes: "Here is my answer." } as unknown as Awaited<ReturnType<typeof planAIThemeLayout>>);
    render(<AIThemeStudioScreen />);
    await attachPicture();
    await sendIdea();
    await screen.findByText("Here is my answer.");

    expect(vi.mocked(planAIThemeLayout).mock.calls[0][3]).toEqual(["W768x512"]);
    const bubble = within(screen.getByRole("log", { name: "Conversation" })).getByRole("img", { name: "IMG_2454.png" });
    expect(bubble.style.backgroundImage).toContain("W96x64");
    expect(bubble.style.backgroundImage).not.toContain("W768x512");
  });

  it("gives the image back to the composer when the customer cancels", async () => {
    stubImageDecoding();
    vi.mocked(planAIThemeLayout).mockReturnValue(new Promise(() => {}));
    render(<AIThemeStudioScreen />);
    await attachPicture();
    await sendIdea();
    await waitFor(() => expect(vi.mocked(planAIThemeLayout)).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.querySelector('[aria-label="Attached reference images"]')).not.toBeNull();
  });

  it("gives the image back to the composer when the request fails", async () => {
    stubImageDecoding();
    vi.mocked(planAIThemeLayout).mockRejectedValue(new Error("The request failed."));
    render(<AIThemeStudioScreen />);
    await attachPicture();
    await sendIdea();

    await screen.findByText("The request failed.");
    expect(document.querySelector('[aria-label="Attached reference images"]')).not.toBeNull();
  });
});

describe("Theme Studio example copy", () => {
  // The built-in example loads without a status line; the sample button is
  // not reachable in jsdom (it fetches the render pack).
  it("no longer announces the built-in example with a notice", () => {
    const source = readFileSync("src/components/theme-studio/ai-theme-studio-screen.tsx", "utf8");
    expect(source).not.toContain("Built-in example loaded");
    expect(source).not.toContain("Click the flame to move it");
  });
});

describe("Theme Studio header", () => {
  it("puts a File menu with five text entries in the header and removes the gear dialog", async () => {
    render(<AIThemeStudioScreen />);
    expect(screen.queryByRole("button", { name: "Design settings" })).toBeNull();

    const header = document.querySelector("header") as HTMLElement;
    fireEvent.click(within(header).getByRole("button", { name: "File" }));
    const entries = ["New design", "Open saved design…", "Open design file…", "Download editable design", "Export theme pack"];
    for (const name of entries) {
      const item = await screen.findByRole("button", { name });
      expect(item.querySelector("svg")).toBeNull();
    }
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo last edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo edit" })).toBeTruthy();
  });
});

describe("Theme Studio send reason", () => {
  const sendButton = () => screen.getByRole("button", { name: "Send to VibeTV" });
  const reasonLine = () => document.getElementById("send-blocked-reason");
  // The tooltip sits on the wrapper: a disabled button takes no hover.
  const tooltipOf = (button: HTMLElement) => button.parentElement;

  it("says why an empty design cannot be sent, in the header and on the button", () => {
    render(<AIThemeStudioScreen />);

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    const reason = reasonLine();
    expect(reason?.textContent).toBe("Add at least one visual element.");
    const header = document.querySelector("header") as HTMLElement;
    expect(header.contains(reason)).toBe(true);
    expect(reason?.getAttribute("role")).toBe("status");
    expect(tooltipOf(sendButton())?.getAttribute("title")).toBe("Add at least one visual element.");
    expect(sendButton().hasAttribute("title")).toBe(false);
    expect(sendButton().getAttribute("aria-describedby")).toBe("send-blocked-reason");
  });

  it("shows a design limit reason once, in the header, not again in the chat alert", () => {
    const text = { ...createDesignElement("text", 1), text: "x".repeat(1100) };
    render(<AIThemeStudioScreen initialTheme={{ packName: "Long text", source: "custom", spec: { ...createBlankThemeSpec(), primitives: [text] } }} />);

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    const reason = reasonLine()?.textContent;
    expect(reason).toBeTruthy();
    expect(reason).not.toBe("Add at least one visual element.");
    expect(screen.queryByText(/This design needs an adjustment/)).toBeNull();
    expect(screen.getAllByText(reason as string)).toHaveLength(1);
    expect(tooltipOf(sendButton())?.getAttribute("title")).toBe(reason);
  });

  it("gives no reason while an install is running", () => {
    render(<AIThemeStudioScreen installStatus={{ phase: "installing", themeId: "other", title: "Other", startedAt: "10:00:00", logs: [] }} />);

    expect(sendButton().hasAttribute("disabled")).toBe(true);
    expect(reasonLine()).toBeNull();
    expect(tooltipOf(sendButton())?.hasAttribute("title")).toBe(false);
  });

  it("keeps the chat alert while no reason line can show, so the reason is never lost", () => {
    const text = { ...createDesignElement("text", 1), text: "x".repeat(1100) };
    render(<AIThemeStudioScreen
      initialTheme={{ packName: "Long text", source: "custom", spec: { ...createBlankThemeSpec(), primitives: [text] } }}
      installStatus={{ phase: "installing", themeId: "other", title: "Other", startedAt: "10:00:00", logs: [] }}
    />);

    expect(reasonLine()).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("This design needs an adjustment before saving.");
  });

  it("gives no reason while the design is being sent", async () => {
    const send = deferred<boolean>();
    render(<AIThemeStudioScreen onInstallTheme={() => send.promise} />);
    fireEvent.click(screen.getByRole("button", { name: "Add manually" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Text/ }));
    fireEvent.click(sendButton());

    await screen.findByRole("button", { name: "Sending…" });
    expect(reasonLine()).toBeNull();
    expect(tooltipOf(screen.getByRole("button", { name: "Sending…" }))?.hasAttribute("title")).toBe(false);
  });

  it("gives no reason when a valid design can be sent", async () => {
    render(<AIThemeStudioScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Add manually" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Text/ }));

    expect(sendButton().hasAttribute("disabled")).toBe(false);
    expect(reasonLine()).toBeNull();
    expect(tooltipOf(sendButton())?.hasAttribute("title")).toBe(false);
  });
});
