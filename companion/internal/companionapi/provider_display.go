package companionapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

const (
	providerDisplayModeAutomatic = "automatic"
	providerDisplayModeFixed     = "fixed"
	providerReadinessFreshness   = 5 * time.Minute
)

type providerDisplaySelection struct {
	Mode        string   `json:"mode"`
	ProviderIDs []string `json:"providerIds"`
	Configured  bool     `json:"configured"`
	Valid       bool     `json:"valid"`
}

type providerDisplayResponse struct {
	OK        bool                     `json:"ok"`
	Selection providerDisplaySelection `json:"selection"`
}

type setupProgress struct {
	ProviderSelectionRequired bool `json:"providerSelectionRequired"`
	ProviderSelectionComplete bool `json:"providerSelectionComplete"`
}

type providerSetupCompleteResponse struct {
	OK    bool          `json:"ok"`
	Setup setupProgress `json:"setup"`
}

func setupProgressForConfig(cfg runtimeconfig.Config) setupProgress {
	complete := cfg.ProviderSelectionSetupIsComplete()
	return setupProgress{
		ProviderSelectionRequired: !complete,
		ProviderSelectionComplete: complete,
	}
}

func (s *Server) handleProviderDisplay(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.handleProviderDisplayGet(w, r)
	case http.MethodPatch:
		s.handleProviderDisplayPatch(w, r)
	default:
		requireMethod(w, r, http.MethodGet, http.MethodPatch)
	}
}

func (s *Server) handleProviderDisplayGet(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	settings, err := s.cachedProviderSettings(r.Context(), false)
	if err != nil {
		writePreferencesReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, providerDisplayResponse{
		OK:        true,
		Selection: effectiveProviderDisplay(cfg, settings),
	})
}

func (s *Server) handleProviderDisplayPatch(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Mode        string   `json:"mode"`
		ProviderIDs []string `json:"providerIds"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	selection := providerDisplaySelection{
		Mode:        strings.TrimSpace(strings.ToLower(request.Mode)),
		ProviderIDs: normalizeProviderIDs(request.ProviderIDs),
		Configured:  true,
	}
	settings, err := s.cachedProviderSettings(r.Context(), false)
	if err != nil {
		writePreferencesReadError(w, err)
		return
	}
	if code, message, nextAction := validateProviderDisplay(selection, settings); code != "" {
		writeError(w, http.StatusConflict, code, message, nextAction)
		return
	}
	selection.Valid = true
	_, err = s.updateConfig(func(cfg *runtimeconfig.Config) {
		cfg.ProviderDisplay = &runtimeconfig.ProviderDisplayConfig{
			Mode:        selection.Mode,
			ProviderIDs: append([]string(nil), selection.ProviderIDs...),
		}
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
	writeJSON(w, http.StatusOK, providerDisplayResponse{OK: true, Selection: selection})
}

func (s *Server) handleProviderSetupComplete(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	settings, err := s.cachedProviderSettings(r.Context(), true)
	if err != nil {
		writePreferencesReadError(w, err)
		return
	}
	enabled := make([]codexbar.ProviderSetting, 0, len(settings))
	for _, setting := range settings {
		if setting.Enabled {
			enabled = append(enabled, setting)
		}
	}
	if len(enabled) == 0 {
		writeError(w, http.StatusConflict, "provider_required", "Choose at least one AI provider.", "Turn on a provider, then wait for the check to finish.")
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	selection := effectiveProviderDisplay(cfg, settings)
	if !selection.Valid {
		writeError(w, http.StatusConflict, "provider_display_invalid", "Choose which provider VibeTV should show.", "Select one provider or add providers to Automatic mode.")
		return
	}
	now := s.currentTime().UTC()
	selected := make(map[string]struct{}, len(selection.ProviderIDs))
	for _, providerID := range selection.ProviderIDs {
		selected[providerID] = struct{}{}
	}
	for _, setting := range enabled {
		if _, ok := selected[setting.ID]; !ok {
			writeError(w, http.StatusConflict, "provider_display_incomplete", "Every enabled provider must be included for display.", "Add this provider to Automatic mode, select it in Always show, or turn it off.")
			return
		}
		if !s.providerHasFreshReadiness(setting.ID, now) {
			writeError(w, http.StatusConflict, "provider_check_required", "Every enabled provider must be ready.", "Check each enabled provider and fix or turn off any provider that needs attention.")
			return
		}
	}
	cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
		current.SetProviderSelectionSetupComplete(true)
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, providerSetupCompleteResponse{OK: true, Setup: setupProgressForConfig(cfg)})
}

func effectiveProviderDisplay(cfg runtimeconfig.Config, settings []codexbar.ProviderSetting) providerDisplaySelection {
	selection := providerDisplaySelection{Mode: providerDisplayModeAutomatic}
	if cfg.ProviderDisplay == nil {
		for _, setting := range settings {
			if setting.Enabled {
				selection.ProviderIDs = append(selection.ProviderIDs, setting.ID)
			}
		}
	} else {
		selection.Configured = true
		selection.Mode = cfg.ProviderDisplay.Mode
		selection.ProviderIDs = append([]string(nil), cfg.ProviderDisplay.ProviderIDs...)
	}
	selection.ProviderIDs = normalizeProviderIDs(selection.ProviderIDs)
	code, _, _ := validateProviderDisplay(selection, settings)
	selection.Valid = code == ""
	return selection
}

func validateProviderDisplay(selection providerDisplaySelection, settings []codexbar.ProviderSetting) (string, string, string) {
	switch selection.Mode {
	case providerDisplayModeAutomatic:
		if len(selection.ProviderIDs) == 0 {
			return "provider_display_empty", "Automatic mode needs at least one provider.", "Choose a provider for automatic display."
		}
	case providerDisplayModeFixed:
		if len(selection.ProviderIDs) != 1 {
			return "provider_display_fixed_invalid", "Always show needs one provider.", "Choose exactly one provider to show."
		}
	default:
		return "provider_display_mode_invalid", "This display mode is not available.", "Choose Always show or Automatic."
	}
	available := make(map[string]bool, len(settings))
	for _, setting := range settings {
		available[setting.ID] = setting.Enabled
	}
	for _, providerID := range selection.ProviderIDs {
		enabled, exists := available[providerID]
		if !exists {
			return "provider_display_unknown", "This provider is no longer available.", "Refresh providers and choose another one."
		}
		if !enabled {
			return "provider_display_disabled", "A displayed provider is turned off.", "Turn it on or choose another displayed provider."
		}
	}
	return "", "", ""
}

func normalizeProviderIDs(providerIDs []string) []string {
	seen := make(map[string]struct{}, len(providerIDs))
	normalized := make([]string, 0, len(providerIDs))
	for _, raw := range providerIDs {
		providerID := strings.TrimSpace(strings.ToLower(raw))
		if providerID == "" {
			continue
		}
		if _, ok := seen[providerID]; ok {
			continue
		}
		seen[providerID] = struct{}{}
		normalized = append(normalized, providerID)
	}
	return normalized
}

func providerDisplayContains(cfg runtimeconfig.Config, settings []codexbar.ProviderSetting, providerID string) bool {
	providerID = strings.TrimSpace(strings.ToLower(providerID))
	for _, selected := range effectiveProviderDisplay(cfg, settings).ProviderIDs {
		if selected == providerID {
			return true
		}
	}
	return false
}
