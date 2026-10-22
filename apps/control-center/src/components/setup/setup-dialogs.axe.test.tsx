// @vitest-environment jsdom
// Accessibility baseline (issue #214) for the setup firmware, recovery and
// provider dialogs. Each state is opened and checked by axe on the rendered DOM.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import {
  SetupFirmwareBlockedDialog,
  SetupFirmwareUpdateFailedDialog,
} from "./setup-firmware-dialogs";
import { SetupRecoveryDialogs } from "./setup-recovery-dialogs";
import { SetupStepFailedDialog } from "./setup-provider-dialogs";

afterEach(cleanup);

const error = {
  code: "provider_setup_required",
  message: "Turn on a provider first",
  nextAction: "Choose a provider, then continue.",
};

it.each([
  [
    "firmware check failed",
    <SetupFirmwareBlockedDialog key="a" onOpenChange={vi.fn()} onResolve={vi.fn()} open reason="firmware_check_failed" />,
  ],
  [
    "Mac App restarting",
    <SetupFirmwareBlockedDialog key="b" onOpenChange={vi.fn()} onResolve={vi.fn()} open reason="mac_app_restarting" />,
  ],
  [
    "update failed",
    <SetupFirmwareUpdateFailedDialog
      key="c"
      onCreateSupportReport={vi.fn()}
      onOpenChange={vi.fn()}
      onRetry={vi.fn()}
      open
    />,
  ],
  [
    "update failed, attention needed",
    <SetupFirmwareUpdateFailedDialog
      key="d"
      attentionMessage="Firmware is current."
      onCreateSupportReport={vi.fn()}
      onOpenChange={vi.fn()}
      onRetry={vi.fn()}
      open
    />,
  ],
])("has no accessibility violations in the %s dialog", async (_name, dialog) => {
  render(dialog);
  expect(screen.getByRole("dialog")).toBeTruthy();
  await expectNoAxeViolations(document.body.innerHTML);
});

it.each([["repairing" as const], ["failed" as const]])(
  "has no accessibility violations in the %s recovery dialog",
  async (phase) => {
    render(
      <SetupRecoveryDialogs onHide={vi.fn()} onRestart={vi.fn()} onRetry={vi.fn()} phase={phase} retrying={false} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    await expectNoAxeViolations(document.body.innerHTML);
  },
);

it.each([
  ["with a retry", <SetupStepFailedDialog key="a" error={error} onOpenChange={vi.fn()} onRetry={vi.fn()} />],
  ["without a retry", <SetupStepFailedDialog key="b" error={error} onOpenChange={vi.fn()} />],
])("has no accessibility violations in the step failed dialog %s", async (_name, dialog) => {
  render(dialog);
  expect(screen.getByRole("dialog")).toBeTruthy();
  await expectNoAxeViolations(document.body.innerHTML);
});
