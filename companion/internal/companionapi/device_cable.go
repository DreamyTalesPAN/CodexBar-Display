package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/firmwareupdate"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

func (s *Server) requireCableControlDevice(
	w http.ResponseWriter,
	cfg runtimeconfig.Config,
) (string, protocol.DeviceHello, bool) {
	return s.requireCableDevice(w, cfg, cableHelloMatchesConfig)
}

func (s *Server) requireCableWiFiSetupDevice(
	w http.ResponseWriter,
	cfg runtimeconfig.Config,
) (string, protocol.DeviceHello, bool) {
	return s.requireCableDevice(w, cfg, cableHelloCanConfigureWiFi)
}

func (s *Server) requireCableDevice(
	w http.ResponseWriter,
	cfg runtimeconfig.Config,
	matches func(protocol.DeviceHello, string) bool,
) (string, protocol.DeviceHello, bool) {
	if s.firmwareUpdateActive.Load() {
		writeError(w, http.StatusConflict, "firmware_update_in_progress", "VibeTV update is still running.", "Wait for the update to finish, then try again.")
		return "", protocol.DeviceHello{}, false
	}
	port, hello, err := s.cableDevice(cfg, matches)
	if err == nil {
		return port, hello, true
	}
	if strings.TrimSpace(cfg.DeviceID) == "" {
		writeDeviceNotFound(w)
		return "", protocol.DeviceHello{}, false
	}
	if errcode.Of(err) != "" {
		writeCableResolutionError(w, err)
		return "", protocol.DeviceHello{}, false
	}
	writeError(w, http.StatusConflict, "cable_identity_unavailable", "The selected Cable VibeTV did not provide its current identity.", "Reconnect the Cable, wait for VibeTV to start, then retry.")
	return "", protocol.DeviceHello{}, false
}

func (s *Server) cableControlDevice(cfg runtimeconfig.Config) (string, protocol.DeviceHello, error) {
	return s.cableDevice(cfg, cableHelloMatchesConfig)
}

func (s *Server) cableDevice(
	cfg runtimeconfig.Config,
	matches func(protocol.DeviceHello, string) bool,
) (string, protocol.DeviceHello, error) {
	expectedDeviceID := strings.TrimSpace(cfg.DeviceID)
	if expectedDeviceID == "" {
		return "", protocol.DeviceHello{}, errors.New("cable device identity is unavailable")
	}
	port, err := s.resolveCablePort("", expectedDeviceID)
	if err != nil {
		return "", protocol.DeviceHello{}, err
	}
	hello, err := s.readCableHello(port)
	hello = hello.Normalize()
	if err != nil || !matches(hello, expectedDeviceID) {
		if err == nil {
			err = errors.New("cable device identity changed")
		}
		return "", protocol.DeviceHello{}, err
	}
	return port, hello, nil
}

func readCableDeviceHealth(port, deviceID string) (deviceHealth, error) {
	raw, err := usb.ReadHealth(port, deviceID)
	if err != nil {
		return deviceHealth{}, err
	}
	var health deviceHealth
	if err := json.Unmarshal(raw, &health); err != nil {
		return deviceHealth{}, fmt.Errorf("decode Cable health: %w", err)
	}
	return health, nil
}

func writeCableResolutionError(w http.ResponseWriter, err error) {
	switch errcode.Of(err) {
	case errcode.TransportMultipleDevices:
		writeError(w, http.StatusConflict, "multiple_cable_devices", "More than one VibeTV is connected by Cable.", "Leave only the VibeTV you want connected, then try again.")
	case errcode.TransportForeignDevice:
		writeError(w, http.StatusConflict, "foreign_serial_device", "The connected USB device is not a VibeTV.", "Disconnect it and connect VibeTV with a data-capable Cable.")
	case errcode.TransportCableFirmwareTooOld:
		// Setup updates this VibeTV over the Cable like any other firmware
		// update, so it gets the board and firmware to check the release with.
		failure := apiError{
			Code:       "cable_firmware_too_old",
			Message:    "Your VibeTV needs a firmware update before it can use USB-C.",
			NextAction: "Connect VibeTV to WiFi, install the update, then reconnect the cable.",
		}
		var legacy *usb.LegacyCableFirmwareError
		if errors.As(err, &legacy) {
			entry := legacyCableSearchEntry(legacy)
			failure.Device = &entry
		}
		writeJSON(w, http.StatusConflict, errorResponse{OK: false, Error: failure})
	default:
		writeError(w, http.StatusConflict, "cable_device_not_found", "Couldn’t connect via USB-C", "Set up VibeTV over WiFi and install the latest firmware — USB-C setup needs newer firmware than shipped units have. If it is already up to date, check that your cable carries data, not just power.")
	}
}

