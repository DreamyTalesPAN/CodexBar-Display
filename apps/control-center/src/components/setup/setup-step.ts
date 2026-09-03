export const SETUP_STEPS = [
  "welcome",
  "device",
  "providers",
  "display",
  "theme",
  "live",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];

export type SetupStepInput = {
  /**
   * The device is the customer's to use. A device that is merely reconnecting
   * still counts: taking the whole app away for a missed poll would eject
   * someone from what they were doing.
   */
  deviceUsable: boolean;
  /** A display mode has been written for this Mac. */
  displayConfigured: boolean;
  /**
   * The companion can store a display mode at all. An older one cannot, and
   * asking for a choice it will refuse to keep is a dead end.
   */
  displaySelectionSupported: boolean;
  /** The first companion check has answered, whatever it said. */
  initialCheckComplete: boolean;
  providerSelectionRequired: boolean;
  /**
   * A device search is running and has produced nothing to choose from yet.
   *
   * The welcome step owns this wait: its log is the only place that says
   * "looking for your VibeTV", and a picker offering nothing to pick is not
   * the screen the customer is on.
   */
  searchingForDevice: boolean;
  themeSetupRequired: boolean;
};

/**
 * Whether the wizard can move past the device step.
 *
 * `ready` needs a rendered usage frame, which may arrive well after pairing,
 * the firmware check, and even the provider inventory. While provider setup is
 * still open, the successful connection is therefore the whole gate: waiting
 * for a frame or a particular provider status strands the customer here.
 *
 * Only while the provider selection is still outstanding. Letting it through
 * afterwards would carry a customer whose provider has just died past the
 * remaining steps and tell them their VibeTV is live.
 */
export function setupDeviceIsUsable(input: {
  deviceConnected: boolean;
  hasActiveDevice: boolean;
  hasEnteredControlCenter: boolean;
  connectionRecoveryRequired: boolean;
  displayRemediationRequired: boolean;
  providerSelectionRequired: boolean;
  providerSetupCompletedThisSession: boolean;
  themeSetupRequired: boolean;
  ready: boolean;
}): boolean {
  return (
    input.ready ||
    ((input.providerSelectionRequired ||
      input.providerSetupCompletedThisSession ||
      input.displayRemediationRequired ||
      input.themeSetupRequired) &&
      input.deviceConnected) ||
    (input.hasEnteredControlCenter &&
      input.hasActiveDevice &&
      !input.connectionRecoveryRequired)
  );
}

/**
 * Whether the customer already has a display choice the wizard can move past.
 *
 * `configured` only says one was written. A selection that names a provider
 * since turned off is still configured, and the companion refuses to finish
 * setup on it -- so it is exactly what the display step is for, not something
 * to skip.
 */
export function setupDisplayIsConfigured(
  display: { configured?: boolean; valid?: boolean } | null | undefined,
): boolean {
  return display?.configured === true && display.valid !== false;
}

/**
 * Whether the companion can store a display choice at all.
 *
 * Only a companion that does not know the endpoint answers 404, and asking it
 * for a choice it will refuse to keep is a dead end -- so that one skips the
 * step. Every other failure is a read that did not work this time: treating it
 * the same skipped a required step over a transient error, and setup could
 * finish without the customer ever making the choice.
 */
export function setupDisplaySelectionSupported(
  display: unknown,
  error: { code?: string } | null | undefined,
): boolean {
  return Boolean(display) || error?.code !== "HTTP_404";
}

/**
 * Whether the app knows enough to say who this session belongs to.
 *
 * The companion's own state comes with the first status answer; the display
 * choice is read from its own endpoint and can still be in flight. A read that
 * failed is not an answer: settling on it would call a customer who is coming
 * back a first-time one for the whole session over one dropped request. Only
 * the 404 of a companion that cannot store a display choice at all is final --
 * there is nothing to wait for, and `setupDisplaySelectionSupported` already
 * owns that reading.
 */
export function setupIdentityIsKnown(
  initialCheckComplete: boolean,
  display: unknown,
  displayError: { code?: string } | null | undefined,
): boolean {
  return (
    initialCheckComplete &&
    (Boolean(display) || !setupDisplaySelectionSupported(display, displayError))
  );
}

