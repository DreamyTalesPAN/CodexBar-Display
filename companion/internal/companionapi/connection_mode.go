package companionapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/timeline"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

func (s *Server) handleSetupReset(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish before setting up another VibeTV.") {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	if s.pauseDisplayStream != nil {
		s.pauseDisplayStream(true)
		defer s.pauseDisplayStream(false)
	}
	var savedTransports []string
	_, err := s.updateConfig(func(cfg *runtimeconfig.Config) {
		savedTransports = append([]string(nil), cfg.DeviceTransports...)
		cfg.ResetDeviceBinding()
		cfg.SetProviderSelectionSetupComplete(false)
		// Setting up again asks for the display choice again, so the old one is
		// not carried over. Keeping it sent the customer back into the wizard
		// with a selection made for the setup they just discarded: a provider
		// switched on during the new run is not in it, and completion is then
		// refused with provider_display_incomplete on a step that offers no way
		// to change the selection.
		cfg.ProviderDisplay = nil
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if s.resetCableSender != nil {
		s.resetCableSender()
	}
	device := s.refreshedCableConnectionChoiceDevice()
	if device.Capabilities == nil && len(savedTransports) > 0 {
		device.Capabilities = &protocol.CapabilityBlock{
			Transport: protocol.TransportCapabilities{Supported: savedTransports},
		}
	}
	s.clearDisplayVerification("")
	s.clearConfiguredDeviceState()
	s.setupEvents.reset(s.currentTime())
	s.recordTimeline(timeline.Event{Component: "setup_reset", State: "started"})
	writeJSON(w, http.StatusOK, statusResponse{
		OK:                           true,
		Companion:                    s.companionInfo(r.Context()),
		Device:                       device,
		ConnectionModeChoiceRequired: true,
		Setup:                        setupProgress{ProviderSelectionRequired: true},
	})
}

// handleDeviceFactoryReset erases the Cable VibeTV: WiFi details, pairing
// token, settings and themes. It only runs over the USB cable, so nobody on
// the WiFi network can wipe or take over the device.
func (s *Server) handleDeviceFactoryReset(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish, then try again.") {
		return
	}
	defer s.holdDeviceForMaintenance()()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" || strings.TrimSpace(cfg.DeviceID) == "" {
		writeError(w, http.StatusConflict, "factory_reset_cable_required", "VibeTV can only be erased over the USB cable.", "Connect VibeTV to this Mac with the USB cable, switch to USB-C in Settings, then try again.")
		return
	}
	port, hello, ok := s.requireCableControlDevice(w, cfg)
	if !ok {
		return
	}
	if err := s.factoryResetCable(port, hello.DeviceID); err != nil {
		writeError(w, http.StatusBadGateway, "factory_reset_failed", "VibeTV could not be erased.", "Keep VibeTV connected by the USB cable, then try again.")
		return
	}
	// The device no longer knows its pairing token, so the Mac forgets the
	// whole binding now, like "Run setup again", instead of relying on a
	// second request from the app that may never arrive.
	if _, err := s.updateConfig(func(current *runtimeconfig.Config) {
		current.ResetDeviceBinding()
		current.SetProviderSelectionSetupComplete(false)
		current.ProviderDisplay = nil
		known := current.KnownDevices[:0]
		for _, device := range current.KnownDevices {
			if !strings.EqualFold(device.DeviceID, hello.DeviceID) {
				known = append(known, device)
			}
		}
		current.KnownDevices = known
	}); err != nil {
		writeInternalError(w, err)
		return
	}
	if s.resetCableSender != nil {
		s.resetCableSender()
	}
	s.clearDisplayVerification("")
	s.clearConfiguredDeviceState()
	writeJSON(w, http.StatusOK, struct {
		OK bool `json:"ok"`
	}{OK: true})
}

