package companionapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

const (
	providerPreferencePrefix = "codexbar.providers."
	providerPreferenceSuffix = ".enabled"
	providerPreferenceCache  = 10 * time.Second
)

type preferenceDescriptor struct {
	ID       string           `json:"id"`
	Section  string           `json:"section"`
	Owner    string           `json:"owner"`
	Type     string           `json:"type"`
	Label    string           `json:"label"`
	Value    any              `json:"value"`
	Writable bool             `json:"writable"`
	Health   preferenceHealth `json:"health"`
}

type preferenceHealth struct {
	State         string `json:"state"`
	Service       string `json:"service"`
	Message       string `json:"message"`
	LastSuccessAt string `json:"lastSuccessAt,omitempty"`
}

type preferencesResponse struct {
	OK    bool                   `json:"ok"`
	Items []preferenceDescriptor `json:"items"`
}

type preferenceResponse struct {
	OK   bool                 `json:"ok"`
	Item preferenceDescriptor `json:"item"`
}

type providerPreferencesState struct {
	mu     sync.Mutex
	at     time.Time
	cached []codexbar.ProviderSetting
	load   func(context.Context) ([]codexbar.ProviderSetting, error)
	set    func(context.Context, string, bool) error
}

func (s *Server) handlePreferences(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("section")) != "providers" {
		writeError(w, http.StatusBadRequest, "invalid_preference_section", "This settings section is not available.", "Open the provider settings again.")
		return
	}

	settings, err := s.cachedProviderSettings(r.Context(), false)
	if err != nil {
		writeProviderPreferencesReadError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, preferencesResponse{OK: true, Items: s.providerDescriptors(settings)})
}

func (s *Server) handlePreference(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPatch) {
		return
	}
	settingID := strings.TrimPrefix(r.URL.Path, "/v1/preferences/")
	if settingID == "" || strings.Contains(settingID, "/") {
		writePreferenceNotFound(w)
		return
	}
	var request struct {
		Value json.RawMessage `json:"value"`
	}
	if !decodeJSON(w, r, &request) {
		return
	}
	var enabled bool
	if len(request.Value) == 0 || json.Unmarshal(request.Value, &enabled) != nil {
		writeError(w, http.StatusBadRequest, "invalid_preference_value", "This setting needs an on or off value.", "Choose on or off, then try again.")
		return
	}

	s.providerPreferences.mu.Lock()
	defer s.providerPreferences.mu.Unlock()
	settings, err := s.providerSettingsLocked(r.Context(), false)
	if err != nil {
		writeProviderPreferencesReadError(w, err)
		return
	}
	providerID := ""
	for _, setting := range settings {
		if providerPreferenceID(setting.ID) == settingID {
			providerID = setting.ID
			break
		}
	}
	if providerID == "" {
		writePreferenceNotFound(w)
		return
	}
	if s.providerPreferences.set == nil || s.providerPreferences.set(r.Context(), providerID, enabled) != nil {
		writeError(w, http.StatusBadGateway, "preference_write_failed", "This provider could not be updated.", "Try again in a moment.")
		return
	}

	s.providerPreferences.cached = nil
	settings, err = s.providerSettingsLocked(r.Context(), true)
	if err != nil {
		writeProviderPreferencesReadError(w, err)
		return
	}
	for _, item := range s.providerDescriptors(settings) {
		if item.ID == settingID {
			writeJSON(w, http.StatusOK, preferenceResponse{OK: true, Item: item})
			return
		}
	}
	writePreferenceNotFound(w)
}

func (s *Server) cachedProviderSettings(ctx context.Context, force bool) ([]codexbar.ProviderSetting, error) {
	s.providerPreferences.mu.Lock()
	defer s.providerPreferences.mu.Unlock()
	return s.providerSettingsLocked(ctx, force)
}

func (s *Server) providerSettingsLocked(ctx context.Context, force bool) ([]codexbar.ProviderSetting, error) {
	now := s.currentTime().UTC()
	if !force && len(s.providerPreferences.cached) > 0 && now.Sub(s.providerPreferences.at) < providerPreferenceCache {
		return append([]codexbar.ProviderSetting(nil), s.providerPreferences.cached...), nil
	}
	settings, err := s.providerPreferences.load(ctx)
	if err != nil {
		return nil, err
	}
	s.providerPreferences.cached = append([]codexbar.ProviderSetting(nil), settings...)
	s.providerPreferences.at = now
	return append([]codexbar.ProviderSetting(nil), settings...), nil
}

func (s *Server) providerDescriptors(settings []codexbar.ProviderSetting) []preferenceDescriptor {
	lastSuccess := make(map[string]string)
	if s.loadUsage != nil {
		if usage, ok := s.loadUsage(s.currentTime().UTC()); ok {
			for _, provider := range usage.Providers {
				id := strings.TrimSpace(strings.ToLower(provider.Provider))
				if id == "" {
					id = strings.TrimSpace(strings.ToLower(provider.Frame.Provider))
				}
				if id != "" && !provider.CollectedAt.IsZero() {
					lastSuccess[id] = provider.CollectedAt.UTC().Format(time.RFC3339)
				}
			}
		}
	}

	items := make([]preferenceDescriptor, 0, len(settings))
	for _, setting := range settings {
		state := string(setting.Health)
		message := providerHealthMessage(setting.Health)
		if !setting.Enabled {
			state = "disabled"
			message = "Provider is off."
		} else if (setting.Health == codexbar.ProviderHealthUnavailable || setting.Health == codexbar.ProviderHealthChecking) && lastSuccess[setting.ID] != "" {
			state = "stale"
			message = "Live usage is unavailable; the last successful reading is still saved."
		}
		items = append(items, preferenceDescriptor{
			ID:       providerPreferenceID(setting.ID),
			Section:  "providers",
			Owner:    "codexbar",
			Type:     "boolean",
			Label:    setting.Label,
			Value:    setting.Enabled,
			Writable: true,
			Health: preferenceHealth{
				State:         state,
				Service:       string(setting.Service),
				Message:       message,
				LastSuccessAt: lastSuccess[setting.ID],
			},
		})
	}
	return items
}

func providerPreferenceID(providerID string) string {
	return providerPreferencePrefix + providerID + providerPreferenceSuffix
}

func providerHealthMessage(state codexbar.ProviderHealthState) string {
	switch state {
	case codexbar.ProviderHealthHealthy:
		return "Provider is working."
	case codexbar.ProviderHealthAuthRequired:
		return "Sign in again for this provider."
	case codexbar.ProviderHealthSetupRequired:
		return "Finish setting up this provider."
	case codexbar.ProviderHealthUnavailable:
		return "Provider is not responding right now."
	default:
		return "Checking provider status."
	}
}

func writeProviderPreferencesReadError(w http.ResponseWriter, err error) {
	if codexbar.ProviderSettingsErrorKindOf(err) == codexbar.ProviderSettingsErrorVersion {
		writeError(w, http.StatusServiceUnavailable, "provider_preferences_update_required", "Provider settings need a newer Mac App.", "Update the Mac App, then try again.")
		return
	}
	writeError(w, http.StatusServiceUnavailable, "provider_preferences_unavailable", "Provider settings are not available right now.", "Make sure the Mac App is open, then try again.")
}

func writePreferenceNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "preference_not_found", "This provider setting was not found.", "Refresh the provider list, then try again.")
}
