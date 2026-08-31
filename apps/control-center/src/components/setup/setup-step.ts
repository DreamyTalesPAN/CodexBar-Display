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
  themeSetupRequired: boolean;
};

/**
 * Whether the wizard can move past the device step.
 *
 * `ready` is the plain answer, but it needs a rendered usage frame, and a
 * brand-new customer has no provider yet and therefore no usage to render.
 * Such a VibeTV is connected, paired and answering -- it reports
 * `provider_setup_required` -- and the step that fixes it is the provider step,
 * so holding it here is a dead end with the remedy on the other side.
 *
 * Only while the provider selection is still outstanding. Letting it through
 * afterwards would carry a customer whose provider has just died past the
 * remaining steps and tell them their VibeTV is live.
 */
export function setupDeviceIsUsable(input: {
  awaitsProviderSetup: boolean;
  hasActiveDevice: boolean;
  hasEnteredControlCenter: boolean;
  connectionRecoveryRequired: boolean;
  providerSelectionRequired: boolean;
  ready: boolean;
}): boolean {
  return (
    input.ready ||
    (input.providerSelectionRequired && input.awaitsProviderSetup) ||
    (input.hasEnteredControlCenter &&
      input.hasActiveDevice &&
      !input.connectionRecoveryRequired)
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
    return "device";
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
 * Nothing before the provider step can be returned to: the welcome step has no
 * controls, and the device is paired by the time the provider step is reached,
 * so going back to pick another one is a settings job rather than a wizard one.
 */
export function previousSetupStep(step: SetupStep): SetupStep | null {
  switch (step) {
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
