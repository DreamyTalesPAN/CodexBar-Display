import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildFrameData,
  primitiveUsageSlotVisible,
  themeSpecAriaLabel,
  type ThemePrimitive,
} from "./live-vibetv-preview";

type AcceptanceFixture = {
  version: number;
  cases: AcceptanceCase[];
};

type AcceptanceCase = {
  name: string;
  now: string;
  expectedDeviceFrame: DisplayFrame;
  expectedRender: {
    slot1Visible: boolean;
    slot2Visible: boolean;
    ariaContains: string[];
    ariaNotContains: string[];
  };
};

type DisplayFrame = {
  v?: number;
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  resetSecs?: number;
  usageMode?: string;
  usageSlots?: Array<{
    id?: string;
    label?: string;
    percent?: number;
    resetSecs?: number;
  }>;
};

const slot1: ThemePrimitive = { t: "tx", x: 0, y: 0, sl: 1 };
const slot2: ThemePrimitive = { t: "tx", x: 0, y: 0, sl: 2 };

describe("usage-window acceptance preview parity", () => {
  const fixture = loadAcceptanceFixture();
  const cases = fixture.cases.filter(
    ({ name }) => name !== "one-valid-weekly-remaining",
  );

  it.each(cases)(
    "renders expected slot visibility for $name",
    ({ name, now, expectedDeviceFrame, expectedRender }) => {
      const frame = buildFrameData(now, expectedDeviceFrame);

      expect(primitiveUsageSlotVisible(slot1, frame), name).toBe(
        expectedRender.slot1Visible,
      );
      expect(primitiveUsageSlotVisible(slot2, frame), name).toBe(
        expectedRender.slot2Visible,
      );

      const ariaLabel = themeSpecAriaLabel("acceptance", frame);
      for (const expected of expectedRender.ariaContains) {
        expect(ariaLabel, name).toContain(expected);
      }
      for (const unexpected of expectedRender.ariaNotContains) {
        expect(ariaLabel, name).not.toContain(unexpected);
      }
    },
  );
});

function loadAcceptanceFixture(): AcceptanceFixture {
  const path = fileURLToPath(
    new URL(
      "../../../../protocol/fixtures/v1/usage_window_acceptance.json",
      import.meta.url,
    ),
  );
  const fixture = JSON.parse(readFileSync(path, "utf8")) as AcceptanceFixture;
  if (fixture.version !== 1) {
    throw new Error(`Unexpected usage-window fixture version ${fixture.version}`);
  }
  return fixture;
}
