import { describe, expect, it } from "vitest";
import { belongsToReport, HELP_OUTCOME_COPY } from "./setup-help-menu";

describe("belongsToReport", () => {
  it("keeps the other entry usable while an outcome is shown", () => {
    expect(belongsToReport("report-saved")).toBe(true);
    expect(belongsToReport("report-partial")).toBe(true);
    expect(belongsToReport("failed")).toBe(true);
    expect(belongsToReport("prompt-copied")).toBe(false);
    expect(belongsToReport(null)).toBe(false);
  });
});

describe("HELP_OUTCOME_COPY", () => {
  it("says a report is incomplete rather than passing it off as whole", () => {
    expect(HELP_OUTCOME_COPY["report-partial"].title).not.toBe(
      HELP_OUTCOME_COPY["report-saved"].title,
    );
    expect(HELP_OUTCOME_COPY["report-partial"].detail).toMatch(/missing/i);
  });

  it("does not claim a file was saved when nothing was", () => {
    expect(HELP_OUTCOME_COPY.failed.detail).toMatch(/Nothing was saved/);
    expect(HELP_OUTCOME_COPY.failed.detail).not.toMatch(/Downloads/);
  });

  it("keeps the internal service names out of every outcome", () => {
    for (const copy of Object.values(HELP_OUTCOME_COPY)) {
      expect(`${copy.title} ${copy.detail}`).not.toMatch(
        /CodexBar|Companion|\bAPI\b/,
      );
    }
  });
});
