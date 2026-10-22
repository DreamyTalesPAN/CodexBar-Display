import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { LogsScreen } from "./logs-screen";

// Paul, 19.10.: Support has no "Connected VibeTV" table and no Setup log (the
// Setup log lives in the Setup Help menu only), as in the calm master.
it("has no Connected VibeTV table and no Setup log", () => {
  const html = renderToStaticMarkup(<LogsScreen />);

  expect(html).toContain("Support report");
  expect(html).toContain("Diagnostics");
  expect(html).toContain("Recent activity");
  expect(html).not.toContain("Connected VibeTV");
  expect(html).not.toContain("Setup log");
  expect(html).not.toContain("Run setup again");
});

it("has no accessibility violations with diagnostics, recent activity and an error", async () => {
  await expectNoAxeViolations(
    renderToStaticMarkup(
      <LogsScreen
        diagnostics={{
          ok: true,
          generatedAt: "2026-10-07T06:58:00.000Z",
          usageEngine: { status: "outdated", version: "0.17.0", minimumVersion: "0.23.0" },
          checks: [{ name: "device_hello", status: "attention", detail: "VibeTV did not answer.", nextAction: "Check that VibeTV is on." }],
        }}
        onLoadDiagnostics={() => undefined}
        onRepairUsageEngine={() => undefined}
        events={[{ id: "1", label: "Settings loaded", detail: "Brightness 70%" }]}
        lastError={{ code: "usage_failed", message: "Usage needs attention.", nextAction: "Try again." }}
        onRefresh={() => undefined}
      />,
    ),
  );
});

// Support showed the word "Session" in the time column of an entry that has
// no write time, which reads like a column header with its value missing.
it("writes no placeholder in the time column of an entry without a time", () => {
  const html = renderToStaticMarkup(
    <LogsScreen
      events={[{ id: "no-time", label: "Control Center opened", detail: "This session started." }]}
    />,
  );

  expect(html).toContain("Control Center opened");
  expect(html).not.toContain(">Session<");
});

// The calm master names when the report was made: "Last created today at 16:42."
it("says when the support report was last created, and nothing before one exists", () => {
  expect(renderToStaticMarkup(<LogsScreen />)).not.toContain("Last created");

  const html = renderToStaticMarkup(
    <LogsScreen
      diagnostics={{ ok: true, generatedAt: new Date().toISOString(), checks: [] }}
    />,
  );
  expect(html).toMatch(/Last created today at \d{2}:\d{2}\./);
});