/**
 * Whether this Mac has been through setup before, on evidence that survives a
 * restart.
 *
 * Entering the Control Center is otherwise proved by the first renderable frame,
 * which is right for someone who has just walked through the wizard and wrong
 * for someone coming back: a VibeTV that is connected but not yet drawing has
 * not sent one, and the wizard took the window back from a customer whose setup
 * the companion had recorded as finished -- onto "looking for your VibeTV", in
 * front of a VibeTV that was connected the whole time.
 *
 * The provider choice and the display choice are both persisted by the
 * companion, so they answer offline. The theme is not, and
 * `deviceCompletedThemeSetup` is false precisely when the VibeTV is
 * unreachable -- keying on it would do nothing in the case this exists for.
 * `themeSetupRequired` is the safe direction: it is false when there is no
 * device to ask, and true whenever a reachable one still needs its theme, which
 * keeps that step.
 *
 * `providerSetupCompletedThisSession` is what holds a first setup: it is set
 * the moment Continue on the provider step succeeds, so from there to the
 * closing step this stays false and the frame requirement is untouched.
 *
 * `hasActiveDevice` and `connectionRecoveryRequired` are the two that are about
 * the VibeTV rather than the choices, and they draw the same line
 * `setupDeviceIsUsable` draws for a customer who is already inside. Without the
 * first, a Mac that has never paired anything -- or is choosing between two it
 * has just found -- would be carried past the device step by a provider choice
 * that was made for a VibeTV it does not have. Without the second, a VibeTV
 * that has lost its pairing would be carried past the one screen with the
 * Connect button on it. Both are read from the device the recovery gate has
 * accepted, and that gate does not accept a disconnected snapshot at startup:
 * a known VibeTV that is switched off when the app starts therefore still
 * opens on the device step, where the recovery picker and the automatic
 * reconnect live.
 */
export function setupWasCompletedBefore(input: {
  hasActiveDevice: boolean;
  connectionRecoveryRequired: boolean;
  providerSelectionComplete: boolean;
  displayConfigured: boolean;
  providerSetupCompletedThisSession: boolean;
  themeSetupRequired: boolean;
}): boolean {
  return (
    input.hasActiveDevice &&
    !input.connectionRecoveryRequired &&
    input.providerSelectionComplete &&
    input.displayConfigured &&
    !input.providerSetupCompletedThisSession &&
    !input.themeSetupRequired
  );
}

/** The provider screen owns the first inventory wait and its retry dialog. */
export function setupProviderInventoryIsLoading(
  providerSelectionRequired: boolean,
  providerInventory: readonly unknown[] | null,
  providerInventoryError: unknown | null,
): boolean {
  return (
    providerSelectionRequired &&
    providerInventory === null &&
    providerInventoryError === null
  );
}

/**
 * Which step the customer's actual state puts them on.
 *
 * Deliberately derived rather than remembered: a step that is only advanced by
 * button presses drifts away from the truth the moment anything fails, and the
 * customer ends up on a step whose precondition is gone.
 */
export function deriveSetupStep(input: SetupStepInput): SetupStep {
  if (!input.initialCheckComplete) {
    return "welcome";
  }
  if (!input.deviceUsable) {
    // The first status check answers in milliseconds and the search it gates
    // takes up to 40 seconds, so welcome-until-checked left the whole search
    // on a picker with nothing in it. The `deviceUsable` guard above is what
    // keeps this from dragging a connected customer back: pairing returns the
    // search state to "idle" once it is done.
    return input.searchingForDevice ? "welcome" : "device";
  }
  if (input.providerSelectionRequired) {
    return "providers";
  }
  if (input.displaySelectionSupported && !input.displayConfigured) {
    return "display";
  }
  if (input.themeSetupRequired) {
    return "theme";
  }
  return "live";
}

/**
 * Where Back goes from a step, or null where there is no way back.
 *
 * The welcome step has no controls, so nothing returns to it. The device step
 * is the first choice the customer makes, and Connect is its way forward
 * again: a connect that finishes releases the step.
 */
export function previousSetupStep(step: SetupStep): SetupStep | null {
  switch (step) {
    case "providers":
      return "device";
    case "display":
      return "providers";
    case "theme":
      return "display";
    default:
      return null;
  }
}

/** A step the customer went back to is only honoured while it is still behind. */
export function resolveSetupStep(
  derived: SetupStep,
  wentBackTo: SetupStep | null,
): SetupStep {
  if (!wentBackTo) {
    return derived;
  }
  return SETUP_STEPS.indexOf(wentBackTo) < SETUP_STEPS.indexOf(derived)
    ? wentBackTo
    : derived;
}

/**
 * The step that can act on a refused provider completion, or null when the
 * provider step itself can.
 *
 * Everything the companion refuses there is the provider step's to fix, except
 * the three that are about the display selection: one names a provider the
 * customer has since turned off, the second an Automatic pool that no longer
 * covers everything switched on, the third a provider that is shown but can no
 * longer produce a reading while another one can. None has a control on the
 * provider screen, so holding them there leaves a refusal whose next action is
 * not on it, and undoing the switch they had just pressed as the only way out.
 * The third also has no other way back: deriveSetupStep skips the display step
 * for a selection that is still configured and valid, and validity does not
 * look at health.
 */
export function setupStepForProviderRefusal(
  code: string | undefined,
): SetupStep | null {
  return code === "provider_display_invalid" ||
    code === "provider_display_incomplete" ||
    code === "provider_display_not_ready"
    ? "display"
    : null;
}
