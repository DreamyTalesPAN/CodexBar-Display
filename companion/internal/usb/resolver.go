package usb

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

const vibeTVBoardID = "esp8266-smalltv-st7789"

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

// ResolveVibeTVPort resolves a Cable device by its protocol identity. Port
// names are only candidates: they are never remembered, ranked, or treated as
// identity.
func ResolveVibeTVPort(explicit, expectedDeviceID string) (string, error) {
	return resolveVibeTVPort(explicit, expectedDeviceID, defaultSender.DeviceHello)
}

func resolveVibeTVPort(
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
) (string, error) {
	explicit = strings.TrimSpace(explicit)
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if readHello == nil {
		return "", errors.New("device hello reader is required")
	}

	var candidates []string
	if explicit != "" {
		resolved, err := ResolvePort(explicit)
		if err != nil {
			return "", err
		}
		candidates = []string{resolved}
	} else {
		ports, err := ListPorts()
		if err != nil {
			return "", err
		}
		for _, candidate := range ports {
			candidate = strings.TrimSpace(candidate)
			lower := strings.ToLower(candidate)
			if candidate != "" && strings.Contains(lower, "usb") {
				candidates = append(candidates, candidate)
			}
		}
	}
	if len(candidates) == 0 {
		return "", wrapTransportError(
			errcode.TransportNoUSBSerialPorts,
			"resolve-vibetv",
			"",
			"Connect VibeTV with a data-capable Cable and retry.",
			errors.New("no USB serial candidates found"),
		)
	}

	return resolveVibeTVCandidates(candidates, explicit, expectedDeviceID, readHello)
}

func resolveVibeTVCandidates(
	candidates []string,
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
) (string, error) {
	matches := make([]string, 0, 1)
	for _, candidate := range candidates {
		hello, err := readHello(candidate)
		if err != nil {
			continue
		}
		hello = hello.Normalize()
		if hello.Kind != "hello" ||
			hello.Board != vibeTVBoardID ||
			hello.DeviceID == "" ||
			hello.Capabilities.Transport.Active != "usb" ||
			hello.Capabilities.Transport.Mode != "cable" {
			continue
		}
		if expectedDeviceID != "" && !strings.EqualFold(hello.DeviceID, expectedDeviceID) {
			continue
		}
		matches = append(matches, candidate)
	}

	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		detail := "no matching Cable VibeTV answered hello"
		if expectedDeviceID != "" {
			detail = fmt.Sprintf("VibeTV deviceId %q was not found", expectedDeviceID)
		}
		return "", wrapTransportError(
			errcode.TransportNoMatchingDevice,
			"resolve-vibetv",
			explicit,
			"Connect the expected VibeTV by Cable and retry. Foreign serial devices are ignored.",
			errors.New(detail),
		)
	default:
		return "", wrapTransportError(
			errcode.TransportMultipleDevices,
			"resolve-vibetv",
			"",
			"Leave exactly one matching VibeTV connected and retry.",
			fmt.Errorf("multiple matching VibeTVs: %s", strings.Join(matches, ", ")),
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
