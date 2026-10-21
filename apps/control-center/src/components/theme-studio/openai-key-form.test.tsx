// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAIThemeCredential, fetchAIThemeCapabilities, saveAIThemeCredential, verifyAIThemeCredential } from "@/lib/ai-theme";
import { OpenAIKeyForm, ThemeStudioKeyRow } from "./openai-key-form";

vi.mock("@/lib/ai-theme", () => ({
  fetchAIThemeCapabilities: vi.fn(),
  saveAIThemeCredential: vi.fn(),
  verifyAIThemeCredential: vi.fn(),
  deleteAIThemeCredential: vi.fn(),
}));

function capabilities(configured: boolean) {
  return {
    enabled: true,
    providers: [{ id: "openai", configured, verificationRequired: false }],
  } as unknown as Awaited<ReturnType<typeof fetchAIThemeCapabilities>>;
}

describe("Theme Studio AI row in Settings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });
  // A dialog left open by one test would otherwise show up in the next one.
  afterEach(() => cleanup());

  it("shows Not connected and Add key when no OpenAI key is saved", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add key" })).toBeTruthy();
    // The template's outline buttons have 14 px of side space.
    expect(screen.getByRole("button", { name: "Add key" }).classList).toContain("px-3.5");
  });

  it("shows Connected and Change key once a key is saved", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    render(<ThemeStudioKeyRow />);
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change key" })).toBeTruthy();
  });

  it("opens the existing key form in a dialog and offers Disconnect when connected", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Replace OpenAI key" })).toBeTruthy());
    expect(dialog.textContent).not.toContain("Theme Studio AI");
    expect(dialog.textContent).not.toContain("Connect OpenAI");
    expect(screen.getByRole("button", { name: "Disconnect OpenAI" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update key" }).hasAttribute("disabled")).toBe(true);
  });

  it("titles the dialog Add OpenAI key when no key is saved, without a subtitle", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    const dialog = await screen.findByRole("dialog", { name: "Add OpenAI key" });
    expect(dialog.textContent).not.toContain("Theme Studio AI");
    expect(dialog.textContent).not.toContain("Connect OpenAI");
    expect(dialog.hasAttribute("aria-describedby")).toBe(false);
  });

  it("has its final layout from the first frame: no 'unavailable' notice while the helper is still being asked, and the key field is ready for focus", async () => {
    let answer!: (value: ReturnType<typeof capabilities>) => void;
    vi.mocked(fetchAIThemeCapabilities).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<OpenAIKeyForm inSetup={false} onConnectingChange={() => {}} onConnected={() => {}} onDisconnected={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByPlaceholderText("Paste your key here") as HTMLInputElement).disabled).toBe(false);
    answer(capabilities(false));
    await waitFor(() => expect(fetchAIThemeCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a late mount-time answer once Disconnect has started, so a deleted key does not come back", async () => {
    let answer!: (value: ReturnType<typeof capabilities>) => void;
    vi.mocked(fetchAIThemeCapabilities)
      .mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }))
      .mockResolvedValue(capabilities(false)); // the read after the delete
    vi.mocked(deleteAIThemeCredential).mockResolvedValue(undefined as never);
    const onConfiguredChange = vi.fn();
    render(
      <OpenAIKeyForm
        inSetup={false}
        initialConfigured={true}
        onConfiguredChange={onConfiguredChange}
        onConnectingChange={() => {}}
        onConnected={() => {}}
        onDisconnected={() => {}}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect OpenAI" }));
    await waitFor(() => expect(onConfiguredChange).toHaveBeenLastCalledWith(false));
    // The older read now resolves with the key still present.
    answer(capabilities(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onConfiguredChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("button", { name: "Disconnect OpenAI" })).toBeNull();
  });

  it("says AI is unavailable once the helper has answered that it is", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue({ enabled: false, providers: [] } as unknown as ReturnType<typeof capabilities>);
    render(<OpenAIKeyForm inSetup={false} onConnectingChange={() => {}} onConnected={() => {}} onDisconnected={() => {}} onDismiss={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toContain("AI is unavailable");
    expect((screen.getByPlaceholderText("Paste your key here") as HTMLInputElement).disabled).toBe(true);
  });

  it("follows a key that was saved while its check failed once the dialog is closed", async () => {
    vi.mocked(fetchAIThemeCapabilities)
      .mockResolvedValueOnce(capabilities(false)) // the row
      .mockResolvedValueOnce(capabilities(false)) // the form
      .mockResolvedValue({ enabled: true, providers: [{ id: "openai", configured: true, verificationRequired: true }] } as unknown as Awaited<ReturnType<typeof fetchAIThemeCapabilities>>);
    vi.mocked(saveAIThemeCredential).mockResolvedValue(undefined as never);
    vi.mocked(verifyAIThemeCredential).mockRejectedValue(new Error("Check failed."));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    fireEvent.change(await screen.findByLabelText("OpenAI key", { selector: "input" }), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByRole("button", { name: "Retry connection check" });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByRole("button", { name: "Change key" })).toBeTruthy();
  });

  it("tells the opener when a key was saved but its check failed, so the dialog title follows while it is open", async () => {
    vi.mocked(fetchAIThemeCapabilities)
      .mockResolvedValueOnce(capabilities(false))
      .mockResolvedValue({ enabled: true, providers: [{ id: "openai", configured: true, verificationRequired: true }] } as unknown as Awaited<ReturnType<typeof fetchAIThemeCapabilities>>);
    vi.mocked(saveAIThemeCredential).mockResolvedValue(undefined as never);
    vi.mocked(verifyAIThemeCredential).mockRejectedValue(new Error("Check failed."));
    const onConfiguredChange = vi.fn();
    render(<OpenAIKeyForm inSetup onConfiguredChange={onConfiguredChange} onConnectingChange={() => {}} onConnected={() => {}} onDisconnected={() => {}} onDismiss={() => {}} />);
    fireEvent.change(await screen.findByLabelText("OpenAI key", { selector: "input" }), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Connect and continue" }));
    await waitFor(() => expect(onConfiguredChange).toHaveBeenLastCalledWith("pending"));
  });

  it("keeps the pending state when the check fails and the follow-up read fails too (#847)", async () => {
    vi.mocked(fetchAIThemeCapabilities)
      .mockResolvedValueOnce(capabilities(false))
      .mockRejectedValue(new Error("Helper offline."));
    vi.mocked(saveAIThemeCredential).mockResolvedValue(undefined as never);
    vi.mocked(verifyAIThemeCredential).mockRejectedValue(new Error("Check failed."));
    const onConfiguredChange = vi.fn();
    render(<OpenAIKeyForm inSetup onConfiguredChange={onConfiguredChange} onConnectingChange={() => {}} onConnected={() => {}} onDisconnected={() => {}} onDismiss={() => {}} />);
    fireEvent.change(await screen.findByLabelText("OpenAI key", { selector: "input" }), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Connect and continue" }));
    await screen.findByRole("button", { name: "Retry connection check" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onConfiguredChange).toHaveBeenLastCalledWith("pending");
    expect(screen.getByRole("button", { name: "Retry connection check" })).toBeTruthy();
  });

  it("does not let the Settings row's first read overwrite a key that was saved meanwhile (#847)", async () => {
    let answerFirst!: (value: ReturnType<typeof capabilities>) => void;
    vi.mocked(fetchAIThemeCapabilities)
      .mockReturnValueOnce(new Promise((resolve) => { answerFirst = resolve; })) // the row's mount read, still pending
      .mockResolvedValueOnce(capabilities(false)) // the form's mount read
      .mockResolvedValue({ enabled: true, providers: [{ id: "openai", configured: true, verificationRequired: true }] } as unknown as ReturnType<typeof capabilities>);
    vi.mocked(saveAIThemeCredential).mockResolvedValue(undefined as never);
    vi.mocked(verifyAIThemeCredential).mockRejectedValue(new Error("Check failed."));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    fireEvent.change(await screen.findByLabelText("OpenAI key", { selector: "input" }), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await screen.findByRole("button", { name: "Retry connection check" });
    answerFirst(capabilities(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("button", { name: "Change key", hidden: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add key", hidden: true })).toBeNull();
  });

  it("enables Save key after Disconnect when the mount-time read was still pending (#847)", async () => {
    vi.mocked(fetchAIThemeCapabilities)
      .mockReturnValueOnce(new Promise(() => {})) // the mount read never answers in time
      .mockResolvedValue(capabilities(false)); // the read after the delete
    vi.mocked(deleteAIThemeCredential).mockResolvedValue(undefined as never);
    const onDisconnected = vi.fn();
    render(<OpenAIKeyForm inSetup={false} initialConfigured={true} onConnectingChange={() => {}} onConnected={() => {}} onDisconnected={onDisconnected} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect OpenAI" }));
    await waitFor(() => expect(onDisconnected).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText("OpenAI key", { selector: "input" }), { target: { value: "sk-new-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("keeps a verified key when the dialog is opened and closed before the reads answer (#847)", async () => {
    let answerRow!: (value: ReturnType<typeof capabilities>) => void;
    let answerForm!: (value: ReturnType<typeof capabilities>) => void;
    vi.mocked(fetchAIThemeCapabilities)
      .mockReturnValueOnce(new Promise((resolve) => { answerRow = resolve; })) // the row's mount read
      .mockReturnValueOnce(new Promise((resolve) => { answerForm = resolve; })); // the form's mount read
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    answerRow(capabilities(true));
    answerForm(capabilities(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change key" })).toBeTruthy();
  });

  it("has no close X in the key dialog", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector('[data-slot="dialog-close"]')).toBeNull();
  });

  it("opens through the same dialog as every other overlay, without an entrance animation and already at its final height", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    const dialog = screen.getByRole("dialog");
    // SetupDialog (Factory reset, Run setup again, ...) switches the entrance animation off and dims the screen with its own scrim.
    expect(dialog.style.animation).toBe("none");
    expect(document.querySelector('[aria-hidden="true"].fixed.inset-0')).not.toBeNull();
    // The saved-key state comes from the row, so nothing is added after the first frame and the dialog never jumps.
    expect(within(dialog).getByRole("heading", { name: "Replace OpenAI key" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Disconnect OpenAI" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Update key" })).toBeTruthy();
  });

  it("has Not now and the main action side by side, and Not now is disabled while a key is being checked", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    vi.mocked(saveAIThemeCredential).mockReturnValue(new Promise(() => {}));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    const dialog = await screen.findByRole("dialog");
    const notNow = within(dialog).getByRole("button", { name: "Not now" });
    const main = within(dialog).getByRole("button", { name: "Save key" });
    expect(notNow.parentElement).toBe(main.parentElement);
    expect(notNow.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(screen.getByLabelText("OpenAI key", { selector: "input" }), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(main);
    await waitFor(() => expect(screen.getByRole("button", { name: "Checking…" })).toBeTruthy());
    expect(within(dialog).getByRole("button", { name: "Not now" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the Settings row as API key, a status dot, the status and an outline button", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    const { container } = render(<ThemeStudioKeyRow />);
    await screen.findByText("Connected");
    expect(screen.getByText("API key")).toBeTruthy();
    expect(container.firstElementChild?.className).not.toContain("border");
    expect(container.querySelector("i")?.className).toContain("bg-[oklch(0.72_0.15_150)]");
    expect(screen.getByRole("button", { name: "Change key" }).className).toContain("text-[13px]");
  });

  it("shows Change key on the row while a saved key is still being checked", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue({
      enabled: true,
      providers: [{ id: "openai", configured: true, verificationRequired: true }],
    } as unknown as Awaited<ReturnType<typeof fetchAIThemeCapabilities>>);
    render(<ThemeStudioKeyRow />);
    expect(await screen.findByRole("button", { name: "Change key" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add key" })).toBeNull();
  });

  it("keeps Update key for a saved key that still needs its check", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue({
      enabled: true,
      providers: [{ id: "openai", configured: true, verificationRequired: true }],
    } as unknown as Awaited<ReturnType<typeof fetchAIThemeCapabilities>>);
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    await screen.findByRole("dialog");
    fireEvent.change(await screen.findByLabelText("Replace OpenAI key", { selector: "input" }), { target: { value: "sk-new-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Update key" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save key" })).toBeNull();
  });

  it("says Save key in the key dialog when no key is stored", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Save key" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update key" })).toBeNull();
  });

  it("says Update key in the key dialog once a key is stored", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Update key" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save key" })).toBeNull();
  });

  it("keeps Connect and continue in the setup flow when no key is stored", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(
      <OpenAIKeyForm
        inSetup
        onConnectingChange={() => {}}
        onConnected={() => {}}
        onDisconnected={() => {}}
        onDismiss={() => {}}
      />,
    );
    await screen.findByLabelText("OpenAI key");
    expect(screen.getByRole("button", { name: "Connect and continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save key" })).toBeNull();
  });

  it("draws the consent checkbox in the lime primary colour, not the browser blue", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    const checkbox = await screen.findByRole("checkbox");
    expect(checkbox.className).toContain("accent-primary");
  it.each([false, true])("does not mark the replacement key invalid after a failed disconnect (edited: %s)", async (edited) => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    vi.mocked(deleteAIThemeCredential).mockRejectedValue(new Error("Helper unavailable"));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect OpenAI" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("Could not disconnect. Try again.");
    const input = screen.getByLabelText("Replace OpenAI key");
    if (edited) fireEvent.change(input, { target: { value: "unchecked-replacement" } });
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)).toBe(error);
    expect(error.textContent).toBe("Could not disconnect. Try again.");
  });

  it.each(["save", "verify"])("keeps a %s connection failure visible without invalidating the cleared or newly typed key", async (stage) => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(true));
    vi.mocked(saveAIThemeCredential).mockResolvedValue(undefined);
    vi.mocked(verifyAIThemeCredential).mockResolvedValue(true);
    vi.mocked(stage === "save" ? saveAIThemeCredential : verifyAIThemeCredential)
      .mockRejectedValue(new Error("Connection unavailable"));
    localStorage.setItem("vibetv.aiTheme.consent", "1");
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Change key" }));
    const input = await screen.findByLabelText("Replace OpenAI key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "unchecked-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Update key" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Connection unavailable");
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    fireEvent.change(input, { target: { value: "another-unchecked-key" } });
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Connection unavailable");
  });
});
