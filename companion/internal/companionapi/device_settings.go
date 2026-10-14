package companionapi

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type settingsResponse struct {
	OK       bool           `json:"ok"`
	Settings deviceSettings `json:"settings"`
	Device   deviceInfo     `json:"device,omitempty"`
}

type deviceSettings struct {
	Display displaySettings  `json:"display"`
	Standby *standbySettings `json:"standby,omitempty"`
}

type displaySettings struct {
	BrightnessPercent int `json:"brightnessPercent"`
}

// standbySettings mirrors the device standby block. ScreensaverPath is the
// screensaver slot: the stored ThemeSpec the device shows in standby, null
// while the slot is empty. It is a pointer so that a write can leave the slot
// untouched by omitting the field.
type standbySettings struct {
	Enabled           bool    `json:"enabled"`
	TimeoutMinutes    int     `json:"timeoutMinutes"`
	BrightnessPercent int     `json:"brightnessPercent"`
	ScreensaverPath   *string `json:"screensaverPath"`
}

func (s *Server) handleDevice(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if cfg, err := s.config(); err != nil {
		writeInternalError(w, err)
		return
	} else if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		s.firmwareUpdateStartMu.Lock()
		defer s.firmwareUpdateStartMu.Unlock()
		if _, running := s.activeFirmwareUpdateJob(); running {
			writeError(w, http.StatusConflict, "firmware_update_in_progress", "VibeTV update is still running.", "Wait for the update to finish, then try again.")
			return
		}
		if s.rejectActiveThemeInstall(w) {
			return
		}
		port, hello, ok := s.requireCableControlDevice(w, cfg)
		if !ok {
			return
		}
		device := s.cableDeviceInfo(r.Context(), cfg, hello)
		if hello.HasFeature(protocol.FeatureCableHealthV1) {
			if health, err := s.readCableHealth(port, cfg.DeviceID); err == nil {
				device = s.withVerifiedDeviceHealth(device, health, cableDeviceTarget, cfg.DeviceToken, false)
			} else {
				device = withDeviceHealthProbeError(device, err)
			}
		}
		writeJSON(w, http.StatusOK, deviceActionResponse{OK: true, Device: device})
		return
	}
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	device := s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello))
	device.Active = strings.TrimSpace(cfg.DeviceID) != "" && strings.EqualFold(cfg.DeviceID, device.DeviceID)
	if health, err := s.getHealthProbe(r.Context(), cfg.DeviceTarget, "", deviceHealthProbeTime); err == nil {
		device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, false)
	} else {
		device = withDeviceHealthProbeError(device, err)
	}
	if device.Ready {
		device.ConnectionState = deviceConnectionReady
	} else {
		device.ConnectionState = deviceConnectionRetrying
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: device})
}

func deviceSettingsFromProtocol(settings protocol.DeviceSettings) deviceSettings {
	result := deviceSettings{
		Display: displaySettings{BrightnessPercent: settings.Display.BrightnessPercent},
	}
	if settings.Standby != nil {
		result.Standby = &standbySettings{
			Enabled:           settings.Standby.Enabled,
			TimeoutMinutes:    settings.Standby.TimeoutMinutes,
			BrightnessPercent: settings.Standby.BrightnessPercent,
			ScreensaverPath:   settings.Standby.ScreensaverPath,
		}
	}
	return result
}

func settingsPatchForRequest(
	w http.ResponseWriter,
	hello protocol.DeviceHello,
	brightnessPercent int,
	displayBrightnessPercent int,
	standbyValue *standbySettings,
) (protocol.DeviceSettingsPatch, bool) {
	caps := protocol.CapabilitiesFromHello(hello)
	if standbyValue != nil {
		if caps.Known && !caps.SupportsStandby {
			writeError(w, http.StatusBadRequest, "standby_unsupported", "This VibeTV cannot show a screensaver.", "Update VibeTV, then try again.")
			return protocol.DeviceSettingsPatch{}, false
		}
		return protocol.DeviceSettingsPatch{Standby: &protocol.DeviceStandbySettings{
			Enabled:           standbyValue.Enabled,
			TimeoutMinutes:    standbyValue.TimeoutMinutes,
			BrightnessPercent: standbyValue.BrightnessPercent,
			ScreensaverPath:   standbyValue.ScreensaverPath,
		}}, true
	}
	brightness := brightnessPercent
	if brightness == 0 {
		brightness = displayBrightnessPercent
	}
	if caps.Known && !caps.SupportsBrightness {
		writeError(w, http.StatusBadRequest, "brightness_unsupported", "This VibeTV does not advertise brightness control.", "Update firmware or use a device with brightness support.")
		return protocol.DeviceSettingsPatch{}, false
	}
	minBrightness := protocol.DefaultMinBrightness
	maxBrightness := protocol.DefaultMaxBrightness
	if caps.SupportsBrightness {
		minBrightness = caps.MinBrightnessPercent
		maxBrightness = caps.MaxBrightnessPercent
	}
	if brightness < minBrightness || brightness > maxBrightness {
		writeError(w, http.StatusBadRequest, "invalid_brightness", fmt.Sprintf("Brightness must be between %d and %d.", minBrightness, maxBrightness), "Choose a supported brightness value and retry.")
		return protocol.DeviceSettingsPatch{}, false
	}
	return protocol.DeviceSettingsPatch{BrightnessPercent: &brightness}, true
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	s.firmwareUpdateStartMu.Lock()
	defer s.firmwareUpdateStartMu.Unlock()
	if _, ok := s.activeFirmwareUpdateJob(); ok {
		writeError(w, http.StatusConflict, "firmware_update_in_progress", "VibeTV update is still running.", "Wait for the update to finish, then try again.")
		return
	}
	if s.rejectActiveThemeInstall(w) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleSettingsGet(w, r)
	case http.MethodPost:
		s.handleSettingsPost(w, r)
	default:
		writeMethodNotAllowed(w)
	}
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	if cfg, err := s.config(); err != nil {
		writeInternalError(w, err)
		return
	} else if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		port, hello, ok := s.requireCableControlDevice(w, cfg)
		if !ok {
			return
		}
		caps := protocol.CapabilitiesFromHello(hello)
		if caps.Known && !caps.SupportsBrightness && !caps.SupportsStandby {
			writeJSON(w, http.StatusOK, settingsResponse{
				OK:     true,
				Device: s.cableDeviceInfo(r.Context(), cfg, hello),
			})
			return
		}
		settings, err := s.readCableSettings(port, hello.DeviceID)
		if err != nil {
			writeError(w, http.StatusBadGateway, "settings_read_failed", "Could not read VibeTV settings.", "Keep VibeTV connected by Cable and retry.")
			return
		}
		writeJSON(w, http.StatusOK, settingsResponse{
			OK:       true,
			Settings: deviceSettingsFromProtocol(settings),
			Device:   s.cableDeviceInfo(r.Context(), cfg, hello),
		})
		return
	}
	cfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	health, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken)
	if err != nil {
		writeError(w, http.StatusBadGateway, "settings_read_failed", "Could not read VibeTV settings.", "Keep VibeTV powered on and retry.")
		return
	}
	device := s.withVerifiedDeviceHealth(
		s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello)),
		health,
		cfg.DeviceTarget,
		cfg.DeviceToken,
		false,
	)
	writeJSON(w, http.StatusOK, settingsResponse{
		OK:       true,
		Settings: health.Settings,
		Device:   device,
	})
}

