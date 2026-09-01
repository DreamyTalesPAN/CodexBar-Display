package usb

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type SenderConfig struct {
	Opener         PortOpener
	Sleep          func(time.Duration)
	SettleDuration time.Duration
	HelloWindow    time.Duration
	WriteTimeout   time.Duration
}

type Sender struct {
	mu sync.Mutex

	opener         PortOpener
	sleep          func(time.Duration)
	settleDuration time.Duration
	helloWindow    time.Duration
	writeTimeout   time.Duration

	port          SerialPort
	path          string
	hello         protocol.DeviceHello
	helloSeen     bool
	capabilities  protocol.DeviceCapabilities
	capsCollected bool
}

func NewSender() *Sender {
	return NewSenderWithConfig(SenderConfig{})
}

func NewSenderWithConfig(cfg SenderConfig) *Sender {
	opener := cfg.Opener
	if opener == nil {
		opener = serialOpener{openFn: serialOpen}
	}
	sleep := cfg.Sleep
	if sleep == nil {
		sleep = time.Sleep
	}
	settle := cfg.SettleDuration
	if settle <= 0 {
		settle = reopenSettleDuration
	}
	window := cfg.HelloWindow
	if window <= 0 {
		window = helloReadWindow
	}
	writeLimit := cfg.WriteTimeout
	if writeLimit <= 0 {
		writeLimit = writeTimeout
	}

	return &Sender{
		opener:         opener,
		sleep:          sleep,
		settleDuration: settle,
		helloWindow:    window,
		writeTimeout:   writeLimit,
	}
}

func (s *Sender) Send(path string, line []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.ensurePort(path)
	if err != nil {
		return err
	}

	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return wrapTransportError(
			errcode.TransportSerialWrite,
			"send-line",
			path,
			"Verify cable and power, then wait for daemon reconnect retry.",
			err,
		)
	}
	return nil
}

func (s *Sender) ReadHello(path string) (protocol.DeviceHello, error) {
	return s.DeviceHello(path)
}

func (s *Sender) ReadCapabilities(path string) (protocol.DeviceCapabilities, error) {
	return s.DeviceCapabilities(path)
}

func (s *Sender) CurrentHello() (protocol.DeviceHello, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.helloSeen {
		return protocol.DeviceHello{}, false
	}
	return cloneDeviceHello(s.hello), true
}

func cloneDeviceHello(hello protocol.DeviceHello) protocol.DeviceHello {
	hello.SupportedProtocolVersions = append([]int(nil), hello.SupportedProtocolVersions...)
	hello.Features = append([]string(nil), hello.Features...)
	hello.Capabilities.Theme.SupportedPrimitiveTypes = append(
		[]string(nil),
		hello.Capabilities.Theme.SupportedPrimitiveTypes...,
	)
	hello.Capabilities.Theme.BuiltinThemes = append([]string(nil), hello.Capabilities.Theme.BuiltinThemes...)
	hello.Capabilities.Transport.Supported = append([]string(nil), hello.Capabilities.Transport.Supported...)
	if hello.Capabilities.Auth != nil {
		auth := *hello.Capabilities.Auth
		hello.Capabilities.Auth = &auth
	}
	return hello
}

func (s *Sender) DeviceHello(path string) (protocol.DeviceHello, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	opened, err := s.ensurePort(path)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	if opened {
		s.captureHelloAfterOpenLocked()
	} else if !s.helloSeen {
		s.captureHelloAfterOpenLocked()
	}

	if !s.helloSeen {
		return protocol.DeviceHello{}, wrapTransportError(
			errcode.ProtocolDeviceHelloUnavailable,
			"read-hello",
			path,
			"Reconnect the board to emit boot hello; runtime will fallback if still unavailable.",
			ErrDeviceHelloUnavailable,
		)
	}
	return s.hello, nil
}

func (s *Sender) DeviceCapabilities(path string) (protocol.DeviceCapabilities, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	opened, err := s.ensurePort(path)
	if err != nil {
		return protocol.UnknownDeviceCapabilities(), err
	}
	if opened {
		s.captureHelloAfterOpenLocked()
	} else if !s.helloSeen {
		s.captureHelloAfterOpenLocked()
	}

	return s.capabilities, nil
}

func (s *Sender) ensurePort(path string) (bool, error) {
	if s.port != nil && s.path == path {
		return false, nil
	}

	s.closeCurrentLocked()

	p, err := s.opener.Open(path, openMode())
	if err != nil {
		return false, wrapTransportError(
			errcode.TransportSerialOpen,
			"open-port",
			path,
			"Release serial lock (`lsof <port>`), reconnect device, and retry.",
			err,
		)
	}
	setControlLinesLow(p)

	s.port = p
	s.path = path
	s.hello = protocol.DeviceHello{}
	s.helloSeen = false
	s.capabilities = protocol.UnknownDeviceCapabilities()
	s.capsCollected = false
	return true, nil
}

