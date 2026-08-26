package usb

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

const vibeTVBoardID = "esp8266-smalltv-st7789"
const lilygoVibeTVBoardID = "esp32-lilygo-t-display-s3"

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
	if explicit == "" {
		return "", wrapTransportError(
			errcode.TransportSerialPortNotFound,
			"resolve-explicit-port",
			"",
			"Pass the exact recovery port from `ls /dev/cu.usb*`.",
			errors.New("an explicit serial port is required for recovery"),
		)
	}
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

// ResolveVibeTVPort resolves a Cable device by its protocol identity. Port
// names are only candidates: they are never remembered, ranked, or treated as
// identity.
func ResolveVibeTVPort(explicit, expectedDeviceID string) (string, error) {
	return defaultSender.ResolvePort(explicit, expectedDeviceID)
}

// ResolveVibeTVControlPort resolves a supported VibeTV that is physically
// connected over USB. Unlike ResolveVibeTVPort, it also accepts a device whose
// selected connection mode is WiFi so the control API can switch it to Cable.
func ResolveVibeTVControlPort(explicit, expectedDeviceID string) (string, error) {
	return defaultSender.ResolveControlPort(explicit, expectedDeviceID)
}

func resolveVibeTVPort(
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
) (string, error) {
	return resolveVibeTVPortForControl(explicit, expectedDeviceID, readHello, false)
}

func resolveVibeTVPortForControl(
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
	allowWiFiMode bool,
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
		candidates = cableSerialCandidates(ports, runtime.GOOS)
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

	return resolveVibeTVCandidatesForControl(
		candidates,
		explicit,
		expectedDeviceID,
		readHello,
		allowWiFiMode,
	)
}

func cableSerialCandidates(ports []string, goos string) []string {
	candidates := make([]string, 0, len(ports))
	for _, candidate := range ports {
		candidate = strings.TrimSpace(candidate)
		lower := strings.ToLower(candidate)
		if candidate == "" || !strings.Contains(lower, "usb") {
			continue
		}
		// macOS exposes one USB-UART twice. /dev/cu.* is the callout endpoint
		// intended for initiating a connection; /dev/tty.* is its waiting alias,
		// not a second physical VibeTV.
		if goos == "darwin" && strings.HasPrefix(lower, "/dev/tty.") {
			continue
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}

func resolveVibeTVCandidates(
	candidates []string,
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
) (string, error) {
	return resolveVibeTVCandidatesForControl(
		candidates,
		explicit,
		expectedDeviceID,
		readHello,
		false,
	)
}

func resolveVibeTVCandidatesForControl(
	candidates []string,
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
	allowWiFiMode bool,
) (string, error) {
	matches := make([]string, 0, 1)
	for _, candidate := range candidates {
		hello, err := readHello(candidate)
		if err != nil {
			continue
		}
		hello = hello.Normalize()
		mode := hello.Capabilities.Transport.Mode
		if hello.Kind != "hello" ||
			!isSupportedCableBoard(hello.Board) ||
			hello.DeviceID == "" ||
			hello.Capabilities.Transport.Active != "usb" ||
			(mode != "cable" && (!allowWiFiMode || mode != "wifi")) {
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

func isSupportedCableBoard(board string) bool {
	switch strings.ToLower(strings.TrimSpace(board)) {
	case vibeTVBoardID, lilygoVibeTVBoardID:
		return true
	default:
		return false
	}
}