func (s *Server) handleSettingsPost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		BrightnessPercent int `json:"brightnessPercent"`
		Display           struct {
			BrightnessPercent int `json:"brightnessPercent"`
		} `json:"display"`
		Standby *standbySettings `json:"standby"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" {
		port, hello, ok := s.requireCableControlDevice(w, cfg)
		if !ok {
			return
		}
		patch, ok := settingsPatchForRequest(w, hello, req.BrightnessPercent, req.Display.BrightnessPercent, req.Standby)
		if !ok {
			return
		}
		settings, err := s.writeCableSettings(port, hello.DeviceID, patch)
		if err != nil {
			writeError(w, http.StatusBadGateway, "settings_write_failed", "Could not update VibeTV settings.", "Keep VibeTV connected by Cable and retry.")
			return
		}
		writeJSON(w, http.StatusOK, settingsResponse{
			OK:       true,
			Settings: deviceSettingsFromProtocol(settings),
			Device:   s.cableDeviceInfo(r.Context(), cfg, hello),
		})
		return
	}
	wifiCfg, hello, ok := s.requireDevice(w, r)
	if !ok {
		return
	}
	cfg = wifiCfg
	patch, ok := settingsPatchForRequest(w, hello, req.BrightnessPercent, req.Display.BrightnessPercent, req.Standby)
	if !ok {
		return
	}
	form := url.Values{}
	form.Set("api", "1")
	if patch.Standby != nil {
		enabled := "0"
		if patch.Standby.Enabled {
			enabled = "1"
		}
		// The device clamps timeout and screensaver brightness and answers with
		// the stored values, so the Companion does not repeat that arithmetic.
		form.Set("sb", enabled)
		form.Set("st", strconv.Itoa(patch.Standby.TimeoutMinutes))
		form.Set("sbr", strconv.Itoa(patch.Standby.BrightnessPercent))
		// Omitting screensaverPath leaves the slot as it is; an empty string
		// clears it. The device rejects a path it has no file for.
		if patch.Standby.ScreensaverPath != nil {
			form.Set("ss", strings.TrimSpace(*patch.Standby.ScreensaverPath))
		}
	} else {
		form.Set("b", strconv.Itoa(*patch.BrightnessPercent))
	}
	settings, err := s.updateDeviceSettings(r.Context(), cfg.DeviceTarget, cfg.DeviceToken, form)
	if err != nil {
		writeError(w, http.StatusBadGateway, "settings_write_failed", "Could not update VibeTV settings.", "Keep VibeTV powered on and retry.")
		return
	}
	device := s.withDisplayStream(r.Context(), cfg.DeviceTarget, deviceFromHello(cfg.DeviceTarget, cfg.DeviceToken, hello))
	if health, err := s.getHealth(r.Context(), cfg.DeviceTarget, cfg.DeviceToken); err == nil {
		device = s.withVerifiedDeviceHealth(device, health, cfg.DeviceTarget, cfg.DeviceToken, false)
	}
	writeJSON(w, http.StatusOK, settingsResponse{
		OK:       true,
		Settings: settings,
		Device:   device,
	})
}

func (s *Server) updateDeviceSettings(ctx context.Context, target, token string, form url.Values) (deviceSettings, error) {
	var response struct {
		Settings deviceSettings `json:"settings"`
	}
	if err := s.doForm(ctx, target, "/api/settings", token, form, &response); err != nil {
		return deviceSettings{}, err
	}
	return response.Settings, nil
}