func (s *Sender) captureHelloAfterOpenLocked() {
	// Identity is a normal control request. Never reset the ESP8266 just to
	// learn which device owns a serial port.
	_ = s.port.ResetInputBuffer()
	s.sleep(s.settleDuration)
	if err := writeWithTimeout(s.port, helloRequestLine, s.writeTimeout); err != nil {
		s.hello = protocol.DeviceHello{}
		s.helloSeen = false
		s.capabilities = protocol.UnknownDeviceCapabilities()
		s.capsCollected = true
		return
	}
	s.captureHelloLocked()
	_ = s.port.ResetInputBuffer()
}

func (s *Sender) captureHelloLocked() {
	if s.port == nil {
		return
	}
	hello, seen := readHelloFromPort(s.port, s.helloWindow)
	if !seen {
		s.hello = protocol.DeviceHello{}
		s.helloSeen = false
		s.capabilities = protocol.UnknownDeviceCapabilities()
		s.capsCollected = true
		return
	}
	hello = hello.Normalize()
	s.hello = hello
	s.helloSeen = true
	s.capabilities = protocol.CapabilitiesFromHello(hello)
	s.capsCollected = true
}

func (s *Sender) ResolvePort(explicit, expectedDeviceID string) (string, error) {
	path, ok := s.currentMatchingPort(explicit, expectedDeviceID, false)
	if !ok {
		var err error
		path, err = resolveVibeTVPort(explicit, expectedDeviceID, s.DeviceHello)
		if err != nil {
			return "", err
		}
	}
	hello, err := s.DeviceHello(path)
	if err != nil {
		return "", err
	}
	if hello.Capabilities.Transport.TransitionPending &&
		hello.Capabilities.Transport.TransitionTo == "cable" {
		if err := s.ConfirmConnectionMode(path, hello.DeviceID); err != nil {
			return "", err
		}
	}
	return path, nil
}

func (s *Sender) ResolveControlPort(explicit, expectedDeviceID string) (string, error) {
	if path, ok := s.currentMatchingPort(explicit, expectedDeviceID, true); ok {
		return path, nil
	}
	return resolveVibeTVPortForControl(explicit, expectedDeviceID, s.DeviceHello, true)
}

func (s *Sender) currentMatchingPort(explicit, expectedDeviceID string, allowWiFiMode bool) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path := strings.TrimSpace(s.path)
	explicit = strings.TrimSpace(explicit)
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if (explicit == "" && expectedDeviceID == "") || s.port == nil || !s.helloSeen || path == "" ||
		(explicit != "" && explicit != path) {
		return "", false
	}
	hello := s.hello.Normalize()
	mode := hello.Capabilities.Transport.Mode
	if hello.Kind != "hello" || !isSupportedCableBoard(hello.Board) || hello.DeviceID == "" ||
		hello.Capabilities.Transport.Active != "usb" ||
		(mode != "cable" && (!allowWiFiMode || (mode != "wifi" && mode != "legacy-wifi-only"))) ||
		(expectedDeviceID != "" && !strings.EqualFold(hello.DeviceID, expectedDeviceID)) {
		return "", false
	}
	return path, true
}

// ConfirmConnectionMode commits a pending Cable transition only after the
// resolver has selected exactly one matching device identity.
func (s *Sender) ConfirmConnectionMode(path, deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.ensurePort(path); err != nil {
		return err
	}
	line := []byte(fmt.Sprintf(
		"{\"kind\":\"request\",\"op\":\"confirm-connection-mode\",\"deviceId\":%q}\n",
		deviceID,
	))
	_ = s.port.ResetInputBuffer()
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return wrapTransportError(
			errcode.TransportSerialWrite,
			"confirm-connection-mode",
			path,
			"Keep the expected VibeTV connected by Cable and retry before rollback.",
			err,
		)
	}
	if err := readConnectionModeConfirmationFromPort(s.port, s.helloWindow, deviceID); err != nil {
		return fmt.Errorf("confirm connection mode on %s: %w", path, err)
	}
	s.hello.Capabilities.Transport.TransitionPending = false
	s.hello.Capabilities.Transport.TransitionFrom = ""
	s.hello.Capabilities.Transport.TransitionTo = ""
	return nil
}

func (s *Sender) SetConnectionMode(path, deviceID, mode string) error {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "cable" && mode != "wifi" {
		return fmt.Errorf("unsupported connection mode %q", mode)
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.ensurePort(path); err != nil {
		return err
	}
	line := []byte(fmt.Sprintf(
		"{\"kind\":\"request\",\"op\":\"set-connection-mode\",\"deviceId\":%q,\"mode\":%q}\n",
		strings.TrimSpace(deviceID),
		mode,
	))
	_ = s.port.ResetInputBuffer()
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return wrapTransportError(
			errcode.TransportSerialWrite,
			"set-connection-mode",
			path,
			"Keep the selected VibeTV connected by Cable and retry.",
			err,
		)
	}
	if err := readConnectionModeSwitchFromPort(s.port, s.helloWindow, deviceID, mode); err != nil {
		return fmt.Errorf("set connection mode on %s: %w", path, err)
	}
	// The acknowledged switch schedules a reboot, so the old serial handle is
	// no longer authoritative.
	s.closeCurrentLocked()
	return nil
}

