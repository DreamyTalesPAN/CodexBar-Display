import { describe, expect, it } from "vitest";
import {
  deriveSetupStep,
  previousSetupStep,
  resolveSetupStep,
  setupDeviceIsUsable,
  type SetupStepInput,
} from "./setup-step";

const done: SetupStepInput = {
  deviceUsable: true,
  displayConfigured: true,
  displaySelectionSupported: true,
  initialCheckComplete: true,
  providerSelectionRequired: false,
  themeSetupRequired: false,
};

describe("deriveSetupStep", () => {
  it("waits on the welcome step until the first check has answered", () => {
    expect(deriveSetupStep({ ...done, initialCheckComplete: false })).toBe(
      "welcome",
    );
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

describe("previousSetupStep", () => {
  it("offers no way back before the device is paired", () => {
    expect(previousSetupStep("welcome")).toBeNull();
    expect(previousSetupStep("device")).toBeNull();
    expect(previousSetupStep("providers")).toBeNull();
  });

  it("walks back through the choices that can be revisited", () => {
    expect(previousSetupStep("theme")).toBe("display");
    expect(previousSetupStep("display")).toBe("providers");
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
    awaitsProviderSetup: true,
    connectionRecoveryRequired: false,
    hasActiveDevice: true,
    hasEnteredControlCenter: false,
    providerSelectionRequired: true,
    ready: false,
  };

  // A brand-new customer has CodexBar bundled but no provider signed in, so
  // their first VibeTV cannot render usage and reports ready:false. Holding
  // them on the device step puts the remedy -- the provider step -- on the
  // other side of the wall.
  it("lets a VibeTV waiting only for a provider reach the provider step", () => {
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

  it("still needs the VibeTV to be answering", () => {
    expect(
      setupDeviceIsUsable({ ...coldStart, awaitsProviderSetup: false }),
    ).toBe(false);
  });

  it("keeps a ready VibeTV usable whatever else is true", () => {
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        awaitsProviderSetup: false,
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
        awaitsProviderSetup: false,
        hasEnteredControlCenter: true,
        providerSelectionRequired: false,
      }),
    ).toBe(true);
    expect(
      setupDeviceIsUsable({
        ...coldStart,
        awaitsProviderSetup: false,
        connectionRecoveryRequired: true,
        hasEnteredControlCenter: true,
        providerSelectionRequired: false,
      }),
    ).toBe(false);
  });
});
