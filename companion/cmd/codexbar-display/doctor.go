package main

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
	transportlayer "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/transport"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

var doctorListPortsFn = usb.ListPorts

var doctorReadCableCapabilitiesFn = readLocalCableCapabilities

var doctorReadWiFiCapabilitiesFn = func(target string) (protocol.DeviceCapabilities, error) {
	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: doctorAuthRoundTripper{token: deviceTokenFromCommandTarget(target)},
	}
	return transportlayer.NewWiFiTransportWithClient(client).DeviceCapabilities(target)
}

var doctorCheckCompanionHealthFn = checkDoctorCompanionHealth

var doctorLaunchAgentPrintFn = func(label string) ([]byte, error) {
	status, err := service.New(label, "", false).Status(context.Background())
	return []byte(status.DiagnosticOutput()), err
}

type doctorAuthRoundTripper struct {
	token string
}

func (t doctorAuthRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Del("X-VibeTV-Token")
	if token := strings.TrimSpace(t.token); token != "" {
		request.Header.Set("X-VibeTV-Token", token)
	}
	return http.DefaultTransport.RoundTrip(request)
}

func runDoctor() error {
	var doctorErrs []error

	bin, err := codexbar.FindBinary()
	if err != nil {
		fmt.Printf("CodexBar CLI: not found (%v)\n", err)
		doctorErrs = append(doctorErrs, errors.New("CodexBar CLI not found"))
	} else {
		fmt.Printf("CodexBar CLI: %s\n", bin)
		versionCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		version, versionErr := codexbar.InstalledVersion(versionCtx, bin)
		if versionErr != nil {
			fmt.Printf("CodexBar version: failed (%v)\n", versionErr)
			doctorErrs = append(doctorErrs, fmt.Errorf("CodexBar version check failed: %w", versionErr))
		} else if versionCheckErr := codexbar.CheckMinimumVersion(versionCtx, bin); versionCheckErr != nil {
			fmt.Printf("CodexBar version: %s (too old, need >= %s)\n", version, codexbar.MinimumSupportedVersion())
			doctorErrs = append(doctorErrs, versionCheckErr)
		} else {
			fmt.Printf("CodexBar version: %s (ok, need >= %s)\n", version, codexbar.MinimumSupportedVersion())
		}
	}

	runtimeConfig, configErr := readDoctorRuntimeConfig()
	if configErr != nil {
		fmt.Printf("Active runtime: unavailable (%v)\n", configErr)
		doctorErrs = append(doctorErrs, fmt.Errorf("read active runtime configuration failed: %w", configErr))
	} else if runtimeErr := runDoctorTransportChecks(runtimeConfig); runtimeErr != nil {
		doctorErrs = append(doctorErrs, runtimeErr)
	}

	if bin != "" {
		checkCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		frame, fetchErr := codexbar.FetchFirstFrame(checkCtx)
		if fetchErr != nil {
			fmt.Printf("Provider preview: failed (%v)\n", fetchErr)
			doctorErrs = append(doctorErrs, fmt.Errorf("provider preview failed: %w", fetchErr))
		} else {
			fmt.Printf("Provider preview: %s session=%d%% weekly=%d%% reset=%ds\n",
				frame.Label, frame.Session, frame.Weekly, frame.ResetSec)
		}
	}

	if len(doctorErrs) > 0 {
		return errors.Join(doctorErrs...)
	}
	return nil
}

type doctorRuntimeConfig struct {
	configured  bool
	label       string
	transport   string
	target      string
	probeTarget string
	authReady   bool
	port        string
}

