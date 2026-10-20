package companionapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

type diagnosticsResponse struct {
	OK               bool                     `json:"ok"`
	SchemaVersion    int                      `json:"schemaVersion"`
	ReportType       string                   `json:"reportType"`
	GeneratedAt      string                   `json:"generatedAt"`
	Environment      diagnosticsEnvironment   `json:"environment"`
	Configuration    diagnosticsConfiguration `json:"configuration"`
	NetworkDiscovery diagnosticsDiscovery     `json:"networkDiscovery"`
	Companion        companion                `json:"companion"`
	Device           deviceInfo               `json:"device"`
	ProviderSetup    codexbar.ProviderSetup   `json:"providerSetup"`
	UsageEngine      diagnosticsUsageEngine   `json:"usageEngine"`
	// LastCollection lets support read "2 providers, 1 delivering" without the
	// daemon log (#368). Absent until a collection has completed.
	LastCollection *daemon.CollectorCycle `json:"lastCollection,omitempty"`
	SetupLog       setupLog               `json:"setupLog"`
	Timeline       timeline.Log           `json:"timeline"`
	Checks         []diagnosticCheck      `json:"checks"`
	// NoReadingSince names the providers that are not delivering and when
	// each one's last usage reading was (#368); see noReadingSinceByProvider.
	NoReadingSince map[string]string `json:"noReadingSince,omitempty"`
	// SystemBusy has the memory and load figures while the computer is too
	// starved for the usage engine to answer (#606).
	SystemBusy *daemon.SystemBusy `json:"systemBusy,omitempty"`
}

type diagnosticsEnvironment struct {
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	GoVersion string `json:"goVersion"`
	PID       int    `json:"pid"`
}

type diagnosticsConfiguration struct {
	DeviceTarget     string `json:"deviceTarget,omitempty"`
	DeviceID         string `json:"deviceId,omitempty"`
	HasPairingToken  bool   `json:"hasPairingToken"`
	KnownDeviceCount int    `json:"knownDeviceCount"`
}

type diagnosticsDiscovery struct {
	Attempted bool                `json:"attempted"`
	Complete  bool                `json:"complete"`
	Found     bool                `json:"vibeTVFound"`
	Devices   []deviceSearchEntry `json:"devices"`
	ErrorCode string              `json:"errorCode,omitempty"`
	Detail    string              `json:"detail,omitempty"`
}