func (s *Sender) PairDevice(path, deviceID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return "", errors.New("cable pairing deviceId is required")
	}
	if _, err := s.ensurePort(path); err != nil {
		return "", err
	}
	request := struct {
		Kind     string `json:"kind"`
		Op       string `json:"op"`
		DeviceID string `json:"deviceId"`
	}{Kind: "request", Op: "pair", DeviceID: deviceID}
	line, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	line = append(line, '\n')
	_ = s.port.ResetInputBuffer()
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return "", wrapTransportError(
			errcode.TransportSerialWrite,
			"pair",
			path,
			"Keep the selected VibeTV connected by Cable and try again.",
			err,
		)
	}
	token, err := readPairingFromPort(s.port, s.helloWindow, deviceID)
	if err != nil {
		return "", fmt.Errorf("pair VibeTV on %s: %w", path, err)
	}
	return token, nil
}

func (s *Sender) ReadSettings(path, deviceID string) (protocol.DeviceSettings, error) {
	return s.requestSettings(path, deviceID, nil)
}

func (s *Sender) ReadHealth(path, deviceID string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.ensurePort(path); err != nil {
		return nil, err
	}
	request := struct {
		Kind     string `json:"kind"`
		Op       string `json:"op"`
		DeviceID string `json:"deviceId"`
	}{Kind: "request", Op: "health", DeviceID: strings.TrimSpace(deviceID)}
	line, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	line = append(line, '\n')
	_ = s.port.ResetInputBuffer()
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return nil, wrapTransportError(
			errcode.TransportSerialWrite,
			"health",
			path,
			"Keep the selected VibeTV connected by Cable and retry.",
			err,
		)
	}
	health, err := readHealthFromPort(s.port, s.helloWindow, deviceID)
	if err != nil {
		return nil, fmt.Errorf("health on %s: %w", path, err)
	}
	return health, nil
}

func (s *Sender) WriteSettings(path, deviceID string, patch protocol.DeviceSettingsPatch) (protocol.DeviceSettings, error) {
	return s.requestSettings(path, deviceID, &patch)
}

func (s *Sender) requestSettings(path, deviceID string, patch *protocol.DeviceSettingsPatch) (protocol.DeviceSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.ensurePort(path); err != nil {
		return protocol.DeviceSettings{}, err
	}
	request := struct {
		Kind     string                        `json:"kind"`
		Op       string                        `json:"op"`
		DeviceID string                        `json:"deviceId"`
		Settings *protocol.DeviceSettingsPatch `json:"settings,omitempty"`
	}{Kind: "request", Op: "settings", DeviceID: strings.TrimSpace(deviceID), Settings: patch}
	line, err := json.Marshal(request)
	if err != nil {
		return protocol.DeviceSettings{}, err
	}
	line = append(line, '\n')
	_ = s.port.ResetInputBuffer()
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return protocol.DeviceSettings{}, wrapTransportError(
			errcode.TransportSerialWrite,
			"settings",
			path,
			"Keep the selected VibeTV connected by Cable and retry.",
			err,
		)
	}
	settings, err := readSettingsFromPort(s.port, s.helloWindow, deviceID)
	if err != nil {
		return protocol.DeviceSettings{}, fmt.Errorf("settings on %s: %w", path, err)
	}
	return settings, nil
}

func (s *Sender) ConfigureWiFi(path, deviceID, ssid, password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.ensurePort(path); err != nil {
		return err
	}
	request := struct {
		Kind     string `json:"kind"`
		Op       string `json:"op"`
		DeviceID string `json:"deviceId"`
		SSID     string `json:"ssid"`
		Password string `json:"password"`
	}{
		Kind:     "request",
		Op:       "configure-wifi",
		DeviceID: strings.TrimSpace(deviceID),
		SSID:     ssid,
		Password: password,
	}
	line, err := json.Marshal(request)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	_ = s.port.ResetInputBuffer()
	if err := writeWithTimeout(s.port, line, s.writeTimeout); err != nil {
		s.closeCurrentLocked()
		return wrapTransportError(
			errcode.TransportSerialWrite,
			"configure-wifi",
			path,
			"Keep the selected VibeTV connected by Cable and retry.",
			err,
		)
	}
	if err := readConnectionModeSwitchFromPort(s.port, s.helloWindow, deviceID, "wifi"); err != nil {
		return fmt.Errorf("configure WiFi on %s: %w", path, err)
	}
	s.closeCurrentLocked()
	return nil
}

func (s *Sender) closeCurrentLocked() {
	if s.port == nil {
		return
	}
	_ = closePortBestEffort(s.port, s.path, closeTimeout)
	s.port = nil
	s.path = ""
	s.hello = protocol.DeviceHello{}
	s.helloSeen = false
	s.capabilities = protocol.UnknownDeviceCapabilities()
	s.capsCollected = false
}

func (s *Sender) Close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeCurrentLocked()
}