func readDoctorRuntimeConfig() (doctorRuntimeConfig, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return doctorRuntimeConfig{}, err
	}
	if runtime.GOOS == "windows" {
		label := service.WindowsRuntimeLabel(home)
		manager := service.New(label, home, false)
		status, err := manager.Status(context.Background())
		if err != nil {
			return doctorRuntimeConfig{}, err
		}
		if !status.Enabled || !service.Healthy(status.State) {
			return doctorRuntimeConfig{}, fmt.Errorf("background task is %s (enabled=%t)", status.State, status.Enabled)
		}
		task, err := service.ReadTaskConfig(home, label)
		if err != nil {
			return doctorRuntimeConfig{}, err
		}
		return doctorTaskRuntimeConfig(home, label, task.Arguments)
	}

	for _, label := range bundledRuntimeLabels {
		if output, err := doctorLaunchAgentPrintFn(label); err == nil && doctorLaunchAgentStateHealthy(string(output)) {
			cfg, err := runtimeconfig.Load(home)
			if err != nil {
				return doctorRuntimeConfig{}, err
			}
			transportName := runtimeconfig.ActiveTransport(cfg)
			target := ""
			probeTarget := ""
			if transportName == "wifi" {
				target = cfg.DeviceTarget
				probeTarget = doctorWiFiProbeTarget(target, cfg, false)
			}
			return doctorRuntimeConfig{
				configured:  true,
				label:       label,
				transport:   transportName,
				target:      target,
				probeTarget: probeTarget,
				authReady:   transportName != "wifi" || deviceTokenFromCommandTarget(probeTarget) != "",
			}, nil
		}
	}

	launchctlOutput, err := doctorLaunchAgentPrintFn(runtimepaths.LegacyDisplayStreamLaunchAgentLabel)
	if err != nil || !doctorLaunchAgentStateHealthy(string(launchctlOutput)) {
		return doctorRuntimeConfig{}, nil
	}
	data, err := readDoctorLegacyLaunchAgentPlist(home, string(launchctlOutput), os.ReadFile)
	if err != nil {
		return doctorRuntimeConfig{}, err
	}
	plist := string(data)
	transportName := strings.ToLower(parseLaunchAgentArgument(plist, "--transport"))
	if transportName == "" {
		if parseLaunchAgentArgument(plist, "--target") != "" {
			transportName = "wifi"
		} else {
			transportName = "usb"
		}
	}
	target := ""
	probeTarget := ""
	if transportName == "wifi" {
		cfg, err := runtimeconfig.Load(home)
		if err != nil {
			return doctorRuntimeConfig{}, err
		}
		target = doctorWiFiTarget(cfg.DeviceTarget, parseLaunchAgentArgument(plist, "--target"))
		probeTarget = doctorWiFiProbeTarget(target, cfg, true)
	}
	return doctorRuntimeConfig{
		configured:  true,
		label:       runtimepaths.LegacyDisplayStreamLaunchAgentLabel,
		transport:   transportName,
		target:      target,
		probeTarget: probeTarget,
		authReady:   transportName != "wifi" || deviceTokenFromCommandTarget(probeTarget) != "",
	}, nil
}

func doctorTaskRuntimeConfig(home, label string, args []string) (doctorRuntimeConfig, error) {
	config := doctorRuntimeConfig{configured: true, label: label, transport: "usb"}
	for i := 0; i+1 < len(args); i++ {
		switch args[i] {
		case "--transport":
			config.transport = args[i+1]
		case "--target":
			config.target = args[i+1]
		case "--port":
			config.port = args[i+1]
		}
	}
	config.authReady = config.transport != "wifi"
	if config.transport == "wifi" {
		cfg, err := runtimeconfig.Load(home)
		if err != nil {
			return doctorRuntimeConfig{}, err
		}
		config.target = doctorWiFiTarget(cfg.DeviceTarget, config.target)
		config.probeTarget = doctorWiFiProbeTarget(config.target, cfg, true)
		config.authReady = deviceTokenFromCommandTarget(config.probeTarget) != ""
	}
	return config, nil
}