type diagnosticCheck struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Detail     string `json:"detail,omitempty"`
	ErrorCode  string `json:"errorCode,omitempty"`
	NextAction string `json:"nextAction,omitempty"`
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	diagnosticsTarget := configuredStatusTarget(cfg)
	cableMode := runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable"

	discovery := diagnosticsDiscovery{Devices: []deviceSearchEntry{}}
	var discoveryResult <-chan diagnosticsDiscovery
	if !cableMode {
		result := make(chan diagnosticsDiscovery, 1)
		discoveryResult = result
		go func() {
			result <- s.diagnosticsNetworkDiscovery(r.Context(), cfg)
		}()
	}
	providerSetup := s.currentProviderSetup(r.Context(), false)
	checks := []diagnosticCheck{
		{
			Name:   "companion_api",
			Status: "pass",
			Detail: "Companion API is running.",
		},
		usageEngineDiagnosticCheck(providerSetup.Engine),
		providerDiagnosticCheck(providerSetup, true),
	}
	if discoveryResult != nil {
		discovery = <-discoveryResult
		checks = append(checks, discoveryDiagnosticCheck(discovery))
	}
	var lastCollection *daemon.CollectorCycle
	if s.loadCollectorCycle != nil {
		if cycle, ok := s.loadCollectorCycle(); ok {
			lastCollection = &cycle
		}
	}
	var noReadingSince map[string]string
	if s.loadUsage != nil {
		if usage, ok := s.loadUsage(s.currentTime().UTC()); ok {
			noReadingSince = noReadingSinceByProvider(usage, true)
		}
	}
	writeReport := func(device deviceInfo) {
		writeJSON(w, http.StatusOK, diagnosticsResponse{
			OK:            true,
			SchemaVersion: 2,
			ReportType:    "control_center",
			GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
			Environment: diagnosticsEnvironment{
				OS:        runtime.GOOS,
				Arch:      runtime.GOARCH,
				GoVersion: runtime.Version(),
				PID:       os.Getpid(),
			},
			Configuration: diagnosticsConfiguration{
				DeviceTarget:     publicTarget(diagnosticsTarget),
				DeviceID:         strings.TrimSpace(cfg.DeviceID),
				HasPairingToken:  strings.TrimSpace(cfg.DeviceToken) != "",
				KnownDeviceCount: len(cfg.KnownDevices),
			},
			NetworkDiscovery: discovery,
			Companion:        s.companionInfo(r.Context()),
			Device:           device,
			ProviderSetup:    providerSetup,
			UsageEngine:      usageEngineDiagnostics(providerSetup.Engine),
			LastCollection:   lastCollection,
			NoReadingSince:   noReadingSince,
			SystemBusy:       s.currentSystemBusy(),
			SetupLog:         s.setupEvents.snapshot(s.currentTime()),
			Timeline:         s.timeline.Snapshot(s.currentTime()),
			Checks:           checks,
		})
	}
	if themeInstallEnabled() {
		checks = append(checks, diagnosticCheck{
			Name:   "theme_install_gate",
			Status: "pass",
			Detail: "Theme install is available.",
		})
	} else {
		checks = append(checks, diagnosticCheck{
			Name:       "theme_install_gate",
			Status:     "disabled",
			Detail:     "Theme install is disabled by local Mac App configuration.",
			NextAction: "Unset VIBETV_DISABLE_WIFI_THEME_INSTALL, then restart the Mac App.",
		})
	}

	device := deviceInfo{
		Target:    publicTarget(diagnosticsTarget),
		DeviceID:  strings.TrimSpace(cfg.DeviceID),
		Connected: false,
		Paired:    strings.TrimSpace(cfg.DeviceToken) != "",
		Active:    strings.TrimSpace(cfg.DeviceID) != "",
		Stream:    streamPointer(s.streamStatus(r.Context(), diagnosticsTarget)),
	}
	writeDeviceReport := func(device deviceInfo) {
		checks = appendDisplayStreamDiagnostic(checks, device.Stream)
		if updateJob, ok := s.latestFirmwareUpdateJob(); ok {
			checks = append(checks, diagnosticCheck{
				Name:       "firmware_update",
				Status:     firmwareUpdateDiagnosticStatus(updateJob),
				Detail:     firmwareUpdateDiagnosticDetail(updateJob),
				ErrorCode:  firmwareUpdateDiagnosticErrorCode(updateJob),
				NextAction: firmwareUpdateDiagnosticNextAction(updateJob),
			})
		}
		writeReport(device)
	}
	if cableMode {
		checks = append(checks, diagnosticCheck{
			Name:   "device_target",
			Status: "pass",
			Detail: cableDeviceTarget,
		})
		device = s.withConfiguredConnectionState(
			cfg,
			device,
			providerSetupStreamForTarget(device.Stream, device.Target),
			false,
			false,
		)
		writeDeviceReport(device)
		return
	}
	if strings.TrimSpace(diagnosticsTarget) == "" {
		checks = append(checks, diagnosticCheck{
			Name:       "device_target",
			Status:     "attention",
			Detail:     "No VibeTV target is configured.",
			ErrorCode:  "device_target_missing",
			NextAction: "Run device discovery or enter the exact VibeTV target in the VibeTV target field.",
		})
		writeReport(device)
		return
	}

	checks = append(checks, diagnosticCheck{
		Name:   "device_target",
		Status: "pass",
		Detail: publicTarget(cfg.DeviceTarget),
	})
	hello, probeToken, _, err := s.getHelloProbeWithTokenFallback(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, discoveryProbeTime)
	if err != nil {
		checks = append(checks, diagnosticCheck{
			Name:       "device_hello",
			Status:     "fail",
			Detail:     sanitizeErrorDetail(err),
			ErrorCode:  "device_hello_failed",
			NextAction: "Keep VibeTV powered on, then run discovery again.",
		})
		writeReport(device)
		return
	}

	device = s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello))
	// A report describes the same VibeTV the rest of the API describes. Leaving
	// this unset shipped active=false — the field has no omitempty — and the
	// Control Center believed the configured device had gone away every time a
	// customer created a support report.
	device.Active = strings.TrimSpace(cfg.DeviceID) != "" && strings.EqualFold(cfg.DeviceID, device.DeviceID)
	checks = append(checks, diagnosticCheck{
		Name:   "device_hello",
		Status: "pass",
		Detail: "VibeTV /hello is reachable.",
	})
	health, err := s.getHealthProbe(r.Context(), cfg.DeviceTarget, probeToken, deviceHealthProbeTime)
	if err != nil {
		device = withDeviceHealthProbeError(device, err)
		checks = append(checks, diagnosticCheck{
			Name:       "device_health",
			Status:     "attention",
			Detail:     sanitizeErrorDetail(err),
			ErrorCode:  "device_health_failed",
			NextAction: "Read-only device discovery works; retry settings or check firmware health.",
		})
	} else {
		device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, probeToken, false)
		checks = append(checks, diagnosticCheck{
			Name:   "device_health",
			Status: "pass",
			Detail: "VibeTV /health is reachable.",
		})
		if device.Display != nil && device.Display.ThemeSpec != nil && device.Display.ThemeSpec.RenderOK != nil {
			spec := device.Display.ThemeSpec
			if *spec.RenderOK {
				checks = append(checks, diagnosticCheck{
					Name:   "display_render",
					Status: "pass",
					Detail: renderHealthDiagnosticDetail(spec),
				})
			} else {
				checks = append(checks, diagnosticCheck{
					Name:       "display_render",
					Status:     "fail",
					Detail:     renderHealthDiagnosticDetail(spec),
					ErrorCode:  "display_render_failed",
					NextAction: "Reload the VibeTV image from Control Center.",
				})
			}
		}
	}
	writeDeviceReport(device)
}

