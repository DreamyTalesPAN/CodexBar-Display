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
  /** The device answered, is paired and is streaming. */
  deviceReady: boolean;
  /** A display mode has been written for this Mac. */
  displayConfigured: boolean;
  /** The first companion check has answered, whatever it said. */
  initialCheckComplete: boolean;
  /** VibeTV is showing something the customer would recognise as theirs. */
  liveFrameRendered: boolean;
  providerSelectionRequired: boolean;
  themeSetupRequired: boolean;
};

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
  if (!input.deviceReady) {
    return "device";
  }
  if (input.providerSelectionRequired) {
    return "providers";
  }
  if (!input.displayConfigured) {
    return "display";
  }
  if (input.themeSetupRequired) {
    return "theme";
  }
  return input.liveFrameRendered ? "live" : "theme";
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