func (s *Server) handleSetupConnectionMode(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Mode     string `json:"mode"`
		DeviceID string `json:"deviceId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	mode := runtimeconfig.NormalizeConnectionMode(req.Mode)
	requestedDeviceID := strings.TrimSpace(req.DeviceID)
	if mode == "" {
		writeError(w, http.StatusBadRequest, "connection_mode_invalid", "Choose Cable or WiFi.", "Choose how this VibeTV should connect, then try again.")
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish, then choose the connection again.") {
		return
	}
	if device := s.selectConnectionMode(w, r, mode, requestedDeviceID); device != nil {
		writeJSON(w, http.StatusOK, struct {
			OK             bool       `json:"ok"`
			ConnectionMode string     `json:"connectionMode"`
			Status         string     `json:"status"`
			Device         deviceInfo `json:"device"`
		}{OK: true, ConnectionMode: "cable", Status: "selected", Device: *device})
	}
}

// selectConnectionMode is the one switch between Cable and WiFi. The caller
// holds firmwareUpdateStartMu. It writes every response itself except the one
// for a selected Cable, whose device it returns.
func (s *Server) selectConnectionMode(w http.ResponseWriter, r *http.Request, mode, requestedDeviceID string) (cable *deviceInfo) {
	defer s.holdDeviceForMaintenance()()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if cfg.LegacyWiFiDeviceID != "" {
		// Any connection choice settles the one automatic switch to Cable.
		if cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
			current.LegacyWiFiDeviceID = ""
		}); err != nil {
			writeInternalError(w, err)
			return
		}
	}
	freshWiFiChoice := mode == "wifi" && strings.TrimSpace(cfg.DeviceID) == "" &&
		(cfg.ConnectionModeChoiceRequired || runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "")
	cableConnected := false
	var cablePort string
	if freshWiFiChoice {
		cablePort, err = s.resolveCablePort("", requestedDeviceID)
		cableConnected = err == nil
		if err != nil && (requestedDeviceID != "" || errcode.Of(err) == errcode.TransportMultipleDevices) {
			writeCableResolutionError(w, err)
			return
		}
	}
	if freshWiFiChoice && !cableConnected {
		knownDevice, hello, found, authErr := s.authenticatedKnownWiFiDevice(r.Context(), cfg)
		if authErr != nil {
			writeError(w, http.StatusConflict, "multiple_devices_found", "Multiple known VibeTV devices are available on WiFi.", "Connect the VibeTV you want with a data Cable, then choose WiFi again.")
			return
		}
		if found {
			if err := s.confirmPendingWiFiTransition(r.Context(), knownDevice.Target, knownDevice.DeviceToken, knownDevice.DeviceID, hello); err != nil {
				writeError(w, http.StatusBadGateway, "connection_mode_confirmation_failed", "VibeTV could not confirm its WiFi connection.", "Connect VibeTV with a data Cable, then choose WiFi again.")
				return
			}
			supportedTransports := append([]string(nil), hello.Capabilities.Transport.Supported...)
			cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
				current.SetActiveDevice(knownDevice)
				current.ConnectionMode = "wifi"
				if len(supportedTransports) > 0 {
					current.DeviceTransports = supportedTransports
				}
			})
			if err != nil {
				writeInternalError(w, err)
				return
			}
			s.clearConfiguredDeviceState()
			s.clearAmbiguousDeviceSelection()
			if s.wakeDisplayStream != nil {
				s.wakeDisplayStream()
			}
			device := s.withDisplayStream(r.Context(), knownDevice.Target, deviceFromHello(knownDevice.Target, knownDevice.DeviceToken, hello))
			device.Active = true
			writeJSON(w, http.StatusOK, struct {
				OK             bool       `json:"ok"`
				ConnectionMode string     `json:"connectionMode"`
				Status         string     `json:"status"`
				Device         deviceInfo `json:"device"`
			}{OK: true, ConnectionMode: "wifi", Status: "selected", Device: device})
			return
		}
		_, err = s.updateConfig(func(current *runtimeconfig.Config) {
			current.ConnectionMode = "wifi"
			current.CableAutoBindDisabled = true
			current.ConnectionModeChoiceRequired = false
			current.DeviceTarget = ""
			current.DeviceToken = ""
			current.DeviceID = ""
			current.DeviceTransports = nil
		})
		if err != nil {
			writeInternalError(w, err)
			return
		}
		s.clearConfiguredDeviceState()
		s.clearAmbiguousDeviceSelection()
		writeJSON(w, http.StatusAccepted, struct {
			OK             bool   `json:"ok"`
			ConnectionMode string `json:"connectionMode"`
			Status         string `json:"status"`
		}{OK: true, ConnectionMode: "wifi", Status: "waiting_for_wifi"})
		return
	}
	// Cable chosen while the WiFi switch this Mac just sent may still be
	// restarting VibeTV (#481) is the same move back from WiFi.
	wifiSwitchPending := mode == "cable" && cfg.WiFiTransitionPending() &&
		s.currentTime().Sub(time.Unix(cfg.WiFiTransitionStartedAt, 0)) < cableTransitionWait
	// Another VibeTV picked on the cable is a new selection, not the saved
	// WiFi VibeTV moving to its cable; looking for the saved one there fails.
	savedDeviceRequested := requestedDeviceID == "" || strings.EqualFold(requestedDeviceID, strings.TrimSpace(cfg.DeviceID))
	transitioningFromWiFi := savedDeviceRequested && (wifiSwitchPending || (mode == "cable" &&
		runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "wifi" &&
		strings.TrimSpace(cfg.DeviceTarget) != "" && strings.TrimSpace(cfg.DeviceID) != ""))
	var port string
	var hello protocol.DeviceHello
	cableHelloReady := false
	if transitioningFromWiFi {
		expectedDeviceID := strings.TrimSpace(cfg.DeviceID)
		if wifiSwitchPending {
			// Let the restart finish; the checks below report what is left.
			_, _, _ = s.waitForCableHello(r.Context(), expectedDeviceID, false)
		}
		port, err = s.resolveCablePort("", expectedDeviceID)
		if err == nil {
			hello, err = s.readCableHello(port)
			hello = hello.Normalize()
			if err != nil || !strings.EqualFold(strings.TrimSpace(hello.DeviceID), expectedDeviceID) {
				writeError(w, http.StatusBadGateway, "cable_identity_unavailable", "The selected Cable VibeTV did not provide its current identity.", "Reconnect the Cable, wait for VibeTV to start, then try again.")
				return
			}
			if !supportsTransport(hello, "usb") {
				writeError(w, http.StatusConflict, "connection_mode_unsupported", "This VibeTV does not support Cable mode.", "Keep this VibeTV connected through WiFi.")
				return
			}
			if runtimeconfig.NormalizeConnectionMode(hello.Capabilities.Transport.Mode) != "cable" {
				if err := s.setCableConnectionMode(port, hello.DeviceID, "cable"); err != nil {
					writeError(w, http.StatusBadGateway, "connection_mode_switch_failed", "VibeTV could not change its connection.", "Keep VibeTV connected by Cable, then try again.")
					return
				}
				port, hello, err = s.waitForCableHello(r.Context(), expectedDeviceID, true)
				if err != nil {
					writeError(w, http.StatusBadGateway, "connection_mode_switch_failed", "VibeTV could not finish changing its connection.", "Keep VibeTV connected by Cable, then try again.")
					return
				}
			}
			cableHelloReady = true
		} else {
			// Firmware capabilities describe its protocol, not whether this
			// physical board has a working USB data path. Keep WiFi running
			// until this exact device has actually answered over the cable.
			writeCableResolutionError(w, err)
			return
		}
	}
	if !cableHelloReady {
		port = cablePort
		selectionDeviceID := strings.TrimSpace(cfg.DeviceID)
		if requestedDeviceID != "" {
			selectionDeviceID = requestedDeviceID
		}
		if port == "" || requestedDeviceID != "" {
			port, err = s.resolveCablePort("", selectionDeviceID)
		}
		if err != nil {
			writeCableResolutionError(w, err)
			return
		}
		hello, err = s.readCableHello(port)
		if err != nil || strings.TrimSpace(hello.DeviceID) == "" {
			writeError(w, http.StatusBadGateway, "cable_identity_unavailable", "The connected Cable VibeTV did not provide its identity.", "Reconnect the Cable, wait for VibeTV to start, then try again.")
			return
		}
		hello = hello.Normalize()
	}
	if mode == "cable" && hello.Capabilities.Transport.TransitionPending &&
		strings.EqualFold(hello.Capabilities.Transport.TransitionTo, "cable") {
		if err := s.confirmCableMode(port, hello.DeviceID); err != nil {
			writeError(w, http.StatusBadGateway, "connection_mode_confirmation_failed", "VibeTV could not confirm its Cable connection.", "Keep VibeTV connected by Cable and try again before it returns to WiFi.")
			return
		}
		hello.Capabilities.Transport.TransitionPending = false
		hello.Capabilities.Transport.TransitionFrom = ""
		hello.Capabilities.Transport.TransitionTo = ""
	}
	supportedTransports := append([]string(nil), hello.Capabilities.Transport.Supported...)
	expectedDeviceID := strings.TrimSpace(cfg.DeviceID)
	if requestedDeviceID != "" {
		expectedDeviceID = requestedDeviceID
	}
	if expected := expectedDeviceID; expected != "" && !strings.EqualFold(expected, hello.DeviceID) {
		writeError(w, http.StatusConflict, "device_identity_changed", "A different VibeTV answered on Cable.", "Connect the VibeTV you selected, then try again.")
		return
	}
	if mode == "wifi" && !supportsTransport(hello, "wifi") {
		writeError(w, http.StatusConflict, "connection_mode_unsupported", "This VibeTV does not support WiFi.", "Keep this VibeTV connected by Cable.")
		return
	}
	if mode == "cable" && !supportsTransport(hello, "usb") {
		writeError(w, http.StatusConflict, "connection_mode_unsupported", "This VibeTV does not support Cable mode.", "Choose WiFi for this VibeTV.")
		return
	}
	deviceMode := strings.TrimSpace(strings.ToLower(hello.Capabilities.Transport.Mode))
	modeAlreadySelected := runtimeconfig.NormalizeConnectionMode(deviceMode) == mode ||
		(deviceMode == "legacy-wifi-only" && mode == "wifi")
	knownDevice, known := cfg.KnownDevice(hello.DeviceID)
	cableToken := strings.TrimSpace(cfg.DeviceToken)
	if saved := strings.TrimSpace(cfg.DeviceID); saved != "" && !strings.EqualFold(saved, hello.DeviceID) {
		// The saved token belongs to the saved VibeTV, not to this one.
		cableToken = ""
	}
	if known && strings.TrimSpace(knownDevice.DeviceToken) != "" {
		cableToken = strings.TrimSpace(knownDevice.DeviceToken)
	}
	pairingRequired := hello.Capabilities.Auth != nil
	if pairingRequired {
		cableToken, err = s.pairCableDevice(port, hello.DeviceID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "cable_pairing_failed", "VibeTV could not pair through Cable.", "Keep VibeTV connected by Cable, then try again.")
			return
		}
	}
	wifiCredentialsRequired := (deviceMode == "wifi" && strings.EqualFold(strings.TrimSpace(hello.NetworkMode), "setup")) ||
		(!modeAlreadySelected && (!known || strings.TrimSpace(knownDevice.Target) == ""))
	if mode == "wifi" && wifiCredentialsRequired {
		if _, err := s.updateConfig(func(current *runtimeconfig.Config) {
			current.SetActiveDevice(runtimeconfig.KnownDevice{
				DeviceID:    hello.DeviceID,
				DeviceToken: cableToken,
			})
			current.ConnectionMode = "cable"
			current.DeviceTransports = supportedTransports
		}); err != nil {
			writeInternalError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			OK             bool       `json:"ok"`
			ConnectionMode string     `json:"connectionMode"`
			Status         string     `json:"status"`
			Device         deviceInfo `json:"device"`
		}{
			OK:             true,
			ConnectionMode: "wifi",
			Status:         "wifi_credentials_required",
			Device: deviceInfo{
				Target:       cableDeviceTarget,
				DeviceID:     hello.DeviceID,
				Active:       true,
				Paired:       true,
				Capabilities: &hello.Capabilities,
			},
		})
		return
	}
	if mode == "wifi" {
		if _, err := s.updateConfig(func(current *runtimeconfig.Config) {
			target := ""
			if known {
				target = knownDevice.Target
			} else if strings.EqualFold(current.DeviceID, hello.DeviceID) {
				target = current.DeviceTarget
			}
			current.SetActiveDevice(runtimeconfig.KnownDevice{
				DeviceID: hello.DeviceID, Target: target, DeviceToken: cableToken,
			})
			current.ConnectionMode = ""
			current.WiFiTransitionStartedAt = time.Now().Unix()
			current.CableAutoBindDisabled = true
			current.ConnectionModeChoiceRequired = false
			current.DeviceTransports = supportedTransports
		}); err != nil {
			writeInternalError(w, err)
			return
		}
	}
	// Journal WiFi intent before the command that can reboot the USB device.
	if !modeAlreadySelected {
		if err := s.setCableConnectionMode(port, hello.DeviceID, mode); err != nil {
			if mode == "wifi" {
				if restoreErr := s.restoreRejectedWiFiIntent(cfg, err); restoreErr != nil {
					writeInternalError(w, restoreErr)
					return
				}
			}
			writeError(w, http.StatusBadGateway, "connection_mode_switch_failed", "VibeTV could not change its connection.", "Keep VibeTV connected by Cable, then try again.")
			return
		}
	}
	if mode == "wifi" {
		writeJSON(w, http.StatusAccepted, struct {
			OK             bool       `json:"ok"`
			ConnectionMode string     `json:"connectionMode"`
			Status         string     `json:"status"`
			Device         deviceInfo `json:"device"`
		}{
			OK:             true,
			ConnectionMode: "wifi",
			Status:         "waiting_for_wifi",
			Device: deviceInfo{
				Target:   cableDeviceTarget,
				DeviceID: hello.DeviceID,
				Active:   true,
				Paired:   true,
			},
		})
		return
	}

	cfg, err = s.saveCableSelection(hello, cableToken)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	device := s.cableDeviceInfo(r.Context(), cfg, hello)
	device.Paired = !pairingRequired || cableToken != ""
	return &device
}

// saveCableSelection commits a proven Cable connection without losing its
// known WiFi address. Callers hold deviceMaintenanceMu.
func (s *Server) saveCableSelection(hello protocol.DeviceHello, token string) (runtimeconfig.Config, error) {
	cfg, err := s.updateConfig(func(current *runtimeconfig.Config) {
		identityChanged := !strings.EqualFold(current.DeviceID, hello.DeviceID)
		target := current.DeviceTarget
		if known, ok := current.KnownDevice(hello.DeviceID); ok {
			target = known.Target
		} else if identityChanged {
			target = ""
		}
		current.SetActiveDevice(runtimeconfig.KnownDevice{
			DeviceID:    hello.DeviceID,
			Target:      target,
			DeviceToken: token,
		})
		current.ConnectionMode = "cable"
		current.DeviceTransports = append([]string(nil), hello.Capabilities.Transport.Supported...)
	})
	if err != nil {
		return cfg, err
	}
	s.clearConfiguredDeviceState()
	if s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
	return cfg, nil
}

// waitForCableHello waits up to cableTransitionWait for the expected VibeTV to
// answer on the cable, and with requireCableMode until it reports Cable mode.
func (s *Server) waitForCableHello(
	ctx context.Context,
	expectedDeviceID string,
	requireCableMode bool,
) (string, protocol.DeviceHello, error) {
	deadline := time.Now().Add(cableTransitionWait)
	var lastErr error
	for {
		port, err := s.resolveCablePort("", expectedDeviceID)
		if errcode.Of(err) == errcode.TransportMultipleDevices {
			return "", protocol.DeviceHello{}, err
		}
		if err == nil {
			hello, helloErr := s.readCableHello(port)
			hello = hello.Normalize()
			if helloErr == nil {
				if !strings.EqualFold(strings.TrimSpace(hello.DeviceID), strings.TrimSpace(expectedDeviceID)) {
					return "", protocol.DeviceHello{}, errDeviceIdentityChanged
				}
				if !requireCableMode || runtimeconfig.NormalizeConnectionMode(hello.Capabilities.Transport.Mode) == "cable" {
					return port, hello, nil
				}
				lastErr = errors.New("VibeTV is still changing to Cable mode")
			} else {
				lastErr = helloErr
			}
		} else {
			lastErr = err
		}
		if !time.Now().Before(deadline) {
			if lastErr == nil {
				lastErr = errors.New("cable mode is not ready")
			}
			return "", protocol.DeviceHello{}, lastErr
		}
		select {
		case <-ctx.Done():
			return "", protocol.DeviceHello{}, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *Server) handleSetupWiFi(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		SSID     string `json:"ssid"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.SSID = strings.TrimSpace(req.SSID)
	if req.SSID == "" {
		writeError(w, http.StatusBadRequest, "wifi_name_required", "Enter your WiFi name.", "Enter the WiFi name exactly as it appears on your other devices.")
		return
	}
	if len(req.SSID) >= 33 || len(req.Password) >= 65 {
		writeError(w, http.StatusBadRequest, "wifi_credentials_too_long", "The WiFi name or password is too long.", "Check the WiFi details and try again.")
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish, then try again.") {
		return
	}

	defer s.holdDeviceForMaintenance()()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if (runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" && !cfg.WiFiTransitionPending()) || strings.TrimSpace(cfg.DeviceID) == "" {
		writeError(w, http.StatusConflict, "cable_setup_required", "VibeTV is not ready to receive WiFi details by Cable.", "Choose Cable first, then choose WiFi again.")
		return
	}
	port, hello, ok := s.requireCableWiFiSetupDevice(w, cfg)
	if !ok {
		return
	}
	if !supportsTransport(hello, "wifi") {
		writeError(w, http.StatusConflict, "connection_mode_unsupported", "This VibeTV does not support WiFi.", "Keep this VibeTV connected by Cable.")
		return
	}
	supportedTransports := append([]string(nil), hello.Capabilities.Transport.Supported...)
	knownDevice, known := cfg.KnownDevice(hello.DeviceID)
	if _, err := s.updateConfig(func(current *runtimeconfig.Config) {
		current.ConnectionMode = ""
		current.WiFiTransitionStartedAt = time.Now().Unix()
		current.DeviceID = strings.TrimSpace(hello.DeviceID)
		current.CableAutoBindDisabled = true
		current.ConnectionModeChoiceRequired = false
		current.DeviceTransports = supportedTransports
		if known {
			current.DeviceTarget = knownDevice.Target
			current.DeviceToken = knownDevice.DeviceToken
		}
	}); err != nil {
		writeInternalError(w, err)
		return
	}
	// The reboot can lose its acknowledgement after accepting the credentials.
	// Keep the persisted intent so discovery and bounded Cable recovery continue.
	if err := s.configureCableWiFi(port, hello.DeviceID, req.SSID, req.Password); err != nil {
		if restoreErr := s.restoreRejectedWiFiIntent(cfg, err); restoreErr != nil {
			writeInternalError(w, restoreErr)
			return
		}
		writeError(w, http.StatusBadGateway, "wifi_configuration_failed", "VibeTV could not save these WiFi details.", "Check the WiFi name and password, keep the Cable connected, then try again.")
		return
	}
	writeJSON(w, http.StatusAccepted, struct {
		OK             bool       `json:"ok"`
		ConnectionMode string     `json:"connectionMode"`
		Status         string     `json:"status"`
		Device         deviceInfo `json:"device"`
	}{
		OK:             true,
		ConnectionMode: "wifi",
		Status:         "waiting_for_wifi",
		Device: deviceInfo{
			Target:       cableDeviceTarget,
			DeviceID:     hello.DeviceID,
			Active:       true,
			Paired:       true,
			Capabilities: &hello.Capabilities,
		},
	})
}

