// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WHATS_NEW } from "@/lib/whats-new";
import { UpdatesScreen, type UpdatesScreenProps } from "./updates-screen";

afterEach(cleanup);

// The calm Updates screen as drawn in the approved master: one headline, one
// framed object with a row per component, the "What's new" note card.
const upToDate: UpdatesScreenProps = {
  companionStatus: "online",
  companionInfo: { app: { version: "1.0.64", installedInApplications: true } },
  companionRelease: {
    checkedAt: "2026-10-19T08:44:00Z",
    status: "available",
    latestVersion: "1.0.64",
    installedVersion: "1.0.64",
    updateAvailable: false,
    message: "Mac App is up to date.",
  },
  device: { connected: true, board: "esp8266-smalltv-st7789", firmware: "1.0.48" },
  firmwareUpdate: {
    checkedAt: "2026-10-19T08:44:00Z",
    status: "current",
    installedFirmware: "1.0.48",
    latestFirmware: "1.0.48",
    updateAvailable: false,
  },
  onCheckUpdates: () => undefined,
  onInstallUpdate: () => true,
  onShowWhatsNew: () => undefined,
};

const variant = (element: HTMLElement) => element.getAttribute("data-variant");

describe("calm Updates screen", () => {
  it("up to date: one headline, two quiet rows with one version each, an outline check button", () => {
    render(<UpdatesScreen {...upToDate} />);

    expect(screen.getByRole("heading", { level: 2, name: "Everything is up to date" })).toBeTruthy();
    const rows = screen.getAllByRole("heading", { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual(["Control Center", "VibeTV firmware"]);
    expect(screen.getAllByText("Up to date")).toHaveLength(2);
    expect(screen.getByText("1.0.64", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("1.0.48")).toBeTruthy();

    // Lime is only for a primary action, and nothing needs one here.
    expect(screen.queryByRole("link", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(variant(screen.getByRole("button", { name: "Check for updates" }))).toBe("outline");
  });

  it("checks for updates from the header button", () => {
    const check = vi.fn();
    render(<UpdatesScreen {...upToDate} onCheckUpdates={check} />);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("keeps the title row stacked below the page title until the window is wide (lg)", () => {
    render(<UpdatesScreen {...upToDate} />);
    const row = screen.getByRole("button", { name: "Check for updates" }).parentElement!;
    const classes = row.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["lg:relative", "lg:-mt-10", "lg:h-10", "lg:flex-nowrap", "lg:justify-end"]),
    );
    expect(classes.filter((name) => name.startsWith("sm:"))).toEqual([]);
  });

  it("titles the Windows row 'Control Center' too and never says Mac", () => {
    const { container } = render(<UpdatesScreen {...upToDate} windowsHost />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((row) => row.textContent)).toEqual([
      "Control Center",
      "VibeTV firmware",
    ]);
    expect(screen.getByText("App on this computer")).toBeTruthy();
    expect(container.textContent).not.toContain("Mac");
  });

  it("shows the What's new note card with the installed version and opens the notes", () => {
    const show = vi.fn();
    render(<UpdatesScreen {...upToDate} onShowWhatsNew={show} />);
    expect(screen.getByText("What's new in 1.0.64")).toBeTruthy();
    expect(screen.getByText(WHATS_NEW[WHATS_NEW.length - 1].title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read notes" }));
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("shows no What's new card when the notes cannot be opened", () => {
    render(<UpdatesScreen {...upToDate} onShowWhatsNew={undefined} />);
    expect(screen.queryByText(/What's new/)).toBeNull();
  });

  it("update available: the row with the update has a lime Update, the headline says so", () => {
    render(
      <UpdatesScreen
        {...upToDate}
        companionInfo={{ app: { version: "1.0.64", installedInApplications: false } }}
        companionRelease={{
          ...upToDate.companionRelease!,
          dmgDownloadStatus: "available",
          dmgDownloadUrl: "https://example.test/VibeTV-Control-Center.dmg",
          latestVersion: "1.0.65",
          updateAvailable: true,
        }}
        firmwareUpdate={{
          ...upToDate.firmwareUpdate!,
          latestFirmware: "1.0.49",
          status: "update_available",
          updateAvailable: true,
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Update available" })).toBeTruthy();
    const update = screen.getByRole("link", { name: "Update" });
    expect(variant(update)).toBe("default");
    expect(update.getAttribute("href")).toBe("https://example.test/VibeTV-Control-Center.dmg");
    expect(screen.getByText("Version 1.0.65 is available")).toBeTruthy();
    // One version per row: the installed one.
    expect(screen.getByText("1.0.64", { selector: "span" })).toBeTruthy();
    // The firmware waits for the Mac App, and says so inside its own row.
    expect(screen.getByText("Update Mac App first")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(variant(screen.getByRole("button", { name: "Check for updates" }))).toBe("outline");
  });

  it("firmware update available: lime Update in the firmware row starts it", () => {
    const install = vi.fn();
    render(
      <UpdatesScreen
        {...upToDate}
        firmwareUpdate={{
          ...upToDate.firmwareUpdate!,
          latestFirmware: "1.0.49",
          status: "update_available",
          updateAvailable: true,
        }}
        onInstallUpdate={install}
      />,
    );
    const update = screen.getByRole("button", { name: "Update" });
    expect(variant(update)).toBe("default");
    expect(screen.getByText("Version 1.0.49 is available")).toBeTruthy();
    fireEvent.click(update);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("a Mac App migration without a verified download leaves the firmware Update as the only button", () => {
    render(
      <UpdatesScreen
        {...upToDate}
        firmwareUpdate={{
          ...upToDate.firmwareUpdate!,
          latestFirmware: "1.0.49",
          status: "update_available",
          updateAvailable: true,
        }}
        requiresMacAppMigration
      />,
    );
    const updates = screen.getAllByRole("button", { name: "Update" }) as HTMLButtonElement[];
    expect(updates).toHaveLength(1);
    expect(updates[0].disabled).toBe(false);
  });

  it("keeps the firmware Update closed while a check runs and after the Mac App check failed", () => {
    const offered = {
      ...upToDate,
      firmwareUpdate: {
        ...upToDate.firmwareUpdate!,
        latestFirmware: "1.0.49",
        status: "update_available" as const,
        updateAvailable: true,
      },
    };
    const update = () => screen.getByRole("button", { name: "Update" }) as HTMLButtonElement;
    const view = render(<UpdatesScreen {...offered} />);
    expect(update().disabled).toBe(false);

    view.rerender(<UpdatesScreen {...offered} busyAction="firmware-check" />);
    expect(update().disabled).toBe(true);

    view.rerender(
      <UpdatesScreen
        {...offered}
        companionRelease={{ ...upToDate.companionRelease!, status: "check_failed" }}
      />,
    );
    expect(update().disabled).toBe(true);
  });

  it("a theme-only update names no firmware version", () => {
    render(<UpdatesScreen {...upToDate} themeUpdateAvailable />);
    expect(screen.getByText("A theme update is available")).toBeTruthy();
    expect(screen.queryByText(/^Version /)).toBeNull();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  });

  it("a firmware check with no answer is not 'up to date'", () => {
    render(
      <UpdatesScreen
        {...upToDate}
        firmwareUpdate={{
          checkedAt: "2026-10-19T09:10:00Z",
          status: "no_board_release",
          installedFirmware: "1.0.48",
          updateAvailable: false,
          message: "No update is available for this VibeTV.",
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "No update available" })).toBeTruthy();
    expect(screen.getByText("No update is available for this VibeTV.")).toBeTruthy();
    // Only the Mac App row says it is up to date.
    expect(screen.getAllByText("Up to date")).toHaveLength(1);
  });

  it("installing: the step is a process-steps line inside the card, no Update button", () => {
    render(
      <UpdatesScreen
        {...upToDate}
        firmwareUpdate={{
          ...upToDate.firmwareUpdate!,
          latestFirmware: "1.0.49",
          status: "update_available",
          updateAvailable: true,
        }}
        updateStatus={{
          phase: "installing",
          stage: "uploading",
          startedAt: "2026-10-19T09:00:00Z",
          message: "Sending the update to VibeTV.",
          progress: 40,
          logs: [],
        }}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Updating VibeTV" })).toBeTruthy();
    const steps = document.querySelector('[data-slot="process-steps"]') as HTMLElement;
    expect(steps.getAttribute("data-variant")).toBe("single");
    expect(steps.textContent).toBe("> Sending the update to VibeTV.");
    expect(steps.closest("h3")).toBeNull();
    const firmwareRow = screen.getByRole("heading", { level: 3, name: "VibeTV firmware" }).parentElement!.parentElement!;
    expect(firmwareRow.contains(steps)).toBe(true);
    expect(within(firmwareRow).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.getByText("Updating")).toBeTruthy();
  });

  it("failed check: a dialog with a lime Try again and Close, no X", () => {
    const check = vi.fn();
    render(
      <UpdatesScreen
        {...upToDate}
        firmwareUpdate={{
          checkedAt: "2026-10-19T09:10:00Z",
          status: "check_failed",
          installedFirmware: "1.0.48",
          updateAvailable: false,
        }}
        onCheckUpdates={check}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Update check failed" })).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Could not check for updates" });
    expect(within(dialog).getByText("Check the internet connection, then try again.")).toBeTruthy();
    expect(variant(within(dialog).getByRole("button", { name: "Try again" }))).toBe("default");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);

    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(check).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("failed check: Close keeps the failure in the row and does not ask again", () => {
    const failed = {
      checkedAt: "2026-10-19T09:10:00Z",
      status: "check_failed" as const,
      installedFirmware: "1.0.48",
      updateAvailable: false,
    };
    const view = render(<UpdatesScreen {...upToDate} firmwareUpdate={failed} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Check failed")).toBeTruthy();

    // The next failed check is a new failure.
    view.rerender(
      <UpdatesScreen {...upToDate} firmwareUpdate={{ ...failed, checkedAt: "2026-10-19T09:20:00Z" }} />,
    );
    expect(screen.getByRole("dialog", { name: "Could not check for updates" })).toBeTruthy();
  });

  it("an inconclusive Mac App check shows a muted dot, never the green one", () => {
    const { container } = render(
      <UpdatesScreen
        {...upToDate}
        companionRelease={{ ...upToDate.companionRelease!, status: "disabled", updateAvailable: false }}
      />,
    );
    expect(screen.getByText("No update available")).toBeTruthy();
    expect(container.querySelector("i.bg-muted-foreground")).not.toBeNull();
    expect(container.querySelector("i.bg-foreground")).toBeNull();
  });

  it("a required migration whose download is missing or disabled is never 'up to date'", () => {
    // Also when the release is newer than the installed app (Codex on #798).
    for (const [dmgDownloadStatus, updateAvailable] of [
      ["missing_asset", false],
      ["disabled", false],
      ["missing_asset", true],
      ["disabled", true],
    ] as const) {
      const { container } = render(
        <UpdatesScreen
          {...upToDate}
          companionRelease={{
            ...upToDate.companionRelease!,
            status: "available",
            updateAvailable,
            dmgDownloadStatus,
          }}
          // A legacy install outside /Applications: the download is its only way.
          companionInfo={{ app: { version: "1.0.64", installedInApplications: false } }}
          requiresMacAppMigration
        />,
      );
      expect(screen.queryByText("Everything is up to date")).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "No update available" })).toBeTruthy();
      expect(container.querySelector("i.bg-muted-foreground")).not.toBeNull();
      expect((screen.getByRole("button", { name: "Update" }) as HTMLButtonElement).disabled).toBe(true);
      cleanup();
    }
  });

  it("a firmware update that cannot start is no 'Update available' headline", () => {
    // The firmware waits for a Mac App whose download is missing or disabled: no
    // button works, so the headline says what the page says for a blocked update.
    for (const dmgDownloadStatus of ["missing_asset", "disabled"] as const) {
      const { unmount } = render(
        <UpdatesScreen
          {...upToDate}
          companionInfo={{ app: { version: "1.0.64", installedInApplications: false } }}
          companionRelease={{
            ...upToDate.companionRelease!,
            status: "available",
            updateAvailable: true,
            dmgDownloadStatus,
          }}
          firmwareUpdate={{
            ...upToDate.firmwareUpdate!,
            latestFirmware: "1.0.49",
            status: "update_available",
            updateAvailable: true,
          }}
          requiresMacAppMigration
        />,
      );
      expect(screen.getByText("Update Mac App first")).toBeTruthy();
      expect(screen.queryByRole("heading", { level: 2, name: "Update available" })).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "No update available" })).toBeTruthy();
      unmount();
    }
  });

  it("a normal firmware offer keeps the 'Update available' headline", () => {
    render(
      <UpdatesScreen
        {...upToDate}
        firmwareUpdate={{
          ...upToDate.firmwareUpdate!,
          latestFirmware: "1.0.49",
          status: "update_available",
          updateAvailable: true,
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Update available" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  });

  it("a failed check outranks an available update in the headline's dot", () => {
    const { container } = render(
      <UpdatesScreen
        {...upToDate}
        companionRelease={{ ...upToDate.companionRelease!, status: "check_failed", updateAvailable: false }}
        firmwareUpdate={{
          checkedAt: "2026-10-19T09:10:00Z",
          status: "update_available",
          installedFirmware: "1.0.48",
          latestFirmware: "1.0.50",
          updateAvailable: true,
        }}
      />,
    );
    expect(screen.getByText("Update check failed")).toBeTruthy();
    expect(container.querySelector("i.bg-destructive")).not.toBeNull();
    expect(container.querySelector("i.bg-foreground")).toBeNull();
  });

  it("a disabled Mac App check is never shown as up to date", () => {
    render(
      <UpdatesScreen
        {...upToDate}
        companionRelease={{ ...upToDate.companionRelease!, status: "disabled", updateAvailable: false }}
      />,
    );
    // Only the firmware row (current) reads "Up to date"; the Mac App row does not.
    expect(screen.getAllByText("Up to date")).toHaveLength(1);
    expect(screen.queryByText("Everything is up to date")).toBeNull();
    expect(screen.getByText("No update available")).toBeTruthy();
  });

  it("a firmware answer without a release counts as the last check", () => {
    const now = new Date();
    const firmwareAt = new Date(now.getTime() - 60_000);
    const macAt = new Date(now.getTime() - 3 * 3_600_000);
    const { container } = render(
      <UpdatesScreen
        {...upToDate}
        companionRelease={{ ...upToDate.companionRelease!, checkedAt: macAt.toISOString() }}
        firmwareUpdate={{
          checkedAt: firmwareAt.toISOString(),
          status: "no_board_release",
          installedFirmware: "1.0.48",
          updateAvailable: false,
        }}
      />,
    );
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(firmwareAt);
    expect(container.textContent).toContain(time);
  });

  it("failed check: waits while another dialog is open and while a retry runs", () => {
    const failed = {
      ...upToDate,
      firmwareUpdate: {
        checkedAt: "2026-10-19T09:10:00Z",
        status: "check_failed" as const,
        installedFirmware: "1.0.48",
        updateAvailable: false,
      },
    };
    const view = render(<UpdatesScreen {...failed} otherDialogOpen />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<UpdatesScreen {...failed} />);
    expect(screen.getByRole("dialog", { name: "Could not check for updates" })).toBeTruthy();
    // A retry is running: no dialog, and the Mac App's new answer does not reopen the old failure.
    view.rerender(<UpdatesScreen {...failed} busyAction="firmware-check" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("failed check: a closed failure stays closed after another dialog opens and closes", () => {
    const failed = {
      ...upToDate,
      firmwareUpdate: {
        checkedAt: "2026-10-19T09:10:00Z",
        status: "check_failed" as const,
        installedFirmware: "1.0.48",
        updateAvailable: false,
      },
    };
    const view = render(<UpdatesScreen {...failed} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<UpdatesScreen {...failed} otherDialogOpen />);
    view.rerender(<UpdatesScreen {...failed} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("failed check: a retry that fails in the same second opens the dialog again", () => {
    const failed = {
      ...upToDate,
      firmwareUpdate: {
        checkedAt: "2026-10-19T09:10:00Z",
        status: "check_failed" as const,
        installedFirmware: "1.0.48",
        updateAvailable: false,
      },
      onCheckUpdates: vi.fn(),
    };
    const view = render(<UpdatesScreen {...failed} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<UpdatesScreen {...failed} busyAction="firmware-check" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The retry ends with the same checkedAt (second resolution): still a new failure.
    view.rerender(<UpdatesScreen {...failed} />);
    expect(screen.getByRole("dialog", { name: "Could not check for updates" })).toBeTruthy();
  });

  it("failed check: a header retry that fails in the same second opens the dialog again", () => {
    const failed = {
      ...upToDate,
      firmwareUpdate: {
        checkedAt: "2026-10-19T09:10:00Z",
        status: "check_failed" as const,
        installedFirmware: "1.0.48",
        updateAvailable: false,
      },
    };
    const view = render(<UpdatesScreen {...failed} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The header button runs a check; it ends with the same checkedAt.
    view.rerender(<UpdatesScreen {...failed} busyAction="firmware-check" />);
    view.rerender(<UpdatesScreen {...failed} />);
    expect(screen.getByRole("dialog", { name: "Could not check for updates" })).toBeTruthy();
  });

  it("failed check: the heading says Checking while a retry runs", () => {
    const failed = {
      ...upToDate,
      firmwareUpdate: {
        checkedAt: "2026-10-19T09:10:00Z",
        status: "check_failed" as const,
        installedFirmware: "1.0.48",
        updateAvailable: false,
      },
    };
    render(<UpdatesScreen {...failed} busyAction="firmware-check" />);
    expect(screen.getByRole("heading", { level: 2, name: "Checking for updates" })).toBeTruthy();
  });

  it("failed check: a firmware-only refresh keeps a closed Mac App failure closed", () => {
    const macFailed = {
      ...upToDate,
      companionRelease: { ...upToDate.companionRelease!, status: "check_failed" as const },
    };
    const view = render(<UpdatesScreen {...macFailed} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Only the firmware check runs again (e.g. the device reported new firmware).
    view.rerender(<UpdatesScreen {...macFailed} firmwareUpdate={undefined} />);
    view.rerender(<UpdatesScreen {...macFailed} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // A new Mac App check that fails again opens it.
    view.rerender(<UpdatesScreen {...macFailed} companionRelease={null} />);
    view.rerender(<UpdatesScreen {...macFailed} />);
    expect(screen.getByRole("dialog", { name: "Could not check for updates" })).toBeTruthy();
  });

  it("no dialog while everything checks fine", () => {
    render(<UpdatesScreen {...upToDate} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
