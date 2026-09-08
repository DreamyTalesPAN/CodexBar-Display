package usb

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
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
	s := defaultSender
	s.mu.Lock()
	defer s.mu.Unlock()

	explicit = strings.TrimSpace(explicit)
	// A live handle is authoritative until a write fails or it is closed.
	if s.port != nil && (samePort(explicit, s.path) || (explicit == "" && isVibeTVHello(s.hello))) {
		return s.path, nil
	}
	ports, err := ListPorts()
	if err != nil {
		return "", err
	}
	if explicit != "" {
		// Explicit ports retain recovery access to boards with no working hello.
		// COM names are serial identifiers, not filesystem paths.
		for _, port := range ports {
			if samePort(explicit, port) {
				return port, nil
			}
		}
		return "", wrapTransportError(errcode.TransportSerialPortNotFound, "resolve-explicit-port", explicit,
			"List serial ports and pass an available port via --port.", errors.New("serial port not found"))
	}
	port, err := SelectPort(ports, s.deviceHelloLocked)
	if err != nil {
		s.closeCurrentLocked()
		return "", err
	}
	// The scan may have closed the selected port while checking later candidates.
	// Restore and verify it once; subsequent frames reuse this handle and hello.
	hello, err := s.deviceHelloLocked(port)
	if err != nil || !isVibeTVHello(hello) {
		s.closeCurrentLocked()
		if err != nil {
			return "", err
		}
		return "", fmt.Errorf("selected serial port %s no longer identifies as VibeTV", port)
	}
	return port, nil
}

var ErrAmbiguousPorts = errors.New("multiple VibeTV serial devices found")

// SelectPort identifies exactly one VibeTV using hello, never its port name.
// The caller owns the reader's serial handle and must close it before flashing.
func SelectPort(ports []string, readHello func(string) (protocol.DeviceHello, error)) (string, error) {
	// Darwin enumerates dial-in and callout names for the same device. Prefer
	// the exact callout alias: opening its tty twin can wait for carrier detect.
	calloutPorts := make(map[string]bool)
	for _, p := range ports {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, "/dev/cu.") {
			calloutPorts[p] = true
		}
	}
	seen := make(map[string]bool)
	var matches []string
	for _, p := range ports {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, "/dev/tty.") && calloutPorts["/dev/cu."+strings.TrimPrefix(p, "/dev/tty.")] {
			continue
		}
		key := p
		if strings.HasPrefix(strings.ToUpper(p), "COM") {
			key = strings.ToUpper(p)
		}
		if p == "" || seen[key] {
			continue
		}
		seen[key] = true
		hello, err := readHello(p)
		if err == nil && isVibeTVHello(hello) {
			matches = append(matches, p)
		}
	}
	if len(seen) == 0 {
		return "", wrapTransportError(
			errcode.TransportNoSerialPorts,
			"choose-auto-port",
			"",
			"Connect a board with USB data cable, then rerun command.",
			errors.New("no serial ports found"),
		)
	}

	if len(matches) == 1 {
		return matches[0], nil
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("%w: %s; select one explicitly with --port", ErrAmbiguousPorts, strings.Join(matches, ", "))
	}

	return "", wrapTransportError(
		errcode.TransportNoUSBSerialPorts,
		"choose-auto-port",
		"",
		"Connect a VibeTV with a USB data cable, or use --port for explicit firmware recovery.",
		errors.New("no VibeTV serial device identified by hello"),
	)
}

func samePort(a, b string) bool {
	if strings.HasPrefix(strings.ToUpper(a), "COM") && strings.HasPrefix(strings.ToUpper(b), "COM") {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func isVibeTVHello(hello protocol.DeviceHello) bool {
	hello = hello.Normalize()
	if hello.Kind != "hello" {
		return false
	}
	switch hello.Board {
	case "esp8266-smalltv-st7789", "esp32-lilygo-t-display-s3":
		return true
	default:
		return false
	}
}
