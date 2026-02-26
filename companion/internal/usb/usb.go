package usb

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	serial "go.bug.st/serial"
)

var serialOpen = serial.Open
var defaultSender serialSender

const (
	serialBaudRate       = 115200
	closeTimeout         = 200 * time.Millisecond
	reopenSettleDuration = 1200 * time.Millisecond
)

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

func ProbePort(port string) error {
	p, err := serialOpen(port, openMode())
	if err != nil {
		return fmt.Errorf("open serial %s: %w", port, err)
	}
	setControlLinesLow(p)
	_ = closePortBestEffort(p, closeTimeout)
	return nil
}

type serialSender struct {
	mu   sync.Mutex
	port serial.Port
	path string
}

func (s *serialSender) Send(path string, line []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	opened, err := s.ensurePort(path)
	if err != nil {
		return err
	}
	if opened {
		// Some ESP8266 USB bridges pulse reset/boot lines when a serial port is opened.
		// Give the MCU a short settle window and clear any boot noise before first write.
		_ = s.port.ResetInputBuffer()
		time.Sleep(reopenSettleDuration)
		_ = s.port.ResetInputBuffer()
	}

	if _, err := s.port.Write(line); err != nil {
		s.closeCurrentLocked()
		return fmt.Errorf("write serial %s: %w", path, err)
	}
	return nil
}

func (s *serialSender) ensurePort(path string) (bool, error) {
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
	return true, nil
}

func (s *serialSender) closeCurrentLocked() {
	if s.port == nil {
		return
	}
	_ = closePortBestEffort(s.port, closeTimeout)
	s.port = nil
	s.path = ""
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