func (s *Server) restoreRejectedWiFiIntent(previous runtimeconfig.Config, commandErr error) error {
	if !errors.Is(commandErr, usb.ErrConnectionChangeNotAccepted) {
		return nil
	}
	_, err := s.updateConfig(func(current *runtimeconfig.Config) {
		current.ConnectionMode = previous.ConnectionMode
		current.WiFiTransitionStartedAt = previous.WiFiTransitionStartedAt
		current.CableAutoBindDisabled = previous.CableAutoBindDisabled
		current.ConnectionModeChoiceRequired = previous.ConnectionModeChoiceRequired
		current.DeviceID = previous.DeviceID
		current.DeviceTarget = previous.DeviceTarget
		current.DeviceToken = previous.DeviceToken
		current.DeviceTransports = previous.DeviceTransports
		// Pairing may have refreshed the token before the rejected command.
		if known, ok := current.KnownDevice(previous.DeviceID); ok && known.DeviceToken != "" {
			current.DeviceToken = known.DeviceToken
		}
	})
	return err
}

func (s *Server) handleSetupWiFiNetworks(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if s.rejectBusyDevice(w, "Wait for the update to finish, then scan again.") {
		return
	}
	defer s.holdDeviceForMaintenance()()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if (runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) != "cable" && !cfg.WiFiTransitionPending()) || strings.TrimSpace(cfg.DeviceID) == "" {
		writeError(w, http.StatusConflict, "cable_setup_required", "VibeTV is not connected by Cable.", "Connect VibeTV by Cable before scanning WiFi networks in the app.")
		return
	}
	port, hello, ok := s.requireCableWiFiSetupDevice(w, cfg)
	if !ok {
		return
	}
	if s.scanCableWiFi == nil {
		writeError(w, http.StatusNotImplemented, "wifi_scan_unsupported", "This Mac App cannot scan WiFi networks through VibeTV.", "Enter the WiFi name manually.")
		return
	}
	networks, err := s.scanCableWiFi(port, hello.DeviceID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "wifi_scan_failed", "VibeTV could not scan WiFi networks.", "Scan again or enter the WiFi name manually.")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK       bool                   `json:"ok"`
		Networks []protocol.WiFiNetwork `json:"networks"`
	}{OK: true, Networks: networks})
}

