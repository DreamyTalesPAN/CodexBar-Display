package usb

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

var serialOpen = serial.Open
var defaultDiscoverer PortDiscoverer = systemDiscoverer{}
var defaultSender = NewSender()

const (
	serialBaudRate       = 115200
	closeTimeout         = 200 * time.Millisecond
	reopenSettleDuration = 1200 * time.Millisecond
	helloReadWindow      = 300 * time.Millisecond
	helloReadStepTimeout = 80 * time.Millisecond
	helloReadBufferBytes = 1024
)

var ErrDeviceHelloUnavailable = errors.New("device hello unavailable")

type PortDiscoverer interface {
	Discover() ([]string, error)
}

type SerialPort interface {
	Read([]byte) (int, error)
	Write([]byte) (int, error)
	Close() error
	SetReadTimeout(time.Duration) error
	ResetInputBuffer() error
	SetDTR(bool) error
	SetRTS(bool) error
}

type PortOpener interface {
	Open(path string, mode *serial.Mode) (SerialPort, error)
}

type LineSender interface {
	Send(path string, line []byte) error
}

type HelloReader interface {
	ReadHello(path string) (protocol.DeviceHello, error)
}

type CapabilitiesReader interface {
	ReadCapabilities(path string) (protocol.DeviceCapabilities, error)
}

type TransportError struct {
	code     errcode.Code
	op       string
	path     string
	err      error
	recovery string
}

func (e *TransportError) Error() string {
	if e == nil {
		return ""
	}
	base := string(e.code)
	if e.op != "" {
		base = fmt.Sprintf("%s (%s)", base, e.op)
	}
	if e.path != "" {
		base = fmt.Sprintf("%s path=%s", base, e.path)
	}
	if e.err != nil {
		return fmt.Sprintf("%s: %v", base, e.err)
	}
	return base
}

func (e *TransportError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func (e *TransportError) ErrorCode() errcode.Code {
	if e == nil {
		return ""
	}
	return e.code
}

func (e *TransportError) RecoveryAction() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.recovery) != "" {
		return strings.TrimSpace(e.recovery)
	}
	return errcode.DefaultRecovery(e.code)
}

func wrapTransportError(code errcode.Code, op, path, recovery string, err error) error {
	if err == nil {
		return nil
	}
	return &TransportError{
		code:     code,
		op:       op,
		path:     strings.TrimSpace(path),
		err:      err,
		recovery: recovery,
	}
}

type systemDiscoverer struct{}

func (systemDiscoverer) Discover() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, wrapTransportError(
			errcode.TransportNoSerialPorts,
			"discover-ports",
			"",
			"Reconnect the board and ensure the serial driver is available, then retry.",
			err,
		)
	}
	sort.Strings(ports)
	return ports, nil
}

type serialOpener struct {
	openFn func(string, *serial.Mode) (serial.Port, error)
}

func (o serialOpener) Open(path string, mode *serial.Mode) (SerialPort, error) {
	if o.openFn == nil {
		return nil, errors.New("serial opener is not configured")
	}
	return o.openFn(path, mode)
}

func ListPorts() ([]string, error) {
	return defaultDiscoverer.Discover()
}

func ResolvePort(explicit string) (string, error) {
	explicit = strings.TrimSpace(explicit)
	if explicit != "" {
		if _, err := os.Stat(explicit); err != nil {
			return "", wrapTransportError(
				errcode.TransportSerialPortNotFound,
				"resolve-explicit-port",
				explicit,
				"Run `ls /dev/cu.usb*` and pass an existing port path.",
				err,
			)
		}
		return explicit, nil
	}

	ports, err := ListPorts()
	if err != nil {
		return "", err
	}
	return chooseAutoPort(ports)
}

func SendLine(port string, line []byte) error {
	if len(line) == 0 || line[len(line)-1] != '\n' {
		line = append(line, '\n')
	}

	return defaultSender.Send(port, line)
}

func ReadDeviceHello(port string) (protocol.DeviceHello, error) {
	return defaultSender.ReadHello(port)
}

func GetDeviceCapabilities(port string) (protocol.DeviceCapabilities, error) {
	return defaultSender.ReadCapabilities(port)
}

func CloseDefaultSender() {
	defaultSender.Close()
}

func ProbePort(path string) error {
	opener := serialOpener{openFn: serialOpen}
	port, err := opener.Open(path, openMode())
	if err != nil {
		return wrapTransportError(
			errcode.TransportSerialProbe,
			"probe-open",
			path,
			"Release the serial port (`lsof <port>`), reconnect device, and retry setup.",
			err,
		)
	}
	setControlLinesLow(port)
	if err := closePortBestEffort(port, path, closeTimeout); err != nil {
		return err
	}
	return nil
}

type SenderConfig struct {
	Opener         PortOpener
	Sleep          func(time.Duration)
	SettleDuration time.Duration
	HelloWindow    time.Duration
}

