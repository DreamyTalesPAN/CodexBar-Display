import { describe, expect, it } from "vitest";
import { setupUsageCauseCopy, setupUsageCauseFor } from "./setup-usage-dialog";

describe("setupUsageCauseFor", () => {
  it("asks for an update when the usage engine is too old", () => {
    const cause = setupUsageCauseFor({ status: "setup_required", engine: { status: "engine_incompatible" } });
    expect(cause).toBe("incompatible");
    expect(setupUsageCauseCopy[cause].title).toBe("Update the usage engine");
  });

  it("keeps a missing engine and a broken engine distinct", () => {
    expect(setupUsageCauseFor({ status: "setup_required", engine: { status: "not_configured" } })).toBe("not_set_up");
    expect(setupUsageCauseFor({ status: "degraded", engine: { status: "engine_error" } })).toBe("unknown");
  });
});
