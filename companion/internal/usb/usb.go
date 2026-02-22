package usb

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	serial "go.bug.st/serial"
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
	if len(ports) == 0 {
		return "", errors.New("no serial ports found")
	}

	for _, p := range ports {
		if strings.Contains(p, "usbmodem") {
			return p, nil
		}
	}
	for _, p := range ports {
		if strings.Contains(p, "usbserial") {
			return p, nil
		}
	}
	return ports[0], nil
}

func SendLine(port string, line []byte) error {
	mode := &serial.Mode{BaudRate: 115200}
	p, err := serial.Open(port, mode)
	if err != nil {
		return fmt.Errorf("open serial %s: %w", port, err)
	}
	defer p.Close()

	if len(line) == 0 || line[len(line)-1] != '\n' {
		line = append(line, '\n')
	}

	if _, err := p.Write(line); err != nil {
		return fmt.Errorf("write serial %s: %w", port, err)
	}
	return nil
}