func (s *Server) authenticatedKnownWiFiDevice(
	ctx context.Context,
	cfg runtimeconfig.Config,
) (runtimeconfig.KnownDevice, protocol.DeviceHello, bool, error) {
	var matched runtimeconfig.KnownDevice
	var matchedHello protocol.DeviceHello
	matchedTargets := []string{}
	for _, known := range cfg.KnownDevices {
		known.DeviceID = strings.TrimSpace(known.DeviceID)
		known.Target = normalizeTarget(known.Target)
		known.DeviceToken = strings.TrimSpace(known.DeviceToken)
		if known.DeviceID == "" || known.Target == "" || known.DeviceToken == "" {
			continue
		}
		hello, err := s.getHelloProbe(ctx, known.Target, known.DeviceToken, subnetProbeTime)
		if err != nil {
			continue
		}
		hello = hello.Normalize()
		transport := hello.Capabilities.Transport
		wifiActive := transport.Active == "wifi" || transport.Mode == "wifi" ||
			transport.Mode == "legacy-wifi-only" || strings.EqualFold(hello.NetworkMode, "station")
		if !wifiActive || !strings.EqualFold(known.DeviceID, hello.DeviceID) {
			continue
		}
		matchedTargets = append(matchedTargets, known.Target)
		matched = known
		matchedHello = hello
	}
	if len(matchedTargets) > 1 {
		return runtimeconfig.KnownDevice{}, protocol.DeviceHello{}, false, &multipleDevicesError{targets: matchedTargets}
	}
	return matched, matchedHello, len(matchedTargets) == 1, nil
}

