import { describe, expect, it } from "vitest";
import {
  deriveSetupStep,
  previousSetupStep,
  resolveSetupStep,
  type SetupStepInput,
} from "./setup-step";

const done: SetupStepInput = {
  deviceReady: true,
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
        deviceReady: false,
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
    // The device dropped out after the theme was installed.
    expect(deriveSetupStep({ ...done, deviceReady: false })).toBe("device");
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
