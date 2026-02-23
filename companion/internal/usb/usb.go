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
	mode := &serial.Mode{BaudRate: 115200}
	p, err := serialOpen(port, mode)
	if err != nil {
		return fmt.Errorf("open serial %s: %w", port, err)
	}
	_ = closePortBestEffort(p, 200*time.Millisecond)
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

	if err := s.ensurePort(path); err != nil {
		return err
	}

	if _, err := s.port.Write(line); err != nil {
		s.closeCurrentLocked()
		return fmt.Errorf("write serial %s: %w", path, err)
	}
	return nil
}

func (s *serialSender) ensurePort(path string) error {
	if s.port != nil && s.path == path {
		return nil
	}

	// Port changed (for example after reconnect): drop stale handle and reopen.
	s.closeCurrentLocked()

	mode := &serial.Mode{BaudRate: 115200}
	p, err := serialOpen(path, mode)
	if err != nil {
		return fmt.Errorf("open serial %s: %w", path, err)
	}

	s.port = p
	s.path = path
	return nil
}

func (s *serialSender) closeCurrentLocked() {
	if s.port == nil {
		return
	}
	_ = closePortBestEffort(s.port, 200*time.Millisecond)
	s.port = nil
	s.path = ""
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
