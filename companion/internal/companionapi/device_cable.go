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

// halfWrittenRescueEntry is the VibeTV a failed Cable rescue left without
// bootable firmware, while its marked port is still connected. Only the rescue
// update reaches it, through the ROM loader on that port.
func (s *Server) halfWrittenRescueEntry() (deviceSearchEntry, bool) {
	marker, ok := firmwareupdate.LoadRescueMarker(s.home, time.Now())
	if !ok || s.listCablePorts == nil {
		return deviceSearchEntry{}, false
	}
	ports, err := s.listCablePorts()
	if err != nil || !slices.ContainsFunc(ports, func(port string) bool {
		return strings.EqualFold(strings.TrimSpace(port), strings.TrimSpace(marker.Port))
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
