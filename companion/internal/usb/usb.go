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

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

var serialOpen = serial.Open
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

func ListPorts() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, err
	}
	sort.Strings(ports)
	return ports, nil
}

func ResolvePort(explicit string) (string, error) {
	explicit = strings.TrimSpace(explicit)
	if explicit != "" {
		if _, err := os.Stat(explicit); err != nil {
			return "", fmt.Errorf("serial port not found: %s", explicit)
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
	return defaultSender.DeviceHello(port)
}

func GetDeviceCapabilities(port string) (protocol.DeviceCapabilities, error) {
	return defaultSender.DeviceCapabilities(port)
}

func ProbePort(port string) error {
	p, err := serialOpen(port, openMode())
	if err != nil {
		return fmt.Errorf("open serial %s: %w", port, err)
	}
	setControlLinesLow(p)
	_ = closePortBestEffort(p, closeTimeout)
	return nil
}

type Sender struct {
	mu            sync.Mutex
	port          serial.Port
	path          string
	hello         protocol.DeviceHello
	helloSeen     bool
	capabilities  protocol.DeviceCapabilities
	capsCollected bool
}

func NewSender() *Sender {
	return &Sender{}
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
		time.Sleep(reopenSettleDuration)
		s.captureHelloLocked()
		_ = s.port.ResetInputBuffer()
	}

	if _, err := s.port.Write(line); err != nil {
		s.closeCurrentLocked()
		return fmt.Errorf("write serial %s: %w", path, err)
	}
	return nil
}

func (s *Sender) ensurePort(path string) (bool, error) {
	if s.port != nil && s.path == path {
		return false, nil
	}

	// Port changed (for example after reconnect): drop stale handle and reopen.
	s.closeCurrentLocked()

	p, err := serialOpen(path, openMode())
	if err != nil {
		return false, fmt.Errorf("open serial %s: %w", path, err)
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
		time.Sleep(reopenSettleDuration)
		s.captureHelloLocked()
		_ = s.port.ResetInputBuffer()
	} else if !s.capsCollected {
		s.captureHelloLocked()
	}

	if !s.helloSeen {
		return protocol.DeviceHello{}, ErrDeviceHelloUnavailable
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
		time.Sleep(reopenSettleDuration)
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
	_ = closePortBestEffort(s.port, closeTimeout)
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

func setControlLinesLow(port serial.Port) {
	if port == nil {
		return
	}
	_ = port.SetDTR(false)
	_ = port.SetRTS(false)
}

func closePortBestEffort(port serial.Port, timeout time.Duration) error {
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
		return err
	case <-time.After(timeout):
		return errors.New("serial close timeout")
	}
}

func chooseAutoPort(ports []string) (string, error) {
	if len(ports) == 0 {
		return "", errors.New("no serial ports found")
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
		return "", errors.New("no serial ports found")
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

	return "", errors.New("no usb serial ports found")
}

func (s *Sender) captureHelloLocked() {
	if s.port == nil {
		return
	}
	hello, seen := readHelloFromPort(s.port, helloReadWindow)
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

func readHelloFromPort(port serial.Port, window time.Duration) (protocol.DeviceHello, bool) {
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
			Kind:            "hello",
			ProtocolVersion: 1,
		}, true
	default:
		return protocol.DeviceHello{}, false
	}
}