func legacyCableSearchEntry(legacy *usb.LegacyCableFirmwareError) deviceSearchEntry {
	return deviceSearchEntry{
		Target:    cableDeviceTarget,
		Transport: "cable",
		Board:     legacy.Board,
		Firmware:  legacy.Firmware,
		Rescue:    true,
	}
}

func (s *Server) cableDeviceInfo(ctx context.Context, cfg runtimeconfig.Config, hello protocol.DeviceHello) deviceInfo {
	stream := s.streamStatus(ctx, cableDeviceTarget)
	return s.withConfiguredConnectionState(cfg, withDisplayStreamInfo(deviceInfo{
		Target:       cableDeviceTarget,
		DeviceID:     hello.DeviceID,
		Board:        hello.Board,
		Firmware:     hello.Firmware,
		Active:       true,
		Paired:       strings.TrimSpace(cfg.DeviceToken) != "" || hello.Capabilities.Auth == nil,
		Capabilities: &hello.Capabilities,
	}, stream), true, false, false)
}

// movedRescueProbeBudget bounds when a moved-VibeTV search starts its next hello probe.
const movedRescueProbeBudget = 50 * time.Second

// rescueMarkerPort returns the port a pending rescue marker's VibeTV is on: the
// marked port while it is connected, else the one port it was moved to by a
// replug. Without a port no rescue write can resume. The search for a moved
// VibeTV probes new ports, so it waits while a firmware update holds them.
func (s *Server) rescueMarkerPort(marker firmwareupdate.RescueMarker) (string, bool) {
	port, present, _ := s.rescueMarkerPortProbed(marker)
	return port, present
}

// rescueMarkerPortProbed is rescueMarkerPort that also says whether the port was
// just proven silent: a moved port is only named after a full hello window on it
// stayed empty. A caller must not read that hello window a second time: two
// 30-second reads push the firmware check past the app's 45-second request limit
// (Codex on #840).
func (s *Server) rescueMarkerPortProbed(marker firmwareupdate.RescueMarker) (string, bool, bool) {
	if s.listCablePorts == nil {
		return "", false, false
	}
	ports, err := s.listCablePorts()
	if err != nil {
		return "", false, false
	}
	if slices.ContainsFunc(ports, func(port string) bool {
		return strings.EqualFold(strings.TrimSpace(port), strings.TrimSpace(marker.Port))
	}) {
		return marker.Port, true, false
	}
	if s.readCableHello == nil || s.firmwareUpdateActive.Load() {
		return "", false, false
	}
	// Each new port may wait a full hello window, and the sender reads one port at
	// a time. The probes share one budget: once it is spent a port cannot be checked,
	// and that port may be the moved VibeTV, so no port is named then.
	deadline := time.Now().Add(movedRescueProbeBudget)
	overBudget := false
	moved, found := firmwareupdate.MovedRescuePort(marker, usb.WithoutTTYAliases(ports), func(port string) (protocol.DeviceHello, error) {
		if time.Now().After(deadline) {
			overBudget = true
			// Counted as answering so it is no candidate; the result is refused below.
			return protocol.DeviceHello{DeviceID: "unprobed"}, nil
		}
		return s.readCableHello(port)
	})
	if overBudget {
		return "", false, false
	}
	return moved, found, found
}

// halfWrittenRescueEntry is the VibeTV a failed Cable rescue left without
// bootable firmware, while its marked port is still connected. Only the rescue
// update reaches it, through the ROM loader on that port.
func (s *Server) halfWrittenRescueEntry(responding []usb.CableDevice) (deviceSearchEntry, bool) {
	marker, ok := firmwareupdate.LoadRescueMarker(s.home, time.Now())
	// A marker without a chip identity is not resumed, so it is not offered
	// either (Codex on #840).
	if !ok || strings.TrimSpace(marker.ChipMAC) == "" {
		return deviceSearchEntry{}, false
	}
	port, present := s.rescueMarkerPort(marker)
	if !present {
		return deviceSearchEntry{}, false
	}
	marker.Port = port
	// A VibeTV that answers on the marked port is not half-written any more;
	// one that answers on another port is another VibeTV.
	if slices.ContainsFunc(responding, func(device usb.CableDevice) bool {
		return strings.EqualFold(strings.TrimSpace(device.Port), strings.TrimSpace(marker.Port))
	}) {
		return deviceSearchEntry{}, false
	}
	// An entry the rescue cannot start (image deleted or changed) would only
	// lead the customer in a circle.
	if !firmwareupdate.RescueImageIntact(marker) {
		return deviceSearchEntry{}, false
	}
	return deviceSearchEntry{
		Target:    cableDeviceTarget,
		Transport: "cable",
		Board:     marker.Board,
		Firmware:  marker.Firmware,
		Rescue:    true,
	}, true
}
