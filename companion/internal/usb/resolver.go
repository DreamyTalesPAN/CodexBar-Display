package usb

import (
	"errors"
	"os"
	"sort"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	serial "go.bug.st/serial"
)

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
