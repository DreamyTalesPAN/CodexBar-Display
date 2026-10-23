package daemon

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"time"

	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/systemload"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

type runtimeDeps struct {
	singleProviderTheme   func() bool
	transport             transportlayer.DeviceTransport
	now                   func() time.Time
	after                 func(time.Duration) <-chan time.Time
	resolvePort           func(string) (string, error)
	resolveUSBDevice      func(string, string) (string, error)
	deviceCaps            func(string) (protocol.DeviceCapabilities, error)
	fetchProviders        func(context.Context) ([]codexbar.ParsedFrame, error)
	fetchDashboard        func(context.Context, codexbar.DashboardServeInfo, time.Time) ([]codexbar.ParsedFrame, error)
	fetchProvider         func(context.Context, string) (codexbar.ParsedFrame, error)
	fetchInventory        func(context.Context) ([]codexbar.ProviderSetting, error)
	fetchTokenStats       func(context.Context) (map[string]codexbar.ProviderTokenStats, bool)
	fetchTokenStatsReport func(context.Context) (map[string]codexbar.ProviderTokenStats, codexbar.ProviderTokenStatsReport)
	startDashboard        func(context.Context, func(string, ...any)) codexbar.DashboardServe
	dashboard             codexbar.DashboardServe
	usageBarsShowUsed     func() bool
	beginDeviceWrite      func() func()
	deviceWriteWaited     *atomic.Bool
	interval              time.Duration
	sendLine              func(string, []byte) error
	fetchUpdateState      func(context.Context, protocol.DeviceCapabilities) (protocol.UpdateState, error)
	newSelector           func() *codexbar.ProviderSelector
	logf                  func(string, ...any)
	record                func(timeline.Event)
	reportSystemBusy      func(*SystemBusy)
	currentSystemBusy     func() *SystemBusy
	readSystemLoad        func() (systemload.Figures, error)
	homeDir               func() (string, error)
	loadConfig            func(string) (runtimeconfig.Config, error)
	saveConfig            func(string, runtimeconfig.Config) error
	discoverWiFi          func([]string) (transportlayer.WiFiDiscoveryResult, error)
	transportName         string
}

func (d runtimeDeps) withDefaults() runtimeDeps {
	if d.transport == nil {
		d.transport = transportlayer.NewUSBTransport()
	}
	if d.transportName == "" {
		d.transportName = d.transport.Name()
	}
	if d.now == nil {
		d.now = wallClockNow
	}
	if d.after == nil {
		d.after = time.After
	}
	if d.resolvePort == nil {
		d.resolvePort = d.transport.ResolvePort
	}
	if d.deviceCaps == nil {
		d.deviceCaps = d.transport.DeviceCapabilities
	}
	if d.fetchProviders == nil {
		d.fetchProviders = codexbar.FetchAllProviders
	}
	if d.fetchDashboard == nil {
		d.fetchDashboard = codexbar.FetchDashboardProviders
	}
	if d.fetchProvider == nil {
		d.fetchProvider = codexbar.FetchProvider
	}
	if d.fetchInventory == nil {
		d.fetchInventory = codexbar.FetchProviderInventory
	}
	if d.fetchTokenStats == nil {
		d.fetchTokenStats = codexbar.FetchProviderTokenStats
		if d.fetchTokenStatsReport == nil {
			d.fetchTokenStatsReport = codexbar.FetchProviderTokenStatsWithReport
		}
	}
	if d.usageBarsShowUsed == nil {
		d.usageBarsShowUsed = func() bool { return true }
	}
	if d.sendLine == nil {
		d.sendLine = d.transport.SendLine
	}
	if d.fetchUpdateState == nil {
		d.fetchUpdateState = fetchFirmwareUpdateState
	}
	if d.newSelector == nil {
		d.newSelector = codexbar.NewProviderSelector
	}
	if d.logf == nil {
		d.logf = defaultRuntimeLogf
	}
	if d.readSystemLoad == nil {
		d.readSystemLoad = systemload.Read
	}
	if d.homeDir == nil {
		d.homeDir = os.UserHomeDir
	}
	if d.loadConfig == nil {
		d.loadConfig = runtimeconfig.Load
	}
	if d.saveConfig == nil {
		d.saveConfig = runtimeconfig.Save
	}
	if d.discoverWiFi == nil {
		d.discoverWiFi = func(candidates []string) (transportlayer.WiFiDiscoveryResult, error) {
			return transportlayer.DiscoverWiFiDevice(context.Background(), transportlayer.WiFiDiscoveryOptions{
				Candidates:         candidates,
				IncludeNetworkScan: true,
			})
		}
	}
	return d
}

// recordEvent reports state to the support timeline, when the runtime has one.
func (d runtimeDeps) recordEvent(event timeline.Event) {
	if d.record != nil {
		d.record(event)
	}
}

func defaultRuntimeLogf(format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	message = strings.TrimRight(message, "\n")
	timestamp := time.Now().UTC().Format(time.RFC3339)
	_, _ = fmt.Printf("%s %s\n", timestamp, message)
}

func loadRuntimeConfig(deps runtimeDeps) (runtimeconfig.Config, bool) {
	home, err := deps.homeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return runtimeconfig.Config{}, false
	}
	cfg, err := deps.loadConfig(home)
	if err != nil {
		return runtimeconfig.Config{}, false
	}
	return cfg, true
}

func wallClockNow() time.Time {
	// Strip monotonic data so gap detection reflects wall-clock sleep/wake jumps.
	return time.Now().Round(0)
}
