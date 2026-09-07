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
import { SetupAddressDialog } from "./setup-device-dialogs";

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
