import { describe, expect, it } from "vitest";
import {
  deriveSetupStep,
  previousSetupStep,
  resolveSetupStep,
  setupDeviceIsUsable,
  setupDisplayIsConfigured,
  setupDisplaySelectionSupported,
  setupIdentityIsKnown,
  setupProviderInventoryIsLoading,
  setupStepForProviderRefusal,
  setupWasCompletedBefore,
  type SetupStepInput,
} from "./setup-step";

const done: SetupStepInput = {
  deviceUsable: true,
  displayConfigured: true,
  displaySelectionSupported: true,
  initialCheckComplete: true,
  providerSelectionRequired: false,
  searchingForDevice: false,
  themeSetupRequired: false,
};

describe("deriveSetupStep", () => {
  it("waits on the welcome step until the first check has answered", () => {
    expect(deriveSetupStep({ ...done, initialCheckComplete: false })).toBe(
      "welcome",
    );
  });

  it("stays on welcome while the search has nothing to choose from yet", () => {
    // The first check answers in milliseconds and the search it gates takes up
    // to 40 seconds, so gating welcome on the check alone put the whole search
    // on a picker with an empty list and a disabled Connect.
    expect(
      deriveSetupStep({
        ...done,
        deviceUsable: false,
        searchingForDevice: true,
      }),
    ).toBe("welcome");
  });

  // The background service restarts several times on a fresh install, and a
  // search that ran into one of those gaps comes back empty. Handing that over
  // as an answer is what put a customer on "0 VibeTVs found on your WiFi." with
  // a dead Connect while the service was still starting.
  it("stays on welcome while the background service is still coming up", () => {
    expect(
      deriveSetupStep({
        ...done,
        deviceUsable: false,
        searchingForDevice: true,
      }),
    ).toBe("welcome");
  });

  it("hands over to the picker as soon as the search has answered", () => {
    expect(
      deriveSetupStep({
        ...done,
        deviceUsable: false,
        searchingForDevice: false,
      }),
    ).toBe("device");
  });

  it("never sends a connected customer back to welcome", () => {
    // Pairing returns the search state to "idle", which reads as "searching"
    // to everything that only looks at the search state.
    expect(
      deriveSetupStep({
        ...done,
        providerSelectionRequired: true,
        searchingForDevice: true,
      }),
    ).toBe("providers");
  });

  it("asks for a VibeTV before anything that needs one", () => {
    expect(
      deriveSetupStep({
        ...done,
        deviceUsable: false,
        providerSelectionRequired: true,
        themeSetupRequired: true,
      }),
    ).toBe("device");
  });

  it("asks for providers before a display mode that would have none to show", () => {
    expect(
      deriveSetupStep({
        ...done,
        displayConfigured: false,
        providerSelectionRequired: true,
      }),
    ).toBe("providers");
  });

  it("skips the display mode a companion cannot keep", () => {
    expect(
      deriveSetupStep({
        ...done,
        displayConfigured: false,
        displaySelectionSupported: false,
        themeSetupRequired: true,
      }),
    ).toBe("theme");
  });

  it("asks for a display mode before a theme", () => {
    expect(
      deriveSetupStep({
        ...done,
        displayConfigured: false,
        themeSetupRequired: true,
      }),
    ).toBe("display");
  });

  it("is finished once nothing is left to ask for", () => {
    // A customer who set up long ago boots straight into this, before any
    // frame has arrived — waiting on one would put them back on a step.
    expect(deriveSetupStep(done)).toBe("live");
  });

  it("falls back to the step whose precondition broke", () => {
    // The device is confirmed gone after the theme was installed.
    expect(deriveSetupStep({ ...done, deviceUsable: false })).toBe("device");
  });

  it("keeps a running session while a device is only reconnecting", () => {
    // The caller keeps deviceUsable true through a reconnect; only a confirmed
    // loss clears it, so a missed poll cannot eject the customer.
    expect(deriveSetupStep(done)).toBe("live");
  });
});

describe("initial provider inventory", () => {
  it("loads until the separate preferences request answers", () => {
    expect(setupProviderInventoryIsLoading(true, null, null)).toBe(true);
    expect(setupProviderInventoryIsLoading(true, [], null)).toBe(false);
  });

  it("hands a failed request to the provider error dialog", () => {
    expect(setupProviderInventoryIsLoading(true, null, {})).toBe(false);
  });
});

describe("previousSetupStep", () => {
  it("offers no way back to a step with no choice on it", () => {
    expect(previousSetupStep("welcome")).toBeNull();
    expect(previousSetupStep("device")).toBeNull();
  });

  it("walks back through the choices that can be revisited", () => {
    expect(previousSetupStep("theme")).toBe("display");
    expect(previousSetupStep("display")).toBe("providers");
    expect(previousSetupStep("providers")).toBe("device");
  });

  it("has nowhere to go from the last step", () => {
    expect(previousSetupStep("live")).toBeNull();
  });
});