func appendDisplayStreamDiagnostic(checks []diagnosticCheck, stream *displayStreamInfo) []diagnosticCheck {
	if stream != nil && stream.Healthy {
		return append(checks, diagnosticCheck{
			Name:   "display_stream",
			Status: "pass",
			Detail: stream.Detail,
		})
	}
	if stream != nil && stream.ErrorCode == "provider_setup_required" {
		return append(checks, diagnosticCheck{
			Name:       "display_stream",
			Status:     "attention",
			Detail:     stream.Detail,
			ErrorCode:  "provider_setup_required",
			NextAction: "Finish AI setup in the Mac App.",
		})
	}
	return append(checks, diagnosticCheck{
		Name:       "display_stream",
		Status:     "fail",
		Detail:     displayStreamDiagnosticDetail(stream),
		ErrorCode:  "display_stream_not_ready",
		NextAction: "Click Fix connection to restart the display stream.",
	})
}

func (s *Server) diagnosticsNetworkDiscovery(ctx context.Context, cfg runtimeconfig.Config) diagnosticsDiscovery {
	searchCtx, cancel := context.WithTimeout(ctx, diagnosticsDiscoveryTime)
	defer cancel()
	devices, err := s.searchDevicesOnce(searchCtx, cfg, "")
	if err == nil && searchCtx.Err() != nil {
		err = searchCtx.Err()
	}
	result := diagnosticsDiscovery{
		Attempted: true,
		Complete:  err == nil,
		Devices:   devices,
		Found:     len(devices) > 0,
	}
	if result.Devices == nil {
		result.Devices = []deviceSearchEntry{}
	}
	if err != nil {
		result.ErrorCode = "device_search_failed"
		if errors.Is(err, errLocalNetworkAccessDenied) {
			result.ErrorCode = "local_network_access_denied"
		} else if errors.Is(err, errNoLocalNetwork) {
			result.ErrorCode = "network_unavailable"
		} else if errors.Is(err, context.DeadlineExceeded) {
			result.ErrorCode = "device_search_incomplete"
		}
		result.Detail = sanitizeErrorDetail(err)
	}
	return result
}

func discoveryDiagnosticCheck(discovery diagnosticsDiscovery) diagnosticCheck {
	if discovery.ErrorCode != "" {
		nextAction := "Keep VibeTV powered on and connected to the same WiFi, then create the report again."
		if discovery.ErrorCode == "local_network_access_denied" {
			nextAction = "Allow Local Network access for VibeTV Control Center, then create the report again."
		}
		return diagnosticCheck{
			Name:       "network_discovery",
			Status:     "attention",
			Detail:     discovery.Detail,
			ErrorCode:  discovery.ErrorCode,
			NextAction: nextAction,
		}
	}
	if !discovery.Found {
		return diagnosticCheck{
			Name:       "network_discovery",
			Status:     "attention",
			Detail:     "No VibeTV answered the read-only WiFi search.",
			ErrorCode:  "vibetv_not_found_on_wifi",
			NextAction: "Keep VibeTV powered on and connected to the same WiFi as this Mac.",
		}
	}
	return diagnosticCheck{
		Name:   "network_discovery",
		Status: "pass",
		Detail: fmt.Sprintf("Found %d VibeTV device(s) on WiFi.", len(discovery.Devices)),
	}
}
