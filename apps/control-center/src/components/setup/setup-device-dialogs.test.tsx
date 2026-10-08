// @vitest-environment jsdom
//
// A wrong IP address used to produce nothing at all: the dialog closed, the
// device list was emptied, and the two error messages the app produced never
// reached a screen. The dialog must keep the address the customer typed and
// say why it did not work.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import {
  SetupAddressDialog,
  SetupCableHelpDialog,
  SetupConnectFailedDialog,
  SetupDeviceNotFoundDialog,
} from "./setup-device-dialogs";
import { SetupRecoveryDialogs } from "./setup-recovery-dialogs";
import { SetupWizardTitle } from "./setup-wizard-screen";

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
  it("keeps cable instructions reachable after closing and supports manual entry", () => {
    const onEnterAddressManually = vi.fn();
    const onScanAgain = vi.fn();
    render(
      <SetupCableHelpDialog
        onEnterAddressManually={onEnterAddressManually}
        onScanAgain={onScanAgain}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Connect the USB cable" });
    // Issue #489: setup never runs over a VibeTV-Setup network or a phone.
    expect(dialog.textContent).not.toContain("VibeTV-Setup");
    expect(dialog.textContent).not.toContain("192.168.4.1");
    expect(dialog.textContent).not.toContain("phone");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "How to connect VibeTV" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Scan again" }));
    expect(onScanAgain).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Enter IP manually" }));
    expect(onEnterAddressManually).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("routes the two not-found choices separately", () => {
    const onUseCable = vi.fn();
    const onUseWiFi = vi.fn();
    const onScanAgain = vi.fn();
    render(
      <SetupDeviceNotFoundDialog
        open
        onOpenChange={vi.fn()}
        onEnterAddressManually={vi.fn()}
        onScanAgain={onScanAgain}
        onUseCable={onUseCable}
        onUseWiFi={onUseWiFi}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Use the cable/ }));
    expect(onUseCable).toHaveBeenCalledTimes(1);
    expect(onScanAgain).not.toHaveBeenCalled();
    expect(screen.queryByText(/phone/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Already on WiFi/ }));
    expect(onUseWiFi).toHaveBeenCalledTimes(1);
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

describe("Setup device dialogs accessibility", () => {
  it.each([
    ["cable help", <SetupCableHelpDialog key="cable" onEnterAddressManually={vi.fn()} onScanAgain={vi.fn()} />],
    [
      "VibeTV not found",
      <SetupDeviceNotFoundDialog
        key="not-found"
        open
        onOpenChange={vi.fn()}
        onEnterAddressManually={vi.fn()}
        onScanAgain={vi.fn()}
        onUseCable={vi.fn()}
        onUseWiFi={vi.fn()}
      />,
    ],
    ["IP address", <SetupAddressDialog key="address" onConnect={vi.fn()} onOpenChange={vi.fn()} open />],
  ])("has no violations in the %s dialog", async (_name, dialog) => {
    render(dialog);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await expectNoAxeViolations(document.body.innerHTML);
  });

  it("takes focus when it opens and hands it back when it closes", async () => {
    const page = (open: boolean) => (
      <>
        <button type="button">Enter IP manually</button>
        <SetupAddressDialog onConnect={vi.fn()} onOpenChange={vi.fn()} open={open} />
      </>
    );
    const view = render(page(false));
    const opener = screen.getByRole("button", { name: "Enter IP manually" });
    opener.focus();
    view.rerender(page(true));
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    view.rerender(page(false));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

// A closing dialog hands focus back a moment after it closed. By then focus
// can already be where it belongs: in the dialog that opened in its place, or
// in a field the customer clicked. Handing it back then took it away.
describe("Focus when a dialog closes while focus is already elsewhere", () => {
  // The closing dialog's hand-back runs on a timer of its own.
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  const recovery = (phase: "repairing" | "failed" | null) => (
    <>
      <button type="button">Behind</button>
      <input aria-label="Field" />
      <SetupRecoveryDialogs
        onHide={vi.fn()}
        onRestart={vi.fn()}
        onRetry={vi.fn()}
        phase={phase}
        retrying={false}
      />
    </>
  );

  it("leaves focus in Enter IP address when it opens from the failed search", async () => {
    function DeviceStep() {
      const [failed, setFailed] = useState(true);
      const [address, setAddress] = useState(false);
      return (
        <>
          <SetupWizardTitle>Connect your VibeTV</SetupWizardTitle>
          <SetupConnectFailedDialog
            description="The search could not be made."
            onEnterAddressManually={() => {
              setFailed(false);
              setAddress(true);
            }}
            onOpenChange={setFailed}
            onSearchAgain={vi.fn()}
            open={failed}
            title="We couldn't search for your VibeTV"
          />
          <SetupAddressDialog onConnect={vi.fn()} onOpenChange={setAddress} open={address} />
        </>
      );
    }
    render(<DeviceStep />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Enter IP manually" }));
    await settle();

    const dialog = screen.getByRole("dialog", { name: "Enter IP address" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("leaves focus in the dialog that replaces the repair dialog", async () => {
    const view = render(recovery(null));
    screen.getByRole("button", { name: "Behind" }).focus();
    view.rerender(recovery("repairing"));
    await settle();

    view.rerender(recovery("failed"));
    await settle();

    const dialog = screen.getByRole("dialog", {
      name: "VibeTV Control Center needs attention",
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("leaves focus in the field the customer clicked while the repair dialog was open", async () => {
    const view = render(recovery(null));
    screen.getByRole("button", { name: "Behind" }).focus();
    view.rerender(recovery("repairing"));
    await settle();
    const field = screen.getByRole("textbox", { name: "Field" });
    field.focus();

    view.rerender(recovery(null));
    await settle();

    expect(document.activeElement).toBe(field);
  });
});
