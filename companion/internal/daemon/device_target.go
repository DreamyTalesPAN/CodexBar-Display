package daemon

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
)

func normalizeTransportName(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}

func configuredConnectionMode(fallback string) string {
	fallback = normalizeTransportName(fallback)
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return fallback
	}
	cfg, err := runtimeconfig.Load(home)
	if err != nil {
		return fallback
	}
	if transport := transportForConnectionMode(cfg.ConnectionMode); transport != "" {
		return transport
	}
	if cfg.WiFiTransitionPending() {
		return "usb"
	}
	// Configs written before connectionMode existed could only describe WiFi.
	// Preserve that proven customer choice instead of applying a newer Cable
	// launch fallback to an upgraded legacy installation.
	if strings.TrimSpace(cfg.DeviceTarget) != "" {
		return "wifi"
	}
	return fallback
}

func transportForConnectionMode(mode string) string {
	switch runtimeconfig.NormalizeConnectionMode(mode) {
	case "cable":
		return "usb"
	case "wifi":
		return "wifi"
	default:
		return ""
	}
}

func connectionModeChanged(deps runtimeDeps) bool {
	cfg, ok := loadRuntimeConfig(deps)
	if !ok {
		return false
	}
	transport := transportForConnectionMode(cfg.ConnectionMode)
	if cfg.WiFiTransitionPending() {
		transport = "usb"
	}
	return transport != "" && transport != deps.transportName
}

func cableWriteBlocked(deps runtimeDeps) bool {
	if deps.transportName != "usb" {
		return false
	}
	cfg, ok := loadRuntimeConfig(deps)
	return ok && cfg.CableAutoBindDisabled
}

func requestedDeviceTarget(opts Options) string {
	if normalizeTransportName(opts.Transport) == "wifi" {
		if target := strings.TrimSpace(opts.Target); target != "" {
			return target
		}
		return strings.TrimSpace(opts.Port)
	}
	return strings.TrimSpace(opts.Port)
}

func effectiveCycleTarget(requestedTarget string, state *runtimeState, deps runtimeDeps) string {
	requestedTarget = strings.TrimSpace(requestedTarget)
	if deps.transportName != "wifi" {
		return requestedTarget
	}
	stateTarget := ""
	if state != nil {
		stateTarget = strings.TrimSpace(state.deviceTarget)
	}
	if cfg, ok := loadRuntimeConfig(deps); ok {
		configTarget := strings.TrimSpace(cfg.DeviceTarget)
		if stateTarget != "" && configTarget != "" && isSameTarget(configTarget, requestedTarget) {
			return stateTarget
		}
		if configTarget != "" {
			return configTarget
		}
	}
	if stateTarget != "" {
		return stateTarget
	}
	return requestedTarget
}