describe("resolveSetupStep", () => {
  it("honours a step the customer went back to", () => {
    expect(resolveSetupStep("theme", "display")).toBe("display");
  });

  it("drops it once the state has moved past it anyway", () => {
    expect(resolveSetupStep("display", "display")).toBe("display");
    expect(resolveSetupStep("device", "display")).toBe("device");
  });

  it("never lets a stale step hold the customer ahead of the truth", () => {
    // The device dropped out while they were looking at the theme step.
    expect(resolveSetupStep("device", "theme")).toBe("device");
  });
});

describe("setupDeviceIsUsable", () => {
  const coldStart = {
    deviceConnected: true,
    connectionRecoveryRequired: false,
    displayRemediationRequired: false,
    hasActiveDevice: true,
    hasEnteredControlCenter: false,
    providerSelectionRequired: true,
    providerSetupCompletedThisSession: false,
    themeSetupRequired: false,
    ready: false,
  };

  // Pairing and the firmware check are enough. The first usage frame and the
  // provider inventory may both still be in flight when this step ends.
  it("lets a connected VibeTV reach the provider step", () => {
    expect(setupDeviceIsUsable(coldStart)).toBe(true);
  });

  // The same state after the provider selection is done is a provider that
  // died, and the steps ahead have nothing to offer for it. Letting it through
  // would end on the live screen telling the customer their VibeTV is running.
  it("does not let it through once the provider selection is done", () => {
    expect(
      setupDeviceIsUsable({ ...coldStart, providerSelectionRequired: false }),
    ).toBe(false);
  });

  it("does not bounce back after Continue completes in this setup", () => {
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        providerSelectionRequired: false,
        providerSetupCompletedThisSession: true,
      }),
    ).toBe(true);
  });

  it("lets a connected VibeTV reach an invalid saved display choice", () => {
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        providerSelectionRequired: false,
        displayRemediationRequired: true,
      }),
    ).toBe(true);
  });

  it("lets a connected VibeTV continue to its required theme setup", () => {
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        providerSelectionRequired: false,
        themeSetupRequired: true,
      }),
    ).toBe(true);
  });

  it("still needs the VibeTV to be connected", () => {
    expect(
      setupDeviceIsUsable({ ...coldStart, deviceConnected: false }),
    ).toBe(false);
  });

  it("keeps a ready VibeTV usable whatever else is true", () => {
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        deviceConnected: false,
        providerSelectionRequired: false,
        ready: true,
      }),
    ).toBe(true);
  });

  // Once the customer is inside, a device that is only reconnecting stays
  // theirs -- unchanged behaviour, pinned so the new term cannot swallow it.
  it("does not eject someone already inside over a missed poll", () => {
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        deviceConnected: false,
        hasEnteredControlCenter: true,
        providerSelectionRequired: false,
      }),
    ).toBe(true);
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        deviceConnected: false,
        connectionRecoveryRequired: true,
        hasEnteredControlCenter: true,
        providerSelectionRequired: false,
      }),
    ).toBe(false);
  });
});

// `configured` says a selection was written, not that it still works. One that
// names a provider the customer has since turned off is exactly what the
// display step is for -- and the companion refuses to finish setup on it, on a
// step that cannot change it.
describe("setupDisplayIsConfigured", () => {
  it("accepts a saved selection that still works", () => {
    expect(setupDisplayIsConfigured({ configured: true, valid: true })).toBe(
      true,
    );
  });

  it("asks again for one the companion reports as no longer valid", () => {
    expect(setupDisplayIsConfigured({ configured: true, valid: false })).toBe(
      false,
    );
  });

  it("asks when nothing was ever chosen", () => {
    expect(setupDisplayIsConfigured({ configured: false, valid: true })).toBe(
      false,
    );
    expect(setupDisplayIsConfigured(null)).toBe(false);
  });

  // An older companion answers without the field at all; that is not a reason
  // to send the customer round the display step again.
  it("does not treat a missing verdict as invalid", () => {
    expect(setupDisplayIsConfigured({ configured: true })).toBe(true);
  });

});

// Only a companion that does not know the endpoint answers 404. Treating any
// failed read the same skipped a required step over a transient error, and
// setup could then finish without the customer ever choosing what VibeTV shows.
describe("setupDisplaySelectionSupported", () => {
  it("skips the step only for a companion that cannot store a choice", () => {
    expect(setupDisplaySelectionSupported(null, { code: "HTTP_404" })).toBe(
      false,
    );
  });

  it("keeps the step when the read simply failed this time", () => {
    expect(
      setupDisplaySelectionSupported(null, { code: "COMPANION_TIMEOUT" }),
    ).toBe(true);
    expect(
      setupDisplaySelectionSupported(null, { code: "preferences_read_failed" }),
    ).toBe(true);
  });

  it("keeps the step when nothing has failed", () => {
    expect(setupDisplaySelectionSupported(null, null)).toBe(true);
  });

  // A selection already in hand settles it, whatever a later read said.
  it("stays supported once a selection has been read", () => {
    expect(
      setupDisplaySelectionSupported({ mode: "automatic" }, { code: "HTTP_404" }),
    ).toBe(true);
  });
});

