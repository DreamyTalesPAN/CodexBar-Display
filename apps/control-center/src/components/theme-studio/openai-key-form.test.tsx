// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAIThemeCapabilities } from "@/lib/ai-theme";
import { ThemeStudioKeyRow } from "./openai-key-form";

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
  });

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
});
