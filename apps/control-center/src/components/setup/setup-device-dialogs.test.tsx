// @vitest-environment jsdom
//
// A wrong IP address used to produce nothing at all: the dialog closed, the
// device list was emptied, and the two error messages the app produced never
// reached a screen. The dialog must keep the address the customer typed and
// say why it did not work.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SetupAddressDialog,
  SetupDeviceNotFoundDialog,
  SetupWiFiPhoneDialog,
} from "./setup-device-dialogs";

afterEach(() => {
  cleanup();
});

function address() {
  return screen.getByLabelText("IP address") as HTMLInputElement;
}

function typeAddress(value: string) {
  fireEvent.change(address(), { target: { value } });
}

function connect() {
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
}

describe("Setup WiFi recovery", () => {
  it("keeps phone instructions reachable after closing and supports manual entry", () => {
    const onEnterAddressManually = vi.fn();
    const onScanAgain = vi.fn();
    render(
      <SetupWiFiPhoneDialog
        onEnterAddressManually={onEnterAddressManually}
        onScanAgain={onScanAgain}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Connect to WiFi" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Set up WiFi with your phone" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(onScanAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Enter IP manually" }));
    expect(onEnterAddressManually).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("routes the two not-found choices separately", () => {
    const onUseCable = vi.fn();
    const onSetUpWiFi = vi.fn();
    const onScanAgain = vi.fn();
    render(
      <SetupDeviceNotFoundDialog
        open
        onOpenChange={vi.fn()}
        onEnterAddressManually={vi.fn()}
        onScanAgain={onScanAgain}
        onUseCable={onUseCable}
        onSetUpWiFi={onSetUpWiFi}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Use the cable/ }));
    expect(onUseCable).toHaveBeenCalledTimes(1);
    expect(onScanAgain).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /Set up WiFi with your phone/ }),
    );
    expect(onSetUpWiFi).toHaveBeenCalledTimes(1);
  });
});

describe("SetupAddressDialog", () => {
  it("shows why the address did not work and keeps it for correction", async () => {
    const onConnect = vi
      .fn()
      .mockResolvedValue("No VibeTV answered at that IP address.");
    render(
      <SetupAddressDialog onConnect={onConnect} onOpenChange={vi.fn()} open />,
    );

    typeAddress("192.168.178.9");
    connect();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "No VibeTV answered at that IP address.",
      ),
    );
    expect(onConnect).toHaveBeenCalledWith("http://192.168.178.9");
    expect(address().value).toBe("192.168.178.9");
  });

  it("rejects an address the customer can still fix before asking the network", () => {
    const onConnect = vi.fn();
    render(
      <SetupAddressDialog onConnect={onConnect} onOpenChange={vi.fn()} open />,
    );

    typeAddress("vibetv.local");
    connect();

    expect(screen.getByRole("alert").textContent).toBe(
      "Enter the IP address shown on the VibeTV screen.",
    );
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("does not ask twice while the first attempt is still running", async () => {
    let release: (value: string | null) => void = () => {};
    const onConnect = vi.fn().mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    render(
      <SetupAddressDialog onConnect={onConnect} onOpenChange={vi.fn()} open />,
    );

    typeAddress("192.168.178.9");
    connect();
    fireEvent.keyDown(address(), { key: "Enter" });

    expect(onConnect).toHaveBeenCalledTimes(1);
    release(null);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
