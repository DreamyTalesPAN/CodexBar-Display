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
        onCreateSupportReport={vi.fn()}
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
        lastError={{
          code: "pair_failed",
          message: "VibeTV pairing failed.",
          nextAction: "Keep VibeTV powered on, then retry Fix connection.",
        }}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="alert"');
    expect(html).toContain("Keep VibeTV powered on, then search again.");
    expect(html).not.toContain("retry Fix connection");
  });

  it("does not flash WiFi setup while a manual target is connecting", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        busyAction="manual-target"
        deviceCandidates={[]}
        deviceSearchState="not-found"
        deviceTarget="172.30.0.31"
        onDeviceTargetChange={vi.fn()}
        onManualTarget={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("Connecting to VibeTV");
    expect(html).not.toContain("Open WiFi settings");
    expect(html).not.toContain("Scan WiFi again");
  });

  it("never exposes destructive recovery copy for a pairing error", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="not-found"
        deviceTarget="172.30.0.31"
        lastError={{
          code: "pairing_window_closed",
          message: "Pairing needs physical recovery.",
          nextAction:
            "Unplug VibeTV during early boot three times in a row. Then connect VibeTV to WiFi again and pair it in Control Center.",
        }}
        onDeviceTargetChange={vi.fn()}
        onManualTarget={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("VibeTV needs to be paired again");
    expect(html).not.toContain("Unplug VibeTV");
    expect(html).not.toContain("three times");
    expect(html).not.toContain("We couldn&#x27;t find your VibeTV");
    expect(html).not.toContain("Open WiFi settings");
  });
});
