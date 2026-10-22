// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceCandidate } from "../control-center-types";
import { SetupDevicePickerDialog } from "./setup-device-dialogs";
import { SetupDeviceScreen } from "./setup-device-screen";
import { candidateKey } from "./setup-connection";
import { SetupThemeScreen, type SetupThemeOption } from "./setup-theme-screen";

afterEach(() => {
  cleanup();
});

// Issue #214: the choices of setup are one radio group each. Tab reaches the
// group once, and the arrow keys move between its radios and select them.
const themes: SetupThemeOption[] = [
  { id: "claude-creature", name: "Claude Creature" },
  { id: "clippy", name: "Clippy" },
  { id: "mini-classic", name: "Mini Classic" },
];

const known: DeviceCandidate = {
  target: "http://192.168.178.153",
  deviceId: "5804508",
  firmware: "1.0.55",
  known: true,
};
const other: DeviceCandidate = {
  target: "http://192.168.178.159",
  deviceId: "5863327",
  firmware: "1.0.55",
};

function radios() {
  return screen.getAllByRole("radio");
}

function tabStops() {
  return radios().map((radio) => radio.tabIndex);
}

// The customer reaches a radio with Tab or a click; the test starts there too.
function pressKey(radio: HTMLElement, key: string) {
  radio.focus();
  fireEvent.keyDown(radio, { key });
}

describe("setup theme choice", () => {
  function renderThemes(selectedThemeId: string | null, onSelect = vi.fn()) {
    render(
      <SetupThemeScreen
        onInstall={vi.fn()}
        onSelect={onSelect}
        selectedThemeId={selectedThemeId}
        themes={themes}
      />,
    );
    return onSelect;
  }

  it("gives the group one Tab stop, on the selected theme", () => {
    renderThemes("clippy");
    expect(tabStops()).toEqual([-1, 0, -1]);
  });

  it("gives the group one Tab stop, on the first theme when none is selected", () => {
    renderThemes(null);
    expect(tabStops()).toEqual([0, -1, -1]);
  });

  it("moves to the next theme with ArrowDown and selects it", () => {
    const onSelect = renderThemes("clippy");
    pressKey(radios()[1], "ArrowDown");
    expect(document.activeElement).toBe(radios()[2]);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "mini-classic" }));
  });

  it("selects the theme whose card is clicked, with the same handler", () => {
    const onSelect = renderThemes("clippy");
    fireEvent.click(radios()[2]);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "mini-classic" }));
  });

  it("moves back with ArrowUp and wraps around at both ends", () => {
    const onSelect = renderThemes("claude-creature");
    pressKey(radios()[0], "ArrowUp");
    expect(document.activeElement).toBe(radios()[2]);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "mini-classic" }));
    pressKey(radios()[2], "ArrowRight");
    expect(document.activeElement).toBe(radios()[0]);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "claude-creature" }));
  });
});

describe("setup device choice", () => {
  it("gives the group one Tab stop, on the selected device", () => {
    render(
      <SetupDeviceScreen
        candidates={[known, other]}
        logLines={[]}
        onChooseTransport={vi.fn()}
        onConfigureWiFi={vi.fn()}
        onConnect={vi.fn()}
        onEnterAddressManually={vi.fn()}
        onScanWiFiNetworks={vi.fn()}
        onSearchAgain={vi.fn()}
        onSelect={vi.fn()}
        onWiFiError={vi.fn()}
        selectedTarget={candidateKey(other)}
        transport="wifi"
      />,
    );
    expect(tabStops()).toEqual([-1, 0]);
  });

  it("moves to the next device with ArrowDown and selects it", () => {
    const onSelect = vi.fn();
    render(
      <SetupDeviceScreen
        candidates={[known, other]}
        logLines={[]}
        onChooseTransport={vi.fn()}
        onConfigureWiFi={vi.fn()}
        onConnect={vi.fn()}
        onEnterAddressManually={vi.fn()}
        onScanWiFiNetworks={vi.fn()}
        onSearchAgain={vi.fn()}
        onSelect={onSelect}
        onWiFiError={vi.fn()}
        selectedTarget={candidateKey(known)}
        transport="wifi"
      />,
    );
    pressKey(radios()[0], "ArrowDown");
    expect(document.activeElement).toBe(radios()[1]);
    expect(onSelect).toHaveBeenLastCalledWith(other);
  });
});

describe("setup device picker", () => {
  it("moves between the found VibeTVs with the arrow keys and marks the one reached", () => {
    render(
      <SetupDevicePickerDialog
        candidates={[known, other]}
        error={null}
        onConnect={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    expect(tabStops()).toEqual([0, -1]);
    pressKey(radios()[0], "ArrowDown");
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(radios()[0].getAttribute("aria-checked")).toBe("false");
  });
});