func readDoctorLegacyLaunchAgentPlist(home, launchctlOutput string, readFile func(string) ([]byte, error)) ([]byte, error) {
	name := runtimepaths.LegacyDisplayStreamLaunchAgentLabel + ".plist"
	paths := []string{parseDoctorLaunchAgentPath(launchctlOutput)}
	paths = append(paths,
		filepath.Join(home, "Library", "LaunchAgents", name),
		filepath.Join("/Library", "LaunchAgents", name),
	)
	for _, path := range paths {
		if path == "" {
			continue
		}
		data, err := readFile(path)
		if err == nil {
			return data, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	return nil, os.ErrNotExist
}

func parseDoctorLaunchAgentPath(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "path = ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "path = "))
		}
	}
	return ""
}

func doctorLaunchAgentStateHealthy(output string) bool {
	state, _ := service.ParseStatus(output)
	return service.Healthy(state)
}

func doctorWiFiTarget(configTarget, plistTarget string) string {
	if target := strings.TrimSpace(configTarget); target != "" {
		return target
	}
	return strings.TrimSpace(plistTarget)
}

func doctorWiFiProbeTarget(target string, cfg runtimeconfig.Config, allowInlineToken bool) string {
	publicTarget := publicDeviceTargetForConfig(target)
	if publicTarget == "" {
		return strings.TrimSpace(target)
	}
	if strings.TrimSpace(cfg.DeviceToken) != "" &&
		(strings.TrimSpace(cfg.DeviceTarget) == "" || sameCommandDeviceTarget(publicTarget, cfg.DeviceTarget)) {
		return targetWithRequiredQueryToken(publicTarget, cfg.DeviceToken)
	}
	if allowInlineToken {
		return strings.TrimSpace(target)
	}
	return publicTarget
}

func runDoctorTransportChecks(config doctorRuntimeConfig) error {
	if !config.configured {
		fmt.Println("Active runtime: not configured (run `codexbar-display setup`)")
		fmt.Println("  available transports: wifi, usb")
		return errors.New("runtime setup required: no active runtime configuration")
	}

	fmt.Printf("Active runtime: transport=%s\n", config.transport)
	switch config.transport {
	case "wifi":
		fmt.Println("Serial ports: not applicable (active transport is WiFi)")
		return runDoctorWiFiRuntimeChecks(config)
	case "usb":
		ports, err := doctorListPortsFn()
		if err != nil {
			return fmt.Errorf("list serial ports: %w", err)
		}
		fmt.Println("Serial ports:")
		if len(ports) == 0 {
			fmt.Println("  (none)")
		} else {
			for _, port := range ports {
				fmt.Printf("  %s\n", port)
			}
		}
		return runDoctorUSBRuntimeChecks(config)
	default:
		return fmt.Errorf("runtime setup required: unsupported active transport %q", config.transport)
	}
}

func printDoctorRuntimeDefaults() {
	fmt.Println("Runtime checks:")
	fmt.Printf("  codexbar timeout: %s\n", codexbar.CommandTimeout())
	fmt.Printf("  last-good max age: %s\n", daemon.LastGoodMaxAge())
	fmt.Printf("  sleep/wake threshold (@60s interval): %s\n", daemon.SleepWakeGapThreshold(60*time.Second))
}

// The doctor asks the running Companion for the Cable state instead of opening
// the serial port itself. That keeps it correct on every platform: the running
// worker owns the port, so a second open would either be refused or force the
// background task to be stopped and restarted around the check.
func runDoctorUSBRuntimeChecks(config doctorRuntimeConfig) error {
	printDoctorRuntimeDefaults()
	caps, err := doctorReadCableCapabilitiesFn(config.label)
	if err != nil {
		fmt.Printf("  Companion Cable status: failed (%v)\n", err)
		return fmt.Errorf("runtime Companion Cable status failed: %w", err)
	}
	fmt.Println("  Companion Cable status: ok")
	fmt.Println("  Cable identity: resolved by running Companion")
	return reportDoctorCapabilities("Cable device", caps)
}