func resolveCycleDevice(requestedPort string, state *runtimeState, deps runtimeDeps) (string, protocol.DeviceCapabilities, int, error) {
	if connectionModeChanged(deps) {
		return "", protocol.DeviceCapabilities{}, 0, ErrConnectionModeChanged
	}
	requestedPort = effectiveCycleTarget(requestedPort, state, deps)
	if deps.transportName == "wifi" && isLegacyMDNSTarget(requestedPort) {
		legacyErr := errors.New("legacy mDNS target requires IP migration")
		if recoveredPort, recoveredCaps, recovered := recoverStaleWiFiTarget(requestedPort, legacyErr, deps); recovered {
			rememberRecoveredWiFiTarget(recoveredPort, state, deps)
			return recoveredPort, recoveredCaps, maxFrameBytesForCaps(recoveredCaps), nil
		}
	}
	var port string
	var err error
	if deps.transportName == "usb" && deps.resolveUSBDevice != nil {
		expectedDeviceID := ""
		if cfg, ok := loadRuntimeConfig(deps); ok {
			expectedDeviceID = strings.TrimSpace(cfg.DeviceID)
		}
		port, err = deps.resolveUSBDevice(requestedPort, expectedDeviceID)
	} else {
		port, err = resolvePortWithFallback(requestedPort, deps)
	}
	if err != nil {
		hint := errcode.DefaultRecovery(errcode.RuntimeSerialResolve)
		if deps.transportName == "wifi" {
			hint = "Wait for automatic discovery, or rerun setup with the IP shown on VibeTV."
		}
		return "", protocol.DeviceCapabilities{}, 0, &RuntimeError{
			Kind: runtimeErrorSerialResolve,
			Op:   "resolve-target",
			Err:  fmt.Errorf("detect display target: %w", err),
			Hint: hint,
		}
	}

	caps, capsErr := deps.deviceCaps(port)
	if capsErr != nil {
		if recoveredPort, recoveredCaps, recovered := recoverStaleWiFiTarget(port, capsErr, deps); recovered {
			rememberRecoveredWiFiTarget(recoveredPort, state, deps)
			return recoveredPort, recoveredCaps, maxFrameBytesForCaps(recoveredCaps), nil
		}
		deps.logf("runtime event=device-caps-read-failed target=%s transport=%s err=%v\n", port, deps.transportName, capsErr)
		if deps.transportName == "wifi" {
			return "", protocol.DeviceCapabilities{}, 0, wifiDeviceHelloRuntimeError(port, capsErr)
		}
		caps = protocol.UnknownDeviceCapabilities()
	} else if !caps.Known {
		unknownErr := errors.New("device capabilities unknown")
		if recoveredPort, recoveredCaps, recovered := recoverStaleWiFiTarget(port, unknownErr, deps); recovered {
			rememberRecoveredWiFiTarget(recoveredPort, state, deps)
			return recoveredPort, recoveredCaps, maxFrameBytesForCaps(recoveredCaps), nil
		}
		if deps.transportName == "wifi" {
			deps.logf("runtime event=device-caps-unknown target=%s transport=%s action=skip-frame\n", publicDeviceTarget(port), deps.transportName)
			return "", protocol.DeviceCapabilities{}, 0, wifiDeviceHelloRuntimeError(port, unknownErr)
		}
	}

	persistActiveCableIdentity(caps, deps)
	rememberActiveWiFiTarget(port, caps, state)
	return port, caps, maxFrameBytesForCaps(caps), nil
}

func persistActiveCableIdentity(caps protocol.DeviceCapabilities, deps runtimeDeps) {
	deviceID := strings.TrimSpace(caps.DeviceID)
	if deps.transportName != "usb" || !caps.Known || deviceID == "" ||
		!strings.EqualFold(caps.ActiveTransport, "usb") ||
		!strings.EqualFold(caps.ConnectionMode, "cable") {
		return
	}
	home, err := deps.homeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return
	}
	persisted := false
	rolledBackFromWiFi := false
	err = runtimeconfig.WithConfigLock(home, func() error {
		cfg, err := deps.loadConfig(home)
		if err != nil {
			return err
		}
		if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "wifi" {
			return nil
		}
		rolledBackFromWiFi = cfg.WiFiTransitionPending() &&
			strings.EqualFold(cfg.DeviceID, deviceID)
		if cfg.CableAutoBindDisabled && !rolledBackFromWiFi {
			return nil
		}
		if savedID := strings.TrimSpace(cfg.DeviceID); savedID != "" && !strings.EqualFold(savedID, deviceID) {
			deps.logf("runtime event=cable-identity-persist-rejected expected=%s observed=%s\n", savedID, deviceID)
			deps.recordEvent(timeline.Event{Component: "device_identity", DeviceID: deviceID, State: "rejected", Reason: "device-id-mismatch"})
			return nil
		}
		supportedTransports := append([]string(nil), caps.SupportedTransportChannels...)
		if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" &&
			strings.EqualFold(cfg.DeviceID, deviceID) &&
			strings.Join(cfg.DeviceTransports, "\x00") == strings.Join(supportedTransports, "\x00") {
			return nil
		}
		freshSetup := runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "" &&
			strings.TrimSpace(cfg.DeviceID) == "" &&
			strings.TrimSpace(cfg.DeviceTarget) == "" &&
			len(cfg.KnownDevices) == 0
		cfg.ConnectionMode = "cable"
		cfg.DeviceID = deviceID
		cfg.DeviceTransports = supportedTransports
		if freshSetup {
			cfg.SetProviderSelectionSetupComplete(false)
			cfg.ConnectionModeChoiceRequired = true
			cfg.CableAutoBindDisabled = true
		}
		if rolledBackFromWiFi {
			cfg.ConnectionModeChoiceRequired = true
			cfg.CableAutoBindDisabled = false
		}
		if err := deps.saveConfig(home, cfg); err != nil {
			return err
		}
		persisted = true
		return nil
	})
	if err != nil {
		deps.logf("runtime event=cable-identity-persist-failed deviceId=%s err=%v\n", deviceID, err)
		return
	}
	if !persisted {
		return
	}
	if rolledBackFromWiFi {
		deps.logf("runtime event=wifi-transition-rolled-back deviceId=%s\n", deviceID)
		deps.recordEvent(timeline.Event{Component: "device_identity", DeviceID: deviceID, State: "saved", Reason: "wifi-transition-rolled-back"})
	} else {
		deps.logf("runtime event=cable-identity-persisted deviceId=%s\n", deviceID)
		deps.recordEvent(timeline.Event{Component: "device_identity", DeviceID: deviceID, State: "saved", Reason: "cable"})
	}
}