func (s *Server) clearConfiguredDeviceState() {
	s.clearAmbiguousDeviceSelection()
	s.connectionMu.Lock()
	clear(s.connectionStates)
	s.connectionMu.Unlock()
	s.helloProbes.clear()
	s.healthProbes.clear()
}

func (s *Server) confirmPendingWiFiTransition(
	ctx context.Context,
	target string,
	token string,
	expectedDeviceID string,
	hello protocol.DeviceHello,
) error {
	hello = hello.Normalize()
	transport := hello.Capabilities.Transport
	if !transport.TransitionPending {
		return nil
	}
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if expectedDeviceID == "" ||
		!strings.EqualFold(expectedDeviceID, hello.DeviceID) ||
		transport.Active != "wifi" ||
		transport.Mode != "wifi" ||
		transport.TransitionTo != "wifi" {
		return errors.New("pending WiFi transition did not rediscover the expected VibeTV identity")
	}
	if strings.TrimSpace(token) == "" {
		cfg, err := s.config()
		if err != nil {
			return err
		}
		if !cfg.WiFiTransitionPending() || !strings.EqualFold(cfg.DeviceID, hello.DeviceID) {
			return errors.New("pending WiFi transition requires pairing authentication")
		}
		token = strings.TrimSpace(cfg.DeviceToken)
		if token == "" {
			token, err = s.pair(ctx, target, "")
			if err != nil {
				return err
			}
			if err := s.rememberPendingWiFiTransitionToken(target, hello.DeviceID, token); err != nil {
				return err
			}
		}
	}
	return s.doJSON(
		ctx,
		http.MethodPost,
		target,
		"/api/connection-mode/confirm",
		token,
		map[string]string{"deviceId": hello.DeviceID},
		nil,
	)
}

