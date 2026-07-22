import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeviceStartupScreen } from "./device-startup-screen";

describe("DeviceStartupScreen", () => {
  it("keeps searching as an accessible heading and one focused status", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        busyAction="search"
        deviceCandidates={[]}
        deviceSearchState="searching"
        hasConfiguredDevice={false}
        onDecline={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Looking for your VibeTV</h1>");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Searching…"');
  });

  it("shows selection progress only in the primary device button", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        busyAction="select"
        deviceCandidates={[
          {
            target: "http://192.168.178.72",
            deviceId: "14799300",
            firmware: "1.0.37",
          },
        ]}
        deviceSearchState="multiple"
        hasConfiguredDevice
        onDecline={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("animate-spin");
    expect(html).toContain("Connecting</span></button>");
    expect(html).not.toContain("Connecting…");
  });

  it("matches boot UI while reconnecting", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        busyAction="repair"
        deviceCandidates={[]}
        deviceSearchState="waiting"
        hasConfiguredDevice
        onCreateSupportReport={vi.fn()}
        onDecline={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain('data-variant="secondary"');
    expect(html).toContain("justify-items-center");
    expect(html).toContain('class="sr-only">Reconnecting…</span>');
  });

  it("uses shadcn recovery UI and names the action that is actually shown", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="repair-failed"
        hasConfiguredDevice={false}
        lastError={{
          code: "pair_failed",
          message: "VibeTV pairing failed.",
          nextAction: "Keep VibeTV powered on, then retry Fix connection.",
        }}
        onDecline={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="alert"');
    expect(html).toContain("Keep VibeTV powered on, then search again.");
    expect(html).not.toContain("retry Fix connection");
  });
});
