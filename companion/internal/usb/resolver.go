package usb

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

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
	// A COM name is a serial identifier, not a filesystem path, so it can only
	// be confirmed by enumeration. Stat'ing it always fails and would take
	// explicit firmware recovery away from every Windows customer.
	if isCOMPortName(explicit) {
		ports, err := ListPorts()
		if err != nil {
			return "", err
		}
		for _, port := range ports {
			if samePort(explicit, port) {
				return port, nil
			}
		}
		return "", wrapTransportError(
			errcode.TransportSerialPortNotFound,
			"resolve-explicit-port",
			explicit,
			"List serial ports and pass an available port via --port.",
			errors.New("serial port not found"),
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

func isCOMPortName(value string) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(value)), "COM")
}

// samePort compares serial identifiers. COM names are case-insensitive; Unix
// device paths are exact.
func samePort(a, b string) bool {
	if isCOMPortName(a) && isCOMPortName(b) {
		return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
	}
	return strings.TrimSpace(a) == strings.TrimSpace(b)
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

// CableDevice is an identity-confirmed VibeTV found on a serial port. Port is
// transport plumbing only and must never be persisted or shown as identity.
type CableDevice struct {
	Port  string
	Hello protocol.DeviceHello
}

// DiscoverVibeTVs returns every Cable-capable VibeTV that answers hello. A
// foreign serial device is reported only when no VibeTV answered, so it cannot
// enter the selectable device list or hide valid VibeTVs.
func DiscoverVibeTVs(ctx context.Context) ([]CableDevice, error) {
	ctx, cancel := context.WithTimeout(ctx, helloReadWindow)
	defer cancel()
	ports, err := ListPorts()
	if err != nil {
		return nil, err
	}
	// Keep the active worker's serial ownership stable during the scan. Each
	// other port gets an independent sender, so silent adapters cannot consume
	// consecutive boot windows or reset the connected device repeatedly.
	for !defaultSender.mu.TryLock() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
	defer defaultSender.mu.Unlock()
	activePath := defaultSender.path
	hasActivePort := defaultSender.port != nil
	return discoverVibeTVs(ports, func(path string) (protocol.DeviceHello, error) {
		if samePort(path, activePath) && hasActivePort {
			return defaultSender.deviceHelloLocked(ctx, path, defaultSender.helloWindow)
		}
		sender := NewSender()
		defer sender.Close()
		return sender.deviceHelloLocked(ctx, path, sender.helloWindow)
	}, runtime.GOOS)
}

func discoverVibeTVs(
	ports []string,
	readHello func(string) (protocol.DeviceHello, error),
	goos string,
) ([]CableDevice, error) {
	devices := make([]CableDevice, 0)
	foreignDeviceAnswered := false
	var legacy *LegacyCableFirmwareError
	seen := make(map[string]struct{})
	type probeResult struct {
		port  string
		hello protocol.DeviceHello
		err   error
	}
	candidates := cableSerialCandidates(ports, goos)
	results := make(chan probeResult, len(candidates))
	for _, port := range candidates {
		go func() {
			hello, err := readHello(port)
			results <- probeResult{port, hello, err}
		}()
	}
	for range candidates {
		result := <-results
		port, hello, err := result.port, result.hello, result.err
		if err != nil {
			continue
		}
		hello = hello.Normalize()
		if hello.Kind == "hello" && strings.TrimSpace(hello.Board) != "" &&
			!isSupportedCableBoard(hello.Board) {
			foreignDeviceAnswered = true
			continue
		}
		if isLegacyCableHello(hello) {
			legacy = legacy.remember(hello)
			continue
		}
		mode := strings.ToLower(strings.TrimSpace(hello.Capabilities.Transport.Mode))
		if hello.Kind != "hello" || !isSupportedCableBoard(hello.Board) ||
			strings.TrimSpace(hello.DeviceID) == "" ||
			!strings.EqualFold(hello.Capabilities.Transport.Active, "usb") ||
			(mode != "cable" && mode != "wifi" && mode != "legacy-wifi-only") {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(hello.DeviceID))
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		devices = append(devices, CableDevice{Port: port, Hello: hello})
	}
	sort.Slice(devices, func(i, j int) bool {
		return strings.ToLower(devices[i].Hello.DeviceID) < strings.ToLower(devices[j].Hello.DeviceID)
	})
	if len(devices) == 0 && foreignDeviceAnswered {
		return nil, wrapTransportError(
			errcode.TransportForeignDevice,
			"discover-vibetvs",
			"",
			"Disconnect the other serial device and connect VibeTV with a data-capable Cable.",
			errors.New("a non-VibeTV serial device answered hello"),
		)
	}
	if len(devices) == 0 && legacy != nil {
		return nil, wrapTransportError(
			errcode.TransportCableFirmwareTooOld,
			"discover-vibetvs",
			"",
			"Update VibeTV over WiFi first, then reconnect the Cable.",
			legacy,
		)
	}
	return devices, nil
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
		if candidate == "" || (!strings.Contains(lower, "usb") && !(goos == "windows" && isCOMPortName(candidate))) {
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
	foreignDeviceAnswered := false
	var legacy *LegacyCableFirmwareError
	// Issue #529: a port another program holds was not asked. When that is
	// true of every port, "no VibeTV answered" would be a claim about devices
	// nobody spoke to, so the open error is the answer.
	var openErr error
	asked := false
	for _, candidate := range candidates {
		hello, err := readHello(candidate)
		if err != nil {
			if errcode.Of(err) == errcode.TransportSerialOpen {
				openErr = err
			} else {
				asked = true
			}
			continue
		}
		asked = true
		hello = hello.Normalize()
		mode := hello.Capabilities.Transport.Mode
		if hello.Kind == "hello" && strings.TrimSpace(hello.Board) != "" &&
			!isSupportedCableBoard(hello.Board) {
			foreignDeviceAnswered = true
		}
		// A supported VibeTV that answers over Cable without a deviceId is
		// running firmware from before the Cable identity contract. It is a
		// genuine VibeTV, so report it as upgradable instead of silently
		// ignoring it.
		if isLegacyCableHello(hello) {
			legacy = legacy.remember(hello)
		}
		if hello.Kind != "hello" || !isSupportedCableBoard(hello.Board) ||
			hello.DeviceID == "" ||
			hello.Capabilities.Transport.Active != "usb" ||
			(mode != "cable" && (!allowWiFiMode || (mode != "wifi" && mode != "legacy-wifi-only"))) {
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
		if foreignDeviceAnswered {
			return "", wrapTransportError(
				errcode.TransportForeignDevice,
				"resolve-vibetv",
				explicit,
				"Disconnect the other serial device and connect VibeTV with a data-capable Cable.",
				errors.New("a non-VibeTV serial device answered hello"),
			)
		}
		if legacy != nil {
			return "", wrapTransportError(
				errcode.TransportCableFirmwareTooOld,
				"resolve-vibetv",
				explicit,
				"Update VibeTV over WiFi first, then reconnect the Cable.",
				legacy,
			)
		}
		if openErr != nil && !asked {
			return "", openErr
		}
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

// isLegacyCableHello reports a supported VibeTV whose firmware predates the
// Cable identity contract: it answers over USB without a deviceId.
func isLegacyCableHello(hello protocol.DeviceHello) bool {
	return hello.Kind == "hello" && isSupportedCableBoard(hello.Board) &&
		strings.TrimSpace(hello.DeviceID) == "" &&
		strings.EqualFold(hello.Capabilities.Transport.Active, "usb")
}

// LegacyCableFirmwareError is a VibeTV whose firmware predates the Cable
// identity contract, with the board and firmware its boot hello reported.
type LegacyCableFirmwareError struct {
	Board    string
	Firmware string
}

func (e *LegacyCableFirmwareError) Error() string {
	if e.Firmware == "" {
		return "VibeTV answered over Cable without a deviceId"
	}
	return fmt.Sprintf("VibeTV firmware %s answered over Cable without a deviceId", e.Firmware)
}

// remember keeps the first legacy VibeTV that answered.
func (e *LegacyCableFirmwareError) remember(hello protocol.DeviceHello) *LegacyCableFirmwareError {
	if e != nil {
		return e
	}
	return &LegacyCableFirmwareError{
		Board:    strings.TrimSpace(hello.Board),
		Firmware: strings.TrimSpace(hello.Firmware),
	}
}

// FindLegacyCableVibeTV returns the one ESP8266 VibeTV connected by Cable
// whose firmware predates the Cable identity contract. Only that device may
// receive the Cable rescue update; anything else is refused.
func FindLegacyCableVibeTV() (CableDevice, error) {
	ports, err := ListPorts()
	if err != nil {
		return CableDevice{}, err
	}
	return findLegacyCableVibeTV(cableSerialCandidates(ports, runtime.GOOS), func(path string) (protocol.DeviceHello, error) {
		sender := NewSender()
		defer sender.Close()
		return sender.DeviceHello(path)
	})
}

func findLegacyCableVibeTV(candidates []string, readHello func(string) (protocol.DeviceHello, error)) (CableDevice, error) {
	// Probe every port at once: a silent one holds its read for the whole
	// hello window, and Windows lists many COM ports that never answer.
	results := make(chan CableDevice, len(candidates))
	for _, port := range candidates {
		go func() {
			hello, err := readHello(port)
			if err != nil {
				hello = protocol.DeviceHello{}
			}
			results <- CableDevice{Port: port, Hello: hello.Normalize()}
		}()
	}
	var found []CableDevice
	for range candidates {
		device := <-results
		if isLegacyCableHello(device.Hello) && strings.EqualFold(strings.TrimSpace(device.Hello.Board), vibeTVBoardID) {
			found = append(found, device)
		}
	}
	switch len(found) {
	case 1:
		return found[0], nil
	case 0:
		return CableDevice{}, wrapTransportError(
			errcode.TransportNoMatchingDevice,
			"find-legacy-vibetv",
			"",
			"Connect the VibeTV that needs the update by Cable and retry.",
			errors.New("no VibeTV with pre-Cable firmware answered hello"),
		)
	default:
		return CableDevice{}, wrapTransportError(
			errcode.TransportMultipleDevices,
			"find-legacy-vibetv",
			"",
			"Leave exactly one VibeTV connected and retry.",
			errors.New("more than one VibeTV with pre-Cable firmware answered hello"),
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
