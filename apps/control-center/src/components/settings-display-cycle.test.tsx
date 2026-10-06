// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsScreen, type SettingsScreenProps } from "./settings-screen";
const previews = ["Codex", "Claude"].map(providerLabel => ({
  providerLabel, resetLabel: null, windows: [{ label: "Weekly", percent: 23 }],
}));
const props: SettingsScreenProps = {
  automaticPreviews: previews, device: null, brightness: 50, busyAction: null,
  connectionMode: "cable", standby: null,
  onBrightnessChange: vi.fn(), onChooseScreensaver: vi.fn(), onConnectionModeChange: vi.fn(),
  onDismissError: vi.fn(), onResetSetup: vi.fn(), onSaveBrightness: vi.fn(),
  onSaveStandby: vi.fn(), onStandbyBrightnessChange: vi.fn(),
  providerPicker: {
    usage: null,
    display: { configured: true, valid: true, mode: "automatic", providerIds: ["codex", "claude"] },
    items: [], pendingCheckIds: new Set(), pendingPreferenceIds: new Set(),
    onCheck: vi.fn(), onDisplayChange: vi.fn(), onPreferenceChange: vi.fn(),
  },
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("cycles the Automatic example without changing device selection and handles a shrinking list", () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const result = render(<SettingsScreen {...props} />);
  const automatic = screen.getByRole("button", { name: /Automatic/ });
  const manual = screen.getByRole("button", { name: /Manual/ });
  const manualBefore = manual.textContent;
  expect(within(automatic).getByText("Codex")).toBeTruthy();
  act(() => vi.advanceTimersByTime(3000));
  expect(within(automatic).getByText("Claude")).toBeTruthy();
  expect(manual.textContent).toBe(manualBefore);
  expect(props.providerPicker.onDisplayChange).not.toHaveBeenCalled();
  result.rerender(<SettingsScreen {...props} automaticPreviews={previews.slice(0, 1)} />);
  expect(within(automatic).getByText("Codex")).toBeTruthy();
  act(() => vi.advanceTimersByTime(6000));
  expect(within(automatic).getByText("Codex")).toBeTruthy();
  result.rerender(<SettingsScreen {...props} automaticPreviews={[]} />);
  expect(within(automatic).getByText("No usage yet")).toBeTruthy();
});
