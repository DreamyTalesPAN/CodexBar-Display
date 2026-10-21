package companionapi

import (
	"net/http"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type configuredDeviceConnection struct {
	lastSeenAt time.Time
	// The theme path and render error of the last health reading that
	// themeCannotBeDrawn named, and when that run of readings began.
	themeNotDrawn       string
	themeNotDrawnAt     time.Time
	themeNotDrawnLastAt time.Time
}

type deviceInfo struct {
	Target          string                    `json:"target,omitempty"`
	DeviceID        string                    `json:"deviceId,omitempty"`
	NetworkMode     string                    `json:"networkMode,omitempty"`
	Connected       bool                      `json:"connected"`
	Paired          bool                      `json:"paired"`
	Ready           bool                      `json:"ready"`
	Active          bool                      `json:"active"`
	ConnectionState string                    `json:"connectionState,omitempty"`
	LastSeenAt      string                    `json:"lastSeenAt,omitempty"`
	Board           string                    `json:"board,omitempty"`
	Firmware        string                    `json:"firmware,omitempty"`
	ActiveTheme     string                    `json:"activeTheme,omitempty"`
	Capabilities    *protocol.CapabilityBlock `json:"capabilities,omitempty"`
	Stream          *displayStreamInfo        `json:"stream,omitempty"`
	Display         *deviceDisplayInfo        `json:"display,omitempty"`
	Standby         *deviceStandbyInfo        `json:"standby,omitempty"`
	Health          *deviceHealthInfo         `json:"health,omitempty"`
	// LegacyCableAnswered tells the app to connect this WiFi VibeTV by Cable:
	// it came from firmware before cable-only updates and has since answered
	// over the USB cable (issue #498).
	LegacyCableAnswered bool `json:"legacyCableAnswered"`
}

type deviceDisplayInfo struct {
	ThemeSpec *themeSpecHealth `json:"themeSpec,omitempty"`
}

type deviceStandbyInfo struct {
	Active        bool   `json:"active"`
	LiveThemePath string `json:"liveThemePath,omitempty"`
	// Mirrored from settings.standby.screensaverPath on the same health probe.
	// The slot is standby state the Control Center needs on every poll, the way
	// it already gets the live theme path — reading it from the settings screen
	// instead left the automatic screensaver update waiting for a visit there.
	ScreensaverPath string `json:"screensaverPath,omitempty"`
}

type deviceHealthInfo struct {
	OK          bool   `json:"ok"`
	BootID      string `json:"bootId,omitempty"`
	UptimeMs    uint64 `json:"uptimeMs,omitempty"`
	ResetCount  uint32 `json:"resetCount,omitempty"`
	ResetReason string `json:"resetReason,omitempty"`
	LastResetAt string `json:"lastResetAt,omitempty"`
	RenderKind  string `json:"renderKind,omitempty"`
	Error       string `json:"error,omitempty"`
	// Set when the device reports a signal reading (#265).
	WiFi *deviceWiFiHealth `json:"wifi,omitempty"`
}

type deviceWiFiHealth struct {
	RSSI      int    `json:"rssi"`
	Channel   int    `json:"channel,omitempty"`
	PhyMode   string `json:"phyMode,omitempty"`
	SleepMode string `json:"sleepMode,omitempty"`
	// Weak is the Mac App's decision, set by getHealth for a VibeTV on WiFi.
	Weak bool `json:"weak,omitempty"`
	// Recovered is a valid reading above the Companion's current weak threshold.
	// An unconfirmed low reading or missing RSSI is not recovery.
	Recovered bool `json:"recovered,omitempty"`
}

// The VibeTV whose WiFi readings are at or below the weak-signal threshold,
// when that run of readings began and when its latest one was.
type weakWiFiRun struct {
	target string
	since  time.Time
	last   time.Time
	named  bool
}

type themeSpecHealth struct {
	Active           bool   `json:"active"`
	Path             string `json:"path,omitempty"`
	Hash             string `json:"hash,omitempty"`
	RenderOK         *bool  `json:"renderOk,omitempty"`
	RenderError      string `json:"renderError,omitempty"`
	RenderErrorAsset string `json:"renderErrorAsset,omitempty"`
	RenderFailures   uint64 `json:"renderFailures,omitempty"`
	// The animation frame buffer the VibeTV holds right now; only read by
	// themeCannotBeDrawn.
	cbaBufferBytes uint64
}

type statusResponse struct {
	OK                           bool                   `json:"ok"`
	Companion                    companion              `json:"companion"`
	Device                       deviceInfo             `json:"device"`
	ConnectionMode               string                 `json:"connectionMode,omitempty"`
	ConnectionModeChoiceRequired bool                   `json:"connectionModeChoiceRequired"`
	ProviderSetup                codexbar.ProviderSetup `json:"providerSetup"`
	Setup                        setupProgress          `json:"setup"`
	ThemeInstall                 *themeInstallJob       `json:"themeInstall,omitempty"`
	FirmwareUpdate               *firmwareUpdateJob     `json:"firmwareUpdate,omitempty"`
	// SystemBusy is present while the computer is too starved for the usage
	// engine to answer (#606); the app then tells the customer.
	SystemBusy *daemon.SystemBusy `json:"systemBusy,omitempty"`
}

type deviceActionResponse struct {
	OK     bool       `json:"ok"`
	Device deviceInfo `json:"device"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if r.URL.Query().Has("checkAppUpdate") {
		// The customer clicked "Check for updates": this read asks the release
		// source again instead of repeating an answer up to six hours old.
		s.macAppReleaseMu.Lock()
		s.macAppReleaseChecked = false
		s.macAppReleaseMu.Unlock()
	}
	cfg, _ := s.config()
	statusTarget := configuredStatusTarget(cfg)
	cableMode := runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable"
	stream := s.streamStatus(r.Context(), statusTarget)
	device := deviceInfo{
		Target:          publicTarget(statusTarget),
		DeviceID:        strings.TrimSpace(cfg.DeviceID),
		Connected:       false,
		Paired:          strings.TrimSpace(cfg.DeviceToken) != "",
		Active:          strings.TrimSpace(cfg.DeviceID) != "",
		ConnectionState: deviceConnectionSetup,
		Stream:          streamPointer(stream),
	}
	if len(cfg.DeviceTransports) > 0 {
		device.Capabilities = &protocol.CapabilityBlock{
			Transport: protocol.TransportCapabilities{
				Supported: append([]string(nil), cfg.DeviceTransports...),
			},
		}
	}
	reachable := false
	identityMismatch := false
	cableAbsenceUnconfirmed := false
	if cableMode {
		device.Capabilities = cableCapabilityBlock(cfg.DeviceTransports)
		// An unplugged port is answered before any lock. On Windows a probe
		// stuck on the old handle holds the device and sender locks for its
		// whole hello window. The sender drops its hello when that handle
		// closes, so skipping the cached hello here loses nothing lasting.
		var vanishedErr error
		if strings.TrimSpace(cfg.DeviceID) != "" && s.cablePortVanished != nil {
			vanishedErr = s.cablePortVanished()
		}
		var hello protocol.DeviceHello
		helloKnown := false
		if vanishedErr == nil {
			hello, helloKnown = s.currentCableHello()
		}
		// Resolution reads a fresh matching hello and repopulates the sender
		// after a failed probe cleared it. A cached hello is metadata, not a
		// prerequisite for asking whether the configured device is connected.
		if vanishedErr == nil {
			s.firmwareUpdateStartMu.Lock()
		}
		_, updateRunning := s.activeFirmwareUpdateJob()
		// Maintenance skips the probe, which leaves absence unconfirmed. A
		// vanished port is current proof of absence even then.
		cableAbsenceUnconfirmed = vanishedErr == nil && (updateRunning || s.themeInstallInFlight())
		port := ""
		// Status polls must answer within the UI timeout, so they only ask the
		// port the VibeTV last used. Before the Companion knows that port (right
		// after it starts), the daemon's own search finds the device and its
		// first frame records the port; until then absence stays undecided.
		lastPort := ""
		if s.lastCablePort != nil {
			lastPort = s.lastCablePort()
		}
		if vanishedErr == nil && lastPort == "" {
			cableAbsenceUnconfirmed = true
		}
		if !cableAbsenceUnconfirmed && strings.TrimSpace(cfg.DeviceID) != "" {
			portErr := vanishedErr
			if portErr == nil {
				port, portErr = s.resolveCablePort(lastPort, cfg.DeviceID)
			}
			if portErr == nil {
				if freshHello, ok := s.currentCableHello(); ok {
					hello, helloKnown = freshHello, true
				}
				// The control resolver also accepts the device in WiFi mode so
				// it can be switched back. Only a Cable-mode hello proves the
				// display stream can use it; anything else stays undecided.
				if helloKnown && cableHelloMatchesConfig(hello, cfg.DeviceID) {
					reachable = true
				} else {
					cableAbsenceUnconfirmed = true
				}
			} else {
				// A current busy or unanswered probe cannot refresh an old
				// absence report. Only explicitly missing ports confirm it.
				switch errcode.Of(portErr) {
				case errcode.TransportNoUSBSerialPorts, errcode.TransportSerialPortNotFound:
					// Current port absence overrides the daemon's last
					// acknowledged frame, even before its next send fails.
					stream.Healthy = false
					stream.Target = cableDeviceTarget
					stream.ErrorCode = "device_not_found"
					stream.Detail = "VibeTV's USB connection is disconnected."
					device.Stream = streamPointer(stream)
				default:
					cableAbsenceUnconfirmed = true
				}
			}
		}
		if helloKnown && cableHelloMatchesConfig(hello, cfg.DeviceID) {
			observed := deviceFromHello(cableDeviceTarget, cfg.DeviceToken, hello)
			device.Paired = observed.Paired || hello.Capabilities.Auth == nil
			device.Board = observed.Board
			device.Firmware = observed.Firmware
			device.Capabilities = observed.Capabilities
			// Cable has the same read-only health contract as WiFi. Without it,
			// status cannot distinguish a live usage screen from the firmware's
			// "Theme missing" screen and incorrectly skips the existing theme
			// chooser. The shared Sender serializes this probe with frame writes.
			if reachable && hello.HasFeature(protocol.FeatureCableHealthV1) {
				if health, healthErr := s.readCableHealth(port, cfg.DeviceID); healthErr == nil {
					device.Connected = true
					device = s.withVerifiedDeviceHealth(device, health, cableDeviceTarget, cfg.DeviceToken, false)
				}
			}
		}
		if vanishedErr == nil {
			s.firmwareUpdateStartMu.Unlock()
		}
	} else if strings.TrimSpace(cfg.DeviceTarget) != "" {
		hello, probeToken, tokenRejected, err := s.getHelloProbeWithTokenFallback(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, discoveryProbeTime)
		if identity, ok := protocol.HelloIdentity(err); ok && strings.EqualFold(strings.TrimSpace(cfg.DeviceID), identity.DeviceID) {
			// Issue #526: the saved VibeTV answered, without capabilities. It
			// stays found and keeps the board and firmware the Updates tab
			// needs. Everything a complete hello decides below stays undecided,
			// as after a hello that failed.
			device.Board, device.Firmware = identity.Board, identity.Firmware
			s.rememberConfiguredDeviceSeen(cfg)
		}
		if err == nil {
			configuredID := strings.TrimSpace(cfg.DeviceID)
			observedID := strings.TrimSpace(hello.DeviceID)
			identityMismatch = configuredID != "" && observedID != "" &&
				!strings.EqualFold(configuredID, observedID)
			confirmationErr := s.confirmPendingWiFiTransition(
				r.Context(), cfg.DeviceTarget, cfg.DeviceToken, configuredID, hello,
			)
			transitionConfirmed := tokenRejected || confirmationErr == nil
			if !identityMismatch && !tokenRejected && confirmationErr == nil {
				if updated, committed, commitErr := s.commitConfirmedWiFiTransition(cfg, hello); commitErr != nil {
					transitionConfirmed = false
				} else if committed {
					cfg = updated
					configuredID = strings.TrimSpace(cfg.DeviceID)
				}
			}
			if !identityMismatch && transitionConfirmed {
				reachable = true
				device = withDisplayStreamInfo(deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello), stream)
				if transport := hello.Normalize().Capabilities.Transport; transport.Mode == "legacy-wifi-only" {
					s.probeLegacyWiFiCable(configuredID)
				} else {
					device.LegacyCableAnswered = legacyWiFiDeviceAnsweredCable(cfg.LegacyWiFiDeviceID, observedID, transport)
				}
				device.Active = configuredID != "" && strings.EqualFold(configuredID, observedID)
				device.Paired = savedPairingRemainsValid(
					cfg.DeviceToken,
					tokenRejected,
					stream.ErrorCode,
				)
				if tokenRejected {
					device.Paired = false
					stream.Healthy = false
					stream.ErrorCode = "pairing_token_rejected"
					stream.Detail = "VibeTV connection needs attention."
					device.Stream = streamPointer(stream)
				}
				readinessToken := pairingTokenForReadiness(
					cfg.DeviceToken,
					probeToken,
					device.Paired,
				)
				// /health is intentionally public and therefore only reports device
				// health. Only an explicit rejection invalidates a saved pairing; a
				// busy device may answer the public fallback after the authenticated
				// probe timed out.
				if health, healthErr := s.getHealthProbe(r.Context(), cfg.DeviceTarget, "", deviceHealthProbeTime); healthErr == nil {
					device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, readinessToken, false)
				} else {
					device = withDeviceHealthProbeError(device, healthErr)
				}
			}
		}
	}
	device = s.withConfiguredConnectionState(cfg, device, reachable, identityMismatch, cableAbsenceUnconfirmed)
	if cfg.ConnectionModeChoiceRequired && strings.TrimSpace(cfg.DeviceID) == "" {
		if candidate := s.currentCableConnectionChoiceDevice(); strings.TrimSpace(candidate.DeviceID) != "" {
			device = candidate
		}
	}
	var firmwareUpdate *firmwareUpdateJob
	if latest, ok := s.latestFirmwareUpdateJob(); ok {
		firmwareUpdate = &latest
	}
	var themeInstall *themeInstallJob
	if latest, ok := s.latestThemeInstallJob(); ok {
		themeInstall = &latest
	}
	writeJSON(w, http.StatusOK, statusResponse{
		OK:                           true,
		Companion:                    s.companionInfo(r.Context()),
		Device:                       device,
		ConnectionMode:               runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode),
		ConnectionModeChoiceRequired: cfg.ConnectionModeChoiceRequired,
		ProviderSetup:                s.providerSetupForStatus(),
		Setup:                        setupProgressForConfig(cfg),
		ThemeInstall:                 themeInstall,
		FirmwareUpdate:               firmwareUpdate,
		SystemBusy:                   s.currentSystemBusy(),
	})
}

func (s *Server) currentSystemBusy() *daemon.SystemBusy {
	if s.systemBusy == nil {
		return nil
	}
	return s.systemBusy()
}

func cableHelloMatchesConfig(hello protocol.DeviceHello, configuredDeviceID string) bool {
	hello = hello.Normalize()
	return strings.EqualFold(hello.DeviceID, strings.TrimSpace(configuredDeviceID)) &&
		strings.EqualFold(hello.Capabilities.Transport.Active, "usb") &&
		strings.EqualFold(hello.Capabilities.Transport.Mode, "cable")
}

func cableHelloCanConfigureWiFi(hello protocol.DeviceHello, configuredDeviceID string) bool {
	hello = hello.Normalize()
	return strings.EqualFold(hello.DeviceID, strings.TrimSpace(configuredDeviceID)) &&
		strings.EqualFold(hello.Capabilities.Transport.Active, "usb") &&
		(strings.EqualFold(hello.Capabilities.Transport.Mode, "cable") ||
			(strings.EqualFold(hello.Capabilities.Transport.Mode, "wifi") &&
				strings.EqualFold(hello.NetworkMode, "setup")))
}

func configuredStatusTarget(cfg runtimeconfig.Config) string {
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		return cableDeviceTarget
	}
	return cfg.DeviceTarget
}

func cableCapabilityBlock(supported []string) *protocol.CapabilityBlock {
	if len(supported) == 0 {
		return nil
	}
	return &protocol.CapabilityBlock{
		Transport: protocol.TransportCapabilities{
			Active:    "usb",
			Mode:      "cable",
			Supported: append([]string(nil), supported...),
		},
	}
}

func (s *Server) currentCableConnectionChoiceDevice() deviceInfo {
	return cableConnectionChoiceDevice(s.currentCableHello())
}

func (s *Server) refreshedCableConnectionChoiceDevice() deviceInfo {
	return cableConnectionChoiceDevice(s.refreshCableHello())
}

func cableConnectionChoiceDevice(hello protocol.DeviceHello, ok bool) deviceInfo {
	if !ok {
		return deviceInfo{Connected: false}
	}
	hello = hello.Normalize()
	if strings.TrimSpace(hello.DeviceID) == "" ||
		!strings.EqualFold(hello.Capabilities.Transport.Active, "usb") {
		return deviceInfo{Connected: false}
	}
	observed := deviceFromHello("", "", hello)
	return deviceInfo{
		DeviceID:     observed.DeviceID,
		Connected:    false,
		Active:       false,
		Board:        observed.Board,
		Firmware:     observed.Firmware,
		Capabilities: observed.Capabilities,
	}
}

func refreshDefaultCableHello() (protocol.DeviceHello, bool) {
	// An open, verified VibeTV answers for itself; "" keeps the full search.
	explicit, _ := usb.OpenVibeTVPort()
	port, err := usb.ResolveVibeTVControlPort(explicit, "")
	if err != nil {
		return protocol.DeviceHello{}, false
	}
	hello, err := usb.ReadDeviceHello(port)
	return hello, err == nil
}

// A VibeTV plugged in over USB restarts and does not answer the cable while it
// joins WiFi, so a new port set is asked a few times, spaced apart. A try in
// which no port could be opened asked nobody and reopened nothing, so it is
// spaced like the others but not counted (issue #529): the cable is asked once
// the other program lets go of the port. A port that never opens (no
// permission, a Bluetooth COM port) reports the same error, so those tries are
// capped too: five minutes cover a program that is busy with the port, and
// after that the port set is left alone until it changes.
const (
	legacyCableProbeAttempts     = 3
	legacyCableProbeBusyAttempts = 30
	legacyCableProbeRetryDelay   = 10 * time.Second
)

// probeLegacyWiFiCable asks newly connected serial ports whether one of them
// is this legacy WiFi VibeTV. Early VibeTVs have no USB data connection, so
// their firmware keeps WiFi updates until a request arrives over the USB
// cable. That request ends legacy mode on the device, and its next WiFi hello
// offers USB-C (issue #489). A port set is asked at most
// legacyCableProbeAttempts times, so neither this VibeTV nor another serial
// device is reopened on every poll.
func (s *Server) probeLegacyWiFiCable(deviceID string) {
	if s.listCablePorts == nil || s.resolveCablePort == nil {
		return
	}
	ports, err := s.listCablePorts()
	if err != nil {
		return
	}
	sort.Strings(ports)
	key := strings.Join(ports, "\n")
	due := func() bool {
		if key != s.legacyCableProbePorts {
			s.legacyCableProbePorts = key
			s.legacyCableProbeTries = 0
			s.legacyCableProbeBusy = 0
			s.legacyCableProbeAt = time.Time{}
		}
		return len(ports) > 0 && s.legacyCableProbeTries < legacyCableProbeAttempts &&
			s.legacyCableProbeBusy < legacyCableProbeBusyAttempts &&
			(s.legacyCableProbeAt.IsZero() || s.now().Sub(s.legacyCableProbeAt) >= legacyCableProbeRetryDelay)
	}
	s.legacyCableProbeMu.Lock()
	probe := due()
	s.legacyCableProbeMu.Unlock()
	if !probe {
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if _, running := s.activeFirmwareUpdateJob(); running || s.themeInstallInFlight() {
		return
	}
	s.legacyCableProbeMu.Lock()
	probe = due()
	if probe {
		s.legacyCableProbeTries++
		s.legacyCableProbeAt = s.now()
	}
	s.legacyCableProbeMu.Unlock()
	if !probe {
		return
	}
	if _, err := s.resolveCablePort("", deviceID); errcode.Of(err) == errcode.TransportSerialOpen {
		s.legacyCableProbeMu.Lock()
		if key == s.legacyCableProbePorts {
			s.legacyCableProbeTries--
			s.legacyCableProbeBusy++
		}
		s.legacyCableProbeMu.Unlock()
	}
}

// rememberLegacyWiFiDevice keeps the one fact the cable switch of issue #498
// needs: this WiFi VibeTV ran, or is being updated from, firmware from before
// cable-only updates. Legacy mode itself ends with the first request over the
// USB cable, whoever sends it, so the app cannot rely on having seen it.
func (s *Server) rememberLegacyWiFiDevice(deviceID string) {
	deviceID = strings.TrimSpace(deviceID)
	cfg, err := s.config()
	if err != nil || deviceID == "" || !strings.EqualFold(strings.TrimSpace(cfg.DeviceID), deviceID) ||
		strings.EqualFold(cfg.LegacyWiFiDeviceID, deviceID) {
		return
	}
	_, _ = s.updateConfig(func(current *runtimeconfig.Config) {
		current.LegacyWiFiDeviceID = deviceID
	})
}

// legacyWiFiDeviceAnsweredCable reports that the remembered legacy WiFi VibeTV
// left legacy mode, which only a request over the USB cable causes. A VibeTV
// without USB data never does, and one set up on current firmware was never
// remembered, so both stay on WiFi.
func legacyWiFiDeviceAnsweredCable(legacyDeviceID string, deviceID string, transport protocol.TransportCapabilities) bool {
	legacyDeviceID = strings.TrimSpace(legacyDeviceID)
	return legacyDeviceID != "" && strings.EqualFold(legacyDeviceID, strings.TrimSpace(deviceID)) &&
		transport.Mode == "wifi" && slices.Contains(transport.Supported, "usb") &&
		transport.CableOnlyUpdates != nil && *transport.CableOnlyUpdates
}

func savedPairingRemainsValid(savedToken string, tokenRejected bool, streamError string) bool {
	return strings.TrimSpace(savedToken) != "" &&
		!tokenRejected &&
		strings.TrimSpace(streamError) != "device_pairing_required"
}

func pairingTokenForReadiness(savedToken string, probeToken string, paired bool) string {
	if token := strings.TrimSpace(probeToken); token != "" {
		return token
	}
	if paired {
		return strings.TrimSpace(savedToken)
	}
	return ""
}

func (s *Server) withConfiguredConnectionState(
	cfg runtimeconfig.Config,
	device deviceInfo,
	reachable bool,
	identityMismatch bool,
	cableAbsenceUnconfirmed bool,
) deviceInfo {
	if samePublicTarget(device.Target, cableDeviceTarget) && device.Stream != nil {
		device = withDisplayStreamInfo(device, *device.Stream)
	}
	device.Active = strings.TrimSpace(cfg.DeviceID) != ""
	if !device.Active {
		device.ConnectionState = deviceConnectionSetup
		return device
	}

	now := s.currentTime()
	key := configuredDeviceKey(cfg)
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	if s.connectionStates == nil {
		s.connectionStates = make(map[string]*configuredDeviceConnection)
	}
	state := s.connectionStates[key]
	if state == nil {
		state = &configuredDeviceConnection{}
		s.connectionStates[key] = state
	}

	themeNotDrawn := state.themeStaysUndrawn(device.Display, now)

	// Connectivity must stay evidence based. A healthy display stream is real
	// evidence (the device acknowledged a frame inside the bounded ready-age
	// window). A provider-setup stream entry alone is not: it only proves the
	// device was reachable when the log line was written, which can be minutes
	// ago on a powered-off device. Require a live /hello probe for that case.
	healthyStream := !identityMismatch && device.Paired && displayStreamHealthyForTarget(device.Stream, device.Target)
	streamConnected := healthyStream || (reachable && !identityMismatch && device.Paired && providerSetupStreamForTarget(device.Stream, device.Target))
	if streamConnected {
		device.Connected = true
	}
	// A successful health probe owns display readiness. In particular, a
	// healthy Cable stream can deliver a frame while the firmware is still
	// showing "Theme missing"; do not overwrite that explicit health result.
	if healthyStream && device.Health == nil {
		device.Ready = true
	}
	if reachable || streamConnected {
		state.lastSeenAt = now
	}
	// Anti-flap grace: a device that was just seen must not flip the customer
	// to a disconnected/setup experience because one probe missed (the
	// single-threaded ESP8266 drops connections while rendering). Within the
	// bounded grace window the device stays Connected in state "reconnecting";
	// past the window the honest truth wins and Connected drops.
	// A missing USB device is explicit disconnect evidence, not a WiFi probe miss.
	cableNotFound := !reachable && !cableAbsenceUnconfirmed && samePublicTarget(device.Target, cableDeviceTarget) &&
		device.Stream != nil && device.Stream.ErrorCode == "device_not_found"
	if !device.Connected && !identityMismatch && !cableNotFound && device.Paired &&
		!state.lastSeenAt.IsZero() && now.Sub(state.lastSeenAt) <= deviceConnectedGraceWindow {
		device.Connected = true
	}
	if device.Ready {
		device.ConnectionState = deviceConnectionReady
		device.LastSeenAt = now.UTC().Format(time.RFC3339Nano)
		return device
	}
	if !state.lastSeenAt.IsZero() {
		device.LastSeenAt = state.lastSeenAt.UTC().Format(time.RFC3339Nano)
	}
	// Missing AI usage is not a connection problem. Reporting "reconnecting"
	// here sends the customer after a link that is already up. This needs the
	// live probe in streamConnected, not device.Connected: the anti-flap grace
	// window above keeps an unreachable device Connected, and that one really
	// is reconnecting.
	if streamConnected || (reachable && device.Paired) {
		if device.Display != nil && device.Display.ThemeSpec != nil {
			spec := device.Display.ThemeSpec
			if !spec.Active {
				device.ConnectionState = deviceConnectionSetup
				return device
			}
			if themeNotDrawn &&
				(device.Stream == nil || device.Stream.ErrorCode != "provider_setup_required") {
				device.ConnectionState = deviceConnectionRenderFailed
				return device
			}
		}
		device.ConnectionState = deviceConnectionNoProvider
		return device
	}
	device.ConnectionState = deviceConnectionRetrying
	return device
}

// A reachable, paired device whose only missing piece is AI usage is not
// reconnecting. Naming that separately keeps the connection story honest.
const deviceConnectionNoProvider = "provider_setup_required"

// Issue #498: a reachable, paired device that cannot draw its active theme has
// a theme problem. Calling it "provider setup required" sent the customer to
// the AI provider and the firmware.
const deviceConnectionRenderFailed = "display_render_failed"

// themeNotDrawnConfirmTime is how far apart two health readings must be to
// count as two. Status is polled every 5 s and a health answer is reused for
// deviceProbeCacheTime, so the app's next poll confirms a reading and a second
// reader of the same answer does not.
const themeNotDrawnConfirmTime = 3 * time.Second

// themeNotDrawnForgetTime is how far apart two health readings may be and
// still be "in a row": three status polls, so one or two missed health answers
// of a busy VibeTV do not start the count over.
const themeNotDrawnForgetTime = 15 * time.Second

// themeStaysUndrawn reports a theme that themeCannotBeDrawn named on two
// health readings in a row, for the same theme path and render error (issue
// #530). One reading can be a single failed buffer allocation that the next
// animation tick repairs, and the firmware's failure counters only ever grow.
// A reading that can be drawn, another theme path or another render error
// starts over; another VibeTV has its own state. No reading changes nothing.
func (c *configuredDeviceConnection) themeStaysUndrawn(display *deviceDisplayInfo, now time.Time) bool {
	if display == nil || display.ThemeSpec == nil {
		return false
	}
	spec := display.ThemeSpec
	if !themeCannotBeDrawn(spec) {
		c.themeNotDrawn = ""
		return false
	}
	// A reading remembered from before the VibeTV was away for a while says
	// nothing about now, so it does not confirm the first reading after that.
	if reading := spec.Path + "\n" + spec.RenderError; c.themeNotDrawn != reading ||
		now.Sub(c.themeNotDrawnLastAt) > themeNotDrawnForgetTime {
		c.themeNotDrawn, c.themeNotDrawnAt = reading, now
	}
	c.themeNotDrawnLastAt = now
	return now.Sub(c.themeNotDrawnAt) >= themeNotDrawnConfirmTime
}

// wifiSignalWeakDBm is the signal strength at or below which a VibeTV on WiFi
// is too far from its router for reliable updates (issue #265). It is a
// conservative first value and has not been validated against real
// weak-signal conditions yet, which the issue asks for.
const wifiSignalWeakDBm = -80

// wifiSignalWeakEnvVar replaces wifiSignalWeakDBm on the bench, where the
// VibeTV sits next to its router.
const wifiSignalWeakEnvVar = "CODEXBAR_DISPLAY_WIFI_WEAK_SIGNAL_DBM"

// A signal that was named weak keeps the name until it is wifiSignalRecoverDB
// above the threshold, or it would flip with every reading around it. A run of
// low readings is forgotten after wifiSignalRunForget without one: readings
// that go missing are what a weak signal looks like, so a few missed polls
// must not end it.
const (
	wifiSignalRecoverDB = 3
	wifiSignalRunForget = 5 * time.Minute
)

// wifiSignalState reports a signal at or below the threshold on two health
// readings in a row, the second at least themeNotDrawnConfirmTime after the
// first. One low reading can be a passing dip, a better reading ends the run,
// and another VibeTV starts it over. The threshold is always negative, so
// firmware that reports no signal strength, which leaves 0, is never weak.
func (s *Server) wifiSignalState(target string, rssi int) (weak, recovered bool) {
	threshold := wifiSignalWeakDBm
	if dbm, err := strconv.Atoi(strings.TrimSpace(os.Getenv(wifiSignalWeakEnvVar))); err == nil && dbm < 0 {
		threshold = dbm
	}
	now := s.currentTime()
	target = normalizeTarget(target)
	s.weakWiFiMu.Lock()
	defer s.weakWiFiMu.Unlock()
	sameRun := s.weakWiFi.target == target && now.Sub(s.weakWiFi.last) <= wifiSignalRunForget
	if sameRun && s.weakWiFi.named {
		threshold += wifiSignalRecoverDB
	}
	if rssi > threshold {
		s.weakWiFi = weakWiFiRun{}
		return false, rssi < 0
	}
	if !sameRun {
		s.weakWiFi = weakWiFiRun{target: target, since: now}
	}
	s.weakWiFi.last = now
	s.weakWiFi.named = now.Sub(s.weakWiFi.since) >= themeNotDrawnConfirmTime
	return s.weakWiFi.named, false
}

// renderOk=false also covers states the firmware leaves on its own, and one
// health reading has to tell them apart.
//   - "low_heap" ("low_heap_full_render" on older firmware): a full redraw
//     found no heap and retries after 750 ms. One
//     reading cannot tell a single miss from a theme that never fits, so it is
//     not named here and stays "waiting for an image".
//   - "parse_fail": also what a valid theme reports while its scene found no
//     heap; the firmware retries the full render. An invalid spec is refused
//     at activation and in the frame (#66), so this reading is the retry.
//   - "low_heap_cba_buffer": the animation found no frame buffer. The error
//     stays up until a whole clean pass has been drawn, which takes seconds
//     after one tight moment. While the VibeTV holds a frame buffer it is
//     drawing again; a theme that never fits (#498) never gets one.
//
// Everything else is a spec or an asset the VibeTV cannot use.
func themeCannotBeDrawn(spec *themeSpecHealth) bool {
	if spec.RenderOK == nil || *spec.RenderOK {
		return false
	}
	switch spec.RenderError {
	case "low_heap", "low_heap_full_render", "parse_fail":
		return false
	case "low_heap_cba_buffer":
		return spec.cbaBufferBytes == 0
	}
	return true
}

// rememberConfiguredDeviceSeen keeps the saved VibeTV inside the anti-flap
// grace window of withConfiguredConnectionState without calling it reachable.
func (s *Server) rememberConfiguredDeviceSeen(cfg runtimeconfig.Config) {
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	if s.connectionStates == nil {
		s.connectionStates = make(map[string]*configuredDeviceConnection)
	}
	key := configuredDeviceKey(cfg)
	if s.connectionStates[key] == nil {
		s.connectionStates[key] = &configuredDeviceConnection{}
	}
	s.connectionStates[key].lastSeenAt = s.currentTime()
}

func configuredDeviceKey(cfg runtimeconfig.Config) string {
	if id := strings.ToLower(strings.TrimSpace(cfg.DeviceID)); id != "" {
		return "id:" + id
	}
	return "target:" + strings.ToLower(publicTarget(cfg.DeviceTarget))
}