func rememberActiveWiFiTarget(target string, caps protocol.DeviceCapabilities, state *runtimeState) {
	if state == nil || strings.TrimSpace(target) == "" || !caps.Known {
		return
	}
	state.deviceTarget = strings.TrimSpace(target)
}

func rememberRecoveredWiFiTarget(target string, state *runtimeState, deps runtimeDeps) {
	target = strings.TrimSpace(target)
	if target == "" {
		return
	}
	if state != nil {
		state.deviceTarget = target
	}
	deps.logf("runtime event=wifi-target-selected target=%s\n", target)
}

func persistActiveWiFiTarget(target string, deps runtimeDeps) {
	target = strings.TrimSpace(target)
	if deps.transportName != "wifi" || target == "" {
		return
	}
	if home, err := deps.homeDir(); err == nil && strings.TrimSpace(home) != "" {
		var deviceID string
		err := runtimeconfig.WithConfigLock(home, func() error {
			cfg, err := deps.loadConfig(home)
			if err != nil || strings.TrimSpace(cfg.DeviceID) == "" {
				return err
			}
			if isSameTarget(cfg.DeviceTarget, target) {
				return nil
			}
			cfg.DeviceTarget = target
			if err := deps.saveConfig(home, cfg); err != nil {
				return err
			}
			deviceID = cfg.DeviceID
			return nil
		})
		if err != nil {
			deps.logf("runtime event=wifi-target-persist-failed target=%s err=%v\n", target, err)
		} else if strings.TrimSpace(deviceID) != "" {
			deps.logf("runtime event=wifi-target-persisted target=%s deviceId=%s\n", target, deviceID)
			deps.recordEvent(timeline.Event{Component: "device_address", DeviceID: deviceID, State: "saved"})
		}
	}
}

