// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAIThemeCapabilities, saveAIThemeCredential } from "@/lib/ai-theme";
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
    await waitFor(() => expect(dialog.textContent).toContain("Replace OpenAI key"));
    expect(screen.getByRole("button", { name: "Disconnect OpenAI" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update key" }).hasAttribute("disabled")).toBe(true);
  });

  it("has no close X in the key dialog", async () => {
    vi.mocked(fetchAIThemeCapabilities).mockResolvedValue(capabilities(false));
    render(<ThemeStudioKeyRow />);
    fireEvent.click(await screen.findByRole("button", { name: "Add key" }));
    const dialog = await screen.findByRole("dialog");
    // The X is still in the markup, but this class hides it, so it is never shown.
    expect(dialog.className).toContain("[&_[data-slot=dialog-close]]:hidden");
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
