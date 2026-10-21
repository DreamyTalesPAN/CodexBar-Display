// @vitest-environment jsdom
//
// #265: the weak WiFi notice opens when the Companion reports a WiFi VibeTV
// with a weak signal. A cable VibeTV and a signal that is not weak get no notice.
// Closing it keeps it closed through a short disconnect, and waits while another
// dialog of the page is open.
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import type { DeviceInfo } from "./control-center-types";
import {
  WeakWiFiDialog,
  weakWiFiCopy,
  weakWiFiSignal,
  useWeakWiFiDismissal,
} from "./weak-wifi-dialog";

afterEach(cleanup);

const wifiDevice = (weak?: boolean): DeviceInfo => ({
  active: true,
  connected: true,
  paired: true,
  target: "192.168.1.20",
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

function page(other: string | null) {
  return createElement(
    "div",
    null,
    other ? createElement("div", { role: other }, "Delete this theme?") : null,
    createElement(WeakWiFiDialog, { onClose: () => {} }),
  );
}

const weak = () => screen.queryByRole("dialog", { name: weakWiFiCopy.title });

for (const role of ["dialog", "alertdialog"]) {
  it(`waits while a ${role} is open`, async () => {
    const { rerender } = render(page(null));
    expect(weak()).not.toBeNull();

    await act(async () => rerender(page(role)));
    expect(weak()).toBeNull();

    await act(async () => rerender(page(null)));
    expect(weak()).not.toBeNull();
  });
}

it("has no accessibility violations while it is open", async () => {
  render(createElement(WeakWiFiDialog, { onClose: () => {} }));
  await expectNoAxeViolations(document.body.innerHTML);
});

// Lets the reset after a recovery run.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

it("stays closed through a short disconnect and opens again after the signal recovers", async () => {
  const { result, rerender } = renderHook(
    ({ device }) => useWeakWiFiDismissal(device),
    { initialProps: { device: wifiDevice(true) } },
  );
  act(() => result.current[1]());
  expect(result.current[0]).toBe(true);

  rerender({ device: { ...wifiDevice(true), connected: false } });
  await settle();
  expect(result.current[0]).toBe(true);
  rerender({ device: wifiDevice(true) });
  expect(result.current[0]).toBe(true);

  rerender({ device: wifiDevice(false) });
  await settle();
  expect(result.current[0]).toBe(false);

  rerender({ device: wifiDevice(true) });
  expect(result.current[0]).toBe(false);
});

it("opens again when the Companion sends a WiFi reading without the weak flag", async () => {
  // The Companion omits `weak` when the signal is fine (omitempty), so a recovery
  // arrives as a reading with no `weak` key at all.
  const recovered = {
    ...wifiDevice(true),
    health: { ok: true, wifi: { rssi: -60 } },
  } as DeviceInfo;
  const { result, rerender } = renderHook(
    ({ device }) => useWeakWiFiDismissal(device),
    { initialProps: { device: wifiDevice(true) } },
  );
  act(() => result.current[1]());
  expect(result.current[0]).toBe(true);

  rerender({ device: recovered });
  await settle();
  expect(result.current[0]).toBe(false);

  rerender({ device: wifiDevice(true) });
  expect(result.current[0]).toBe(false);
});

it("stays closed when the same VibeTV comes back on a new address", () => {
  // A reconnect can bring a new DHCP address; the device, not its IP, is the one closed.
  const { result, rerender } = renderHook(
    ({ device }) => useWeakWiFiDismissal(device),
    { initialProps: { device: { ...wifiDevice(true), deviceId: "vibetv-a" } as DeviceInfo } },
  );
  act(() => result.current[1]());

  rerender({ device: { ...wifiDevice(true), deviceId: "vibetv-a", target: "192.168.1.21" } as DeviceInfo });
  expect(result.current[0]).toBe(true);
});

it("opens again for another device", () => {
  const { result, rerender } = renderHook(
    ({ device }) => useWeakWiFiDismissal(device),
    { initialProps: { device: { ...wifiDevice(true), deviceId: "vibetv-a" } as DeviceInfo } },
  );
  act(() => result.current[1]());
  rerender({ device: { ...wifiDevice(true), deviceId: "vibetv-b" } as DeviceInfo });
  expect(result.current[0]).toBe(false);
});