func recoverStaleWiFiTarget(stalePort string, staleErr error, deps runtimeDeps) (string, protocol.DeviceCapabilities, bool) {
	if deps.transportName != "wifi" {
		return "", protocol.DeviceCapabilities{}, false
	}
	candidates := []string{stalePort}
	if isLegacyMDNSTarget(stalePort) {
		candidates = nil
	}
	result, discoverErr := deps.discoverWiFi(candidates)
	if discoverErr != nil {
		return "", protocol.DeviceCapabilities{}, false
	}
	hello := result.Hello.Normalize()
	if hello.NetworkMode == "setup" {
		deps.logf("runtime event=wifi-target-rejected target=%s reason=setup-mode\n", result.Target)
		deps.recordEvent(timeline.Event{Component: "device_address", State: "rejected", Reason: "setup-mode"})
		return "", protocol.DeviceCapabilities{}, false
	}
	cfg, configOK := loadRuntimeConfig(deps)
	if configOK {
		wantID := strings.TrimSpace(cfg.DeviceID)
		gotID := strings.TrimSpace(hello.DeviceID)
		if wantID != "" && !strings.EqualFold(wantID, gotID) {
			deps.logf("runtime event=wifi-target-rejected target=%s reason=device-id-mismatch\n", result.Target)
			deps.recordEvent(timeline.Event{Component: "device_address", State: "rejected", Reason: "device-id-mismatch"})
			return "", protocol.DeviceCapabilities{}, false
		}
	}
	if result.Source == "network-scan" && (!configOK || strings.TrimSpace(cfg.DeviceID) == "") {
		deps.logf("runtime event=wifi-target-rejected target=%s reason=legacy-device-unidentified\n", result.Target)
		deps.recordEvent(timeline.Event{Component: "device_address", State: "rejected", Reason: "legacy-device-unidentified"})
		return "", protocol.DeviceCapabilities{}, false
	}
	caps := protocol.CapabilitiesFromHello(result.Hello)
	if !caps.Known {
		return "", protocol.DeviceCapabilities{}, false
	}
	deps.logf(
		"runtime event=wifi-target-discovered from=%s to=%s source=%s staleErr=%v\n",
		stalePort,
		result.Target,
		result.Source,
		staleErr,
	)
	deps.recordEvent(timeline.Event{Component: "device_address", DeviceID: caps.DeviceID, State: "rediscovered", Reason: result.Source})
	return result.Target, caps, true
}

func isLegacyMDNSTarget(target string) bool {
	parsed, err := url.Parse(strings.TrimSpace(target))
	if err != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSuffix(parsed.Hostname(), "."), "vibetv.local")
}

func isSameTarget(left, right string) bool {
	return strings.EqualFold(strings.TrimRight(strings.TrimSpace(left), "/"), strings.TrimRight(strings.TrimSpace(right), "/"))
}

func maxFrameBytesForCaps(caps protocol.DeviceCapabilities) int {
	if caps.MaxFrameBytes > 0 {
		return caps.MaxFrameBytes
	}
	return protocol.DefaultMaxFrameBytes
}

func sendTargetWithRuntimeAuth(target string, deps runtimeDeps) (string, error) {
	if deps.transportName != "wifi" {
		return target, nil
	}
	cfg, ok := loadRuntimeConfig(deps)
	if !ok {
		return "", errors.New("pairing token required: runtime config unavailable")
	}
	token := strings.TrimSpace(cfg.DeviceToken)
	if token == "" {
		return "", errors.New("pairing token required: no saved token")
	}
	authenticatedTarget := targetWithDeviceToken(target, token)
	parsed, parsedOK := parseDeviceTarget(authenticatedTarget)
	if !parsedOK || parsed.Query().Get("token") != token {
		return "", errors.New("pairing token required: could not authenticate WiFi target")
	}
	return authenticatedTarget, nil
}

func targetWithDeviceToken(target, token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return target
	}
	parsed, ok := parseDeviceTarget(target)
	if !ok {
		return target
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func publicDeviceTarget(target string) string {
	parsed, ok := parseDeviceTarget(target)
	if !ok {
		return target
	}
	query := parsed.Query()
	if _, hasToken := query["token"]; !hasToken {
		return target
	}
	query.Del("token")
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func parseDeviceTarget(target string) (*url.URL, bool) {
	target = strings.TrimSpace(target)
	if target == "" || !strings.Contains(target, "://") {
		return nil, false
	}
	parsed, err := url.Parse(target)
	if err != nil || strings.TrimSpace(parsed.Scheme) == "" || strings.TrimSpace(parsed.Host) == "" {
		return nil, false
	}
	return parsed, true
}

func resolvePortWithFallback(requestedPort string, deps runtimeDeps) (string, error) {
	// KISS + safety: never auto-switch away from an explicit requested port.
	// If the port disappears, surface the error and let operator action decide.
	return deps.resolvePort(requestedPort)
}
