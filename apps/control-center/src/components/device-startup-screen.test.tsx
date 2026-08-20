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
        selectingDeviceTarget="http://192.168.178.72"
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

  it("sets the correct expectation while waiting for first usage", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain(
      "Waiting for the first live preview.",
    );
  });

  it("shows one simple recovery before Overview and themes", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onCreateSupportReport={vi.fn()}
        onPair={vi.fn()}
        onRepairUsageService={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{
          status: "setup_required",
          engine: { status: "engine_error" },
        }}
      />,
    );

    expect(html).toContain("AI usage could not start</h1>");
    expect(html).not.toContain("Waiting for live preview…");
    expect(html).toContain("Try again</span></button>");
    expect(html).toContain("Create support report</span></button>");
    expect(html).not.toMatch(/codexbar/i);
  });

  it("does not turn internal provider errors into customer instructions", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onPair={vi.fn()}
        onRepairUsageService={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{
          status: "setup_required",
          providers: [
            { id: "claude", label: "Claude", status: "permission_required" },
          ],
        }}
      />,
    );

    expect(html).toContain("AI usage could not start</h1>");
    expect(html).toContain("Try again</span></button>");
    expect(html).not.toMatch(/permission|macos access|claude|codexbar/i);
  });

  it("offers the approved CodexBar download only after retry also failed", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onPair={vi.fn()}
        onRepairUsageService={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{ status: "setup_required" }}
        showCodexBarFallback
      />,
    );

    expect(html).toContain("CodexBar is needed</h1>");
    expect(html).toContain("Download and open CodexBar, then try again.");
    expect(html).toContain("Try again</span></button>");
    expect(html).toContain(
      'href="https://github.com/steipete/CodexBar/releases/latest"',
    );
    expect(html).toContain("Download CodexBar</span></a>");
  });

  it("offers opening CodexBar instead of downloading it when every provider is off", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onCreateSupportReport={vi.fn()}
        onOpenCodexBar={vi.fn()}
        onPair={vi.fn()}
        onRepairUsageService={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{
          status: "setup_required",
          engine: { status: "ready" },
          providers: [
            { id: "codex", status: "not_configured", enabled: false },
            { id: "claude", status: "not_configured", enabled: false },
          ],
        }}
        showCodexBarFallback
      />,
    );

    expect(html).toContain("No AI provider is switched on</h1>");
    expect(html).toContain("Open CodexBar</span></button>");
    // A download would send the customer after software they already have.
    expect(html).not.toContain("Download CodexBar");
    expect(html).not.toContain(
      'href="https://github.com/steipete/CodexBar/releases/latest"',
    );
    expect(html).toContain("Try again</span></button>");
    expect(html).toContain("Create support report</span></button>");
  });

  it("does not read a timed-out usage service as every provider being off", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onCreateSupportReport={vi.fn()}
        onOpenCodexBar={vi.fn()}
        onPair={vi.fn()}
        onRepairUsageService={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{
          status: "setup_required",
          engine: { status: "ready" },
          // What CodexBar sends when its own probe timed out: the usage service
          // stands in for the inventory, and its enablement flag is a zero
          // value rather than an answer.
          providers: [{ id: "codexbar", status: "timeout", enabled: false }],
        }}
        showCodexBarFallback
      />,
    );

    expect(html).toContain("CodexBar is needed</h1>");
    expect(html).not.toContain("No AI provider is switched on");
    expect(html).not.toContain("Open CodexBar");
  });

  it("keeps the download when one provider is still switched on", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onOpenCodexBar={vi.fn()}
        onPair={vi.fn()}
        onRepairUsageService={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{
          status: "setup_required",
          engine: { status: "ready" },
          providers: [{ id: "codex", status: "auth_required", enabled: true }],
        }}
        showCodexBarFallback
      />,
    );

    expect(html).toContain("CodexBar is needed</h1>");
    expect(html).toContain("Download CodexBar</span></a>");
    expect(html).not.toContain("Open CodexBar");
  });

  it("shows one calm checking state while provider status loads", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{ status: "checking" }}
      />,
    );

    expect(html).toContain("Starting AI usage</h1>");
    expect(html.match(/role="status"/g)).toHaveLength(1);
    // Calm, but never a dead end: nothing is in flight here, so the way out
    // stays usable.
    expect(html).toContain("Try again</span></button>");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("waits for the first live image after AI usage recovers", () => {
    const html = renderToStaticMarkup(
      <DeviceStartupScreen
        deviceCandidates={[]}
        deviceSearchState="waiting"
        onPair={vi.fn()}
        onSearch={vi.fn()}
        onSelect={vi.fn()}
        providerRecovery
        providerSetup={{ status: "ready" }}
      />,
    );

    expect(html).toContain("Starting your VibeTV display</h1>");
    expect(html).toContain("loading the first live image");
    // A provider that reports ready while the device still has no picture must
    // not strand the customer on a spinner.
    expect(html).toContain("Try again</span></button>");
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

  it("keeps the way out usable while nothing is running, and locks it while it is", () => {
    const props = {
      deviceCandidates: [],
      deviceSearchState: "waiting" as const,
      onPair: vi.fn(),
      onRepairUsageService: vi.fn(),
      onSearch: vi.fn(),
      onSelect: vi.fn(),
      providerRecovery: true,
      providerSetup: { status: "ready" },
    };

    // "AI usage is ready" while the device still shows no picture is a wait
    // with no owner. It used to render a spinner and nothing else.
    const idle = renderToStaticMarkup(<DeviceStartupScreen {...props} />);
    expect(idle).toContain("Try again</span></button>");
    expect(idle).not.toContain("disabled=\"\"");

    const running = renderToStaticMarkup(
      <DeviceStartupScreen {...props} busyAction="usage-service-repair" />,
    );
    expect(running).toContain("disabled=\"\"");
  });
});