// The provider step has no display control on it, so a refusal about the
// display selection printed a next action the customer could not carry out --
// and the Back override held them there, with undoing the switch they had just
// pressed as the only way on.
describe("setupStepForProviderRefusal", () => {
  it("names the display step for every display refusal", () => {
    // The selection names a provider that was switched off.
    expect(setupStepForProviderRefusal("provider_display_invalid")).toBe(
      "display",
    );
    // The Automatic pool no longer covers everything that is switched on. Of
    // the three actions this one offers, only "turn it off" is on the provider
    // screen -- and it undoes the switch the customer had just pressed.
    expect(setupStepForProviderRefusal("provider_display_incomplete")).toBe(
      "display",
    );
    // The provider on display can no longer produce a reading while another one
    // can. Signing it back in is on the provider screen, but showing a
    // different one is not -- and nothing else would put that choice back in
    // front of the customer, because a configured selection stays valid however
    // the provider is doing.
    expect(setupStepForProviderRefusal("provider_display_not_ready")).toBe(
      "display",
    );
  });

  it("keeps everything the provider step can act on", () => {
    expect(setupStepForProviderRefusal("provider_required")).toBe(null);
    expect(setupStepForProviderRefusal("provider_check_required")).toBe(null);
    expect(setupStepForProviderRefusal("COMPANION_TIMEOUT")).toBe(null);
    expect(setupStepForProviderRefusal(undefined)).toBe(null);
  });
});

// Entering the Control Center is otherwise proved by the first rendered frame.
// A VibeTV that is off, or reachable but not yet drawing, never sends one, and
// the wizard took the window back from a customer whose setup was long finished.
describe("setupWasCompletedBefore", () => {
  const returning = {
    hasActiveDevice: true,
    connectionRecoveryRequired: false,
    providerSelectionComplete: true,
    displayConfigured: true,
    providerSetupCompletedThisSession: false,
    themeSetupRequired: false,
  };

  it("recognises a customer coming back to an unreachable VibeTV", () => {
    expect(setupWasCompletedBefore(returning)).toBe(true);
  });

  it("still holds a first setup at the step it is on", () => {
    // Continue on the provider step has just succeeded, so the companion
    // already reports the selection complete. The display, theme and closing
    // steps are still ahead, and the frame requirement still owns them.
    expect(
      setupWasCompletedBefore({
        ...returning,
        providerSetupCompletedThisSession: true,
      }),
    ).toBe(false);
  });

  it("keeps the display step for a selection that no longer stands", () => {
    expect(
      setupWasCompletedBefore({ ...returning, displayConfigured: false }),
    ).toBe(false);
  });

  it("keeps the theme step for a VibeTV that can still be asked", () => {
    // themeSetupRequired, never themeSetupComplete: the completed state needs a
    // connected device, so it is false exactly in the offline case this exists
    // for, while this one is false when there is nothing to ask.
    expect(
      setupWasCompletedBefore({ ...returning, themeSetupRequired: true }),
    ).toBe(false);
  });

  it("keeps the device step for a Mac with no VibeTV of its own", () => {
    // A provider choice made for a VibeTV this Mac no longer has must not carry
    // anyone past picking one -- including a customer choosing between two that
    // the startup search has just found.
    expect(
      setupWasCompletedBefore({ ...returning, hasActiveDevice: false }),
    ).toBe(false);
  });

  it("keeps the device step for a VibeTV that needs its Connect pressed", () => {
    // A lost pairing is fixed on the device step, the one screen with Connect
    // on it -- the same line setupDeviceIsUsable draws for someone inside.
    expect(
      setupWasCompletedBefore({ ...returning, connectionRecoveryRequired: true }),
    ).toBe(false);
  });

  it("does not admit a Mac that never chose a provider", () => {
    expect(
      setupWasCompletedBefore({
        ...returning,
        providerSelectionComplete: false,
      }),
    ).toBe(false);
  });
});

// A dropped display read must not decide the whole session.
describe("setupIdentityIsKnown", () => {
  it("waits for the first status answer", () => {
    expect(setupIdentityIsKnown(false, { configured: true }, null)).toBe(false);
  });

  it("is known once the display choice has been read", () => {
    expect(setupIdentityIsKnown(true, { configured: true }, null)).toBe(true);
  });

  it("stays open over a transient read failure", () => {
    // Settling here would call a returning customer a first-time one for the
    // whole session; leaving it open means this launch waits for a frame, as
    // before, until the read succeeds.
    expect(setupIdentityIsKnown(true, null, { code: "COMPANION_TIMEOUT" })).toBe(
      false,
    );
    expect(setupIdentityIsKnown(true, null, null)).toBe(false);
  });

  it("treats a companion without a display choice as answered", () => {
    expect(setupIdentityIsKnown(true, null, { code: "HTTP_404" })).toBe(true);
  });
});