type Sender struct {
	mu sync.Mutex

	opener         PortOpener
	sleep          func(time.Duration)
	settleDuration time.Duration
	helloWindow    time.Duration

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

	return &Sender{
		opener:         opener,
		sleep:          sleep,
		settleDuration: settle,
		helloWindow:    window,
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
		// Some ESP8266 USB bridges pulse reset/boot lines when a serial port is opened.
		// Give the MCU a short settle window and capture boot hello before first write.
		_ = s.port.ResetInputBuffer()
		s.sleep(s.settleDuration)
		s.captureHelloLocked()
		_ = s.port.ResetInputBuffer()
	}

	if _, err := s.port.Write(line); err != nil {
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

func (s *Sender) ensurePort(path string) (bool, error) {
	if s.port != nil && s.path == path {
		return false, nil
	}

	// Port changed (for example after reconnect): drop stale handle and reopen.
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

func (s *Sender) DeviceHello(path string) (protocol.DeviceHello, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	opened, err := s.ensurePort(path)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	if opened {
		_ = s.port.ResetInputBuffer()
		s.sleep(s.settleDuration)
		s.captureHelloLocked()
		_ = s.port.ResetInputBuffer()
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
		_ = s.port.ResetInputBuffer()
		s.sleep(s.settleDuration)
		s.captureHelloLocked()
		_ = s.port.ResetInputBuffer()
	} else if !s.capsCollected {
		s.captureHelloLocked()
	}

	return s.capabilities, nil
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

func openMode() *serial.Mode {
	return &serial.Mode{
		BaudRate: serialBaudRate,
		InitialStatusBits: &serial.ModemOutputBits{
			RTS: false,
			DTR: false,
		},
	}
}

func setControlLinesLow(port SerialPort) {
	if port == nil {
		return
	}
	_ = port.SetDTR(false)
	_ = port.SetRTS(false)
}

func closePortBestEffort(port SerialPort, path string, timeout time.Duration) error {
	if port == nil {
		return nil
	}
	if timeout <= 0 {
		timeout = 200 * time.Millisecond
	}

	done := make(chan error, 1)
	go func() {
		done <- port.Close()
	}()

	select {
	case err := <-done:
		if err == nil {
			return nil
		}
		return wrapTransportError(
			errcode.TransportSerialCloseTimeout,
			"close-port",
			path,
			"Retry; if close keeps failing restart the daemon to reset serial state.",
			err,
		)
	case <-time.After(timeout):
		return wrapTransportError(
			errcode.TransportSerialCloseTimeout,
			"close-port-timeout",
			path,
			"Retry; if close keeps timing out restart the daemon to reset serial state.",
			errors.New("serial close timeout"),
		)
	}
}

func chooseAutoPort(ports []string) (string, error) {
	if len(ports) == 0 {
		return "", wrapTransportError(
			errcode.TransportNoSerialPorts,
			"choose-auto-port",
			"",
			"Connect a board with USB data cable, then rerun command.",
			errors.New("no serial ports found"),
		)
	}

	normalized := make([]string, 0, len(ports))
	for _, p := range ports {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		normalized = append(normalized, p)
	}
	if len(normalized) == 0 {
		return "", wrapTransportError(
			errcode.TransportNoSerialPorts,
			"choose-auto-port",
			"",
			"Connect a board with USB data cable, then rerun command.",
			errors.New("no serial ports found"),
		)
	}

	for _, p := range normalized {
		if strings.Contains(strings.ToLower(p), "usbmodem") {
			return p, nil
		}
	}
	for _, p := range normalized {
		if strings.Contains(strings.ToLower(p), "usbserial") {
			return p, nil
		}
	}
	for _, p := range normalized {
		if strings.Contains(strings.ToLower(p), "usb") {
			return p, nil
		}
	}

	return "", wrapTransportError(
		errcode.TransportNoUSBSerialPorts,
		"choose-auto-port",
		"",
		"Reconnect the board and verify that a `/dev/cu.usb*` device appears.",
		errors.New("no usb serial ports found"),
	)
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

func readHelloFromPort(port SerialPort, window time.Duration) (protocol.DeviceHello, bool) {
	if port == nil {
		return protocol.DeviceHello{}, false
	}
	if window <= 0 {
		return protocol.DeviceHello{}, false
	}

	_ = port.SetReadTimeout(helloReadStepTimeout)

	deadline := time.Now().Add(window)
	chunk := make([]byte, 128)
	buffer := make([]byte, 0, helloReadBufferBytes)

	for time.Now().Before(deadline) {
		n, err := port.Read(chunk)
		if err != nil {
			continue
		}
		if n <= 0 {
			continue
		}
		buffer = append(buffer, chunk[:n]...)
		if len(buffer) > helloReadBufferBytes {
			buffer = buffer[len(buffer)-helloReadBufferBytes:]
		}

		for {
			idx := bytes.IndexByte(buffer, '\n')
			if idx < 0 {
				break
			}
			line := bytes.TrimSpace(buffer[:idx])
			buffer = buffer[idx+1:]

			if hello, ok := parseDeviceHelloLine(string(line)); ok {
				return hello, true
			}
		}
	}

	line := strings.TrimSpace(string(bytes.TrimSpace(buffer)))
	if hello, ok := parseDeviceHelloLine(line); ok {
		return hello, true
	}

	return protocol.DeviceHello{}, false
}

func parseDeviceHelloLine(line string) (protocol.DeviceHello, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return protocol.DeviceHello{}, false
	}

	if hello, ok := parseLegacyReadyLine(line); ok {
		return hello, true
	}

	if !strings.HasPrefix(line, "{") || !strings.HasSuffix(line, "}") {
		return protocol.DeviceHello{}, false
	}

	var hello protocol.DeviceHello
	if err := json.Unmarshal([]byte(line), &hello); err != nil {
		return protocol.DeviceHello{}, false
	}
	hello = hello.Normalize()
	if hello.Kind != "hello" {
		return protocol.DeviceHello{}, false
	}
	return hello, true
}

func parseLegacyReadyLine(line string) (protocol.DeviceHello, bool) {
	switch strings.TrimSpace(line) {
	case "vibeblock_ready_display", "vibeblock_ready_probe", "vibeblock_ready":
		return protocol.DeviceHello{
			Kind: "hello",
		}, true
	default:
		return protocol.DeviceHello{}, false
	}
}