func runDoctorWiFiRuntimeChecks(config doctorRuntimeConfig) error {
	printDoctorRuntimeDefaults()
	target := strings.TrimSpace(config.target)
	fmt.Println("  Cable identity: not applicable (active transport is WiFi)")
	if target == "" {
		fmt.Println("  WiFi device target: unavailable (connect VibeTV in Control Center)")
		return errors.New("runtime WiFi target unavailable: connect VibeTV in Control Center")
	}
	fmt.Printf("  WiFi device target: %s\n", doctorPublicWiFiTarget(target))
	if !config.authReady {
		fmt.Println("  WiFi device credential: unavailable (reconnect VibeTV in Control Center)")
		return errors.New("runtime WiFi credential unavailable: reconnect VibeTV in Control Center")
	}
	if err := doctorCheckCompanionHealthFn(config.label); err != nil {
		fmt.Printf("  Companion health: failed (%v)\n", err)
		return fmt.Errorf("runtime Companion health failed: %w", err)
	}
	fmt.Println("  Companion health: ok")
	probeTarget := strings.TrimSpace(config.probeTarget)
	if probeTarget == "" {
		probeTarget = target
	}
	caps, err := doctorReadWiFiCapabilitiesFn(probeTarget)
	if err != nil {
		fmt.Printf("  WiFi device reachability: failed (%v)\n", err)
		return fmt.Errorf("runtime WiFi device reachability failed: %w", err)
	}
	if !caps.Known {
		fmt.Println("  WiFi device reachability: failed (device capabilities unknown)")
		return errors.New("runtime WiFi device reachability failed: device capabilities unknown")
	}
	return reportDoctorCapabilities("WiFi device reachability", caps)
}

func doctorPublicWiFiTarget(target string) string {
	return sanitizeDisplayStreamLogMessage(publicDeviceTargetForConfig(target))
}

func reportDoctorCapabilities(label string, caps protocol.DeviceCapabilities) error {
	fmt.Printf("  %s: ok board=%s protocol=%d negotiated=%d firmware=%s theme=%t themeSpecV1=%t maxFrameBytes=%d\n",
		label,
		caps.Board,
		caps.ProtocolVersion,
		caps.NegotiatedProtocolVersion,
		caps.Firmware,
		caps.SupportsTheme,
		caps.SupportsThemeSpecV1,
		caps.MaxFrameBytes)
	if len(caps.SupportedProtocolVersions) > 0 {
		fmt.Printf("  %s protocols: %v (preferred=%d)\n", label, caps.SupportedProtocolVersions, caps.PreferredProtocolVersion)
	}
	if !caps.Known {
		fmt.Println("  warning: device capabilities are unknown; skipping strict hardware/theme contract checks")
		return nil
	}

	switch caps.Board {
	case "esp8266-smalltv-st7789":
		if caps.Known && !caps.SupportsTheme {
			return fmt.Errorf("runtime capability check failed: board %q does not advertise theme support", caps.Board)
		}
	case "esp32-lilygo-t-display-s3":
		fmt.Println("  warning: esp32 fallback board detected (non-blocking)")
	default:
		return fmt.Errorf("runtime hardware contract failed: unsupported board %q", caps.Board)
	}

	if !protocol.IsSupportedProtocolVersion(caps.NegotiatedProtocolVersion) {
		return fmt.Errorf(
			"runtime protocol contract failed: negotiated protocol version %d unsupported by companion",
			caps.NegotiatedProtocolVersion,
		)
	}

	return nil
}

func parseLaunchAgentArgument(plist, name string) string {
	marker := "<string>" + name + "</string>"
	idx := strings.Index(plist, marker)
	if idx < 0 {
		return ""
	}
	rest := plist[idx+len(marker):]
	start := strings.Index(rest, "<string>")
	if start < 0 {
		return ""
	}
	rest = rest[start+len("<string>"):]
	end := strings.Index(rest, "</string>")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(xmlUnescape(rest[:end]))
}

func xmlUnescape(value string) string {
	var decoded string
	if err := xml.Unmarshal([]byte("<string>"+value+"</string>"), &decoded); err != nil {
		return value
	}
	return decoded
}