func (s *Server) rememberPendingWiFiTransitionToken(target, deviceID, token string) error {
	target = normalizeTarget(target)
	deviceID = strings.TrimSpace(deviceID)
	token = strings.TrimSpace(token)
	pending := false
	_, err := s.updateConfig(func(current *runtimeconfig.Config) {
		current.RememberDevice(runtimeconfig.KnownDevice{
			DeviceID:    deviceID,
			Target:      target,
			DeviceToken: token,
		})
		if !current.WiFiTransitionPending() || !strings.EqualFold(current.DeviceID, deviceID) {
			return
		}
		current.DeviceTarget = target
		current.DeviceToken = token
		pending = true
	})
	if err != nil {
		return err
	}
	if !pending {
		return errors.New("pending WiFi transition changed before pairing completed")
	}
	return nil
}

func (s *Server) commitConfirmedWiFiTransition(
	cfg runtimeconfig.Config,
	hello protocol.DeviceHello,
) (runtimeconfig.Config, bool, error) {
	if !cfg.WiFiTransitionPending() {
		return cfg, false, nil
	}
	hello = hello.Normalize()
	transport := hello.Capabilities.Transport
	if !strings.EqualFold(cfg.DeviceID, hello.DeviceID) ||
		transport.Active != "wifi" || transport.Mode != "wifi" {
		return cfg, false, nil
	}
	supportedTransports := append([]string(nil), transport.Supported...)
	committed := false
	updated, err := s.updateConfig(func(current *runtimeconfig.Config) {
		if !current.WiFiTransitionPending() || !strings.EqualFold(current.DeviceID, hello.DeviceID) {
			return
		}
		current.SetActiveDevice(runtimeconfig.KnownDevice{
			DeviceID:    hello.DeviceID,
			Target:      current.DeviceTarget,
			DeviceToken: current.DeviceToken,
		})
		current.ConnectionMode = "wifi"
		current.DeviceTransports = supportedTransports
		committed = true
	})
	if err != nil {
		return cfg, false, err
	}
	return updated, committed, nil
}
