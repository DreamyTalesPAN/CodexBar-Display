// @vitest-environment jsdom
//
// #265: the weak WiFi notice opens when the Companion reports a WiFi VibeTV
// with a weak signal. A cable VibeTV and a signal that is not weak get no notice.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import type { DeviceInfo } from "./control-center-types";
import {
  WeakWiFiDialog,
  weakWiFiCopy,
  weakWiFiSignal,
} from "./weak-wifi-dialog";

afterEach(cleanup);

const wifiDevice = (weak?: boolean): DeviceInfo => ({
  active: true,
  connected: true,
  paired: true,
  health: { ok: true, wifi: { rssi: -82, weak } },
} as DeviceInfo);

it("opens for a connected WiFi VibeTV whose signal the Companion calls weak", () => {
  expect(weakWiFiSignal(wifiDevice(true))).toBe(true);
});

it("stays closed for a cable VibeTV, a signal that is not weak, or no device", () => {
  const cable = {
    active: true,
    connected: true,
    paired: true,
    target: "cable://vibetv",
    health: { ok: true },
  } as DeviceInfo;
  expect(weakWiFiSignal(cable)).toBe(false);
  expect(weakWiFiSignal(wifiDevice(false))).toBe(false);
  expect(weakWiFiSignal(wifiDevice(undefined))).toBe(false);
  expect(weakWiFiSignal({ ...wifiDevice(true), connected: false } as DeviceInfo)).toBe(false);
  expect(weakWiFiSignal(null)).toBe(false);
});

it("shows the approved text with one OK button that closes it", async () => {
  const onClose = vi.fn();
  render(createElement(WeakWiFiDialog, { onClose }));

  expect(screen.getByRole("dialog", { name: weakWiFiCopy.title })).not.toBeNull();
  expect(screen.getByText(weakWiFiCopy.description)).not.toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("has no accessibility violations while it is open", async () => {
  render(createElement(WeakWiFiDialog, { onClose: () => {} }));
  await expectNoAxeViolations(document.body.innerHTML);
});
