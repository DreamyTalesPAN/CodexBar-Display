package usb

import (
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

	opened, err := s.ensurePort(path)
	if err != nil {
		return err
	}
	if opened {
		s.captureHelloAfterOpenLocked()
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

func (s *Sender) DeviceHello(path string) (protocol.DeviceHello, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	opened, err := s.ensurePort(path)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	if opened {
		s.captureHelloAfterOpenLocked()
	} else if !s.capsCollected {
		s.captureHelloLocked()
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
	} else if !s.capsCollected {
		s.captureHelloLocked()
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
	// Some ESP8266 USB bridges pulse reset/boot lines when a serial port is opened.
	// Give the MCU a short settle window and capture boot hello before first write.
	_ = s.port.ResetInputBuffer()
	s.sleep(s.settleDuration)
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
