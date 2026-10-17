import { describe, expect, it } from "vitest";
import { themeInstallStatusFromJob } from "./update-jobs";

describe("theme install finish time", () => {
  // The finish time is compared against when the ordered theme was chosen, so
  // it must be an ISO instant, not a localized clock time like "10:42:13".
  it("stores a finish time that parses when the Companion reports none", () => {
    const before = Date.now();
    const status = themeInstallStatusFromJob(
      { id: "job-1", phase: "complete" },
      [],
      { themeId: "mini-classic", title: "Mini Classic" },
    );
    const after = Date.now();

    const finished = Date.parse(status.finishedAt ?? "");
    expect(finished).toBeGreaterThanOrEqual(before);
    expect(finished).toBeLessThanOrEqual(after);
  });
});
