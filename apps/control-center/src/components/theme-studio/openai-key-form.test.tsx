// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAIThemeCapabilities, saveAIThemeCredential, verifyAIThemeCredential } from "@/lib/ai-theme";
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
  beforeEach(() => {
    vi.mocked(fetchAIThemeCapabilities).mockReset();
    // Consent is remembered in the browser; each test starts without it.
    localStorage.removeItem("vibetv.aiTheme.consent");
  });
  // A dialog left open by one test would otherwise show up in the next one.
  afterEach(() => cleanup());

  it("shows Not connected and Add key when no OpenAI key is saved", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    expect(await screen.findByText("Not connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add key" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Change key" })).toBeTruthy();
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

  it("offers a visible Close in the footer, hidden while a key is being checked", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    vi.mocked(saveAIThemeCredential).mockReturnValue(new Promise(() => {}));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    const dialog = await screen.findByRole("dialog");
    const footerButton = () => dialog.querySelector('[data-slot="dialog-footer"] button');
    expect(footerButton()?.textContent).toBe("Close");

    fireEvent.change(screen.getByLabelText("OpenAI key"), { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Checking…" })).toBeTruthy());
    expect(footerButton()).toBeNull();
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
  });
});
