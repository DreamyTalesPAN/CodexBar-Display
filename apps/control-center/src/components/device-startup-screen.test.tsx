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
        deviceTarget="http://192.168.178.72/hello"
        onPair={vi.fn()}
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
        onPair={vi.fn()}
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
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-slot="spinner"');
    expect(html).toContain('data-variant="secondary"');
    expect(html).toContain("justify-items-center");
    expect(html).toContain('class="sr-only">Reconnecting…</span>');
    expect(html).not.toContain('data-slot="card"');
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
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).not.toContain('data-slot="card"');
    expect(html).toContain('data-slot="alert"');
    expect(html).toContain("Keep VibeTV powered on, then search again.");
    expect(html).not.toContain("retry Fix connection");
  });

  it("keeps support report creation enabled while searching", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        busyAction="search"
        deviceCandidates={[]}
        deviceSearchState="searching"
        deviceTarget="http://192.168.178.72/hello"
        onCreateSupportReport={vi.fn()}
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("Create report</span></button>");
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('value="192.168.178.72"');
    expect(html).not.toContain('value="http://192.168.178.72/hello"');
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
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("Connecting to VibeTV");
    expect(html).not.toContain("Open WiFi settings");
    expect(html).not.toContain("Scan WiFi again");
  });

  it("shows the exact legacy 1.0.38 recovery steps without extra settings copy", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="not-found"
        deviceTarget="172.30.0.31"
        lastError={{
          code: "legacy_pairing_recovery_required",
          message: "This VibeTV uses an older recovery method.",
          nextAction: "Follow the recovery steps, then press Connect.",
        }}
        onDeviceTargetChange={vi.fn()}
        onManualTarget={vi.fn()}
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("Reconnect this VibeTV");
    expect(html).toContain(
      "Unplug VibeTV and plug it back in three times. After the third start, leave it powered on.",
    );
    expect(html).toContain(
      "When VibeTV shows VibeTV-Setup, use your phone to connect it to your home WiFi again.",
    );
    expect(html).toContain(
      "Return to this app. When VibeTV appears, click Connect within 30 minutes.",
    );
    expect(html).not.toContain("within 30 seconds each time");
    expect(html).not.toContain(
      "This only resets WiFi. Your themes and display settings stay saved.",
    );
    expect(html).not.toContain("We couldn&#x27;t find your VibeTV");
    expect(html).not.toContain("Open WiFi settings");
  });
});
