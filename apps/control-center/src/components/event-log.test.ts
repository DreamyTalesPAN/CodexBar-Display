import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTime } from "./event-log";

describe("formatTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the computer's default locale instead of a fixed one", () => {
    const RealDateTimeFormat = Intl.DateTimeFormat;
    const spy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function (...args) {
        return new RealDateTimeFormat(...args);
      } as typeof Intl.DateTimeFormat);

    formatTime();

    expect(spy.mock.calls[0]?.[0]).toBeUndefined();
  });
});
