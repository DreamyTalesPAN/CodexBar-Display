// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAIThemeCredential,
  fetchAIThemeCapabilities,
  saveAIThemeCredential,
  verifyAIThemeCredential,
} from "@/lib/ai-theme";
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
  afterEach(cleanup);

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
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
