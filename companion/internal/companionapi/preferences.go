package companionapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	preferenceSchemaVersion  = 1
)

var providerUsageInventoryTimeout = 2 * time.Second

type preferenceType string

const (
	preferenceTypeBoolean  preferenceType = "boolean"
	preferenceTypeEnum     preferenceType = "enum"
	preferenceTypeInteger  preferenceType = "integer"
	preferenceTypeDuration preferenceType = "duration"
	preferenceTypeString   preferenceType = "string"
	preferenceTypeSecret   preferenceType = "secret"
	preferenceTypeAction   preferenceType = "action"
)

type preferenceOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type preferenceConstraints struct {
	Min  *int64 `json:"min,omitempty"`
	Max  *int64 `json:"max,omitempty"`
	Step *int64 `json:"step,omitempty"`
	Unit string `json:"unit,omitempty"`
}

type preferenceAvailability struct {
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
}

type preferenceDescriptor struct {
	ID                 string                 `json:"id"`
	Section            string                 `json:"section"`
	Owner              string                 `json:"owner"`
	Type               preferenceType         `json:"type"`
	Label              string                 `json:"label"`
	Value              any                    `json:"value"`
	EffectiveValue     any                    `json:"effectiveValue"`
	AllowsDefault      bool                   `json:"allowsDefault"`
	Options            []preferenceOption     `json:"options,omitempty"`
	Constraints        *preferenceConstraints `json:"constraints,omitempty"`
	Availability       preferenceAvailability `json:"availability"`
	RequiredCapability string                 `json:"requiredCapability,omitempty"`
	WriteStrategy      string                 `json:"writeStrategy"`
	Writable           bool                   `json:"writable"`
	SecretState        string                 `json:"secretState,omitempty"`
	Health             *preferenceHealth      `json:"health,omitempty"`
}

type preferenceHealth struct {
	State         string `json:"state"`
	Service       string `json:"service"`
	Message       string `json:"message"`
	LastSuccessAt string `json:"lastSuccessAt,omitempty"`
}

type preferencesResponse struct {
	OK            bool                   `json:"ok"`
	SchemaVersion int                    `json:"schemaVersion"`
	Items         []preferenceDescriptor `json:"items"`
}

type preferenceResponse struct {
	OK   bool                 `json:"ok"`
	Item preferenceDescriptor `json:"item"`
}

// preferenceAdapter is the extension boundary for #183. New setting owners
// register descriptors and writes here; the HTTP routes and validation stay
// unchanged.
type preferenceAdapter interface {
	Section() string
	Owns(string) bool
	List(context.Context) ([]preferenceDescriptor, error)
	Write(context.Context, string, any) (preferenceDescriptor, error)
}

type providerPreferencesState struct {
	mu            sync.Mutex
	at            time.Time
	cached        []codexbar.ProviderSetting
	load          func(context.Context) ([]codexbar.ProviderSetting, error)
	set           func(context.Context, string, bool) error
	verify        func(context.Context, string, string) codexbar.ProviderSetup
	inventoryMu   sync.Mutex
	inventoryAt   time.Time
	inventory     []codexbar.ProviderSetting
	loadInventory func(context.Context) ([]codexbar.ProviderSetting, error)
}

type providerPreferenceAdapter struct {
	server *Server
}

func (providerPreferenceAdapter) Section() string { return "providers" }

func (providerPreferenceAdapter) Owns(settingID string) bool {
	return strings.HasPrefix(settingID, providerPreferencePrefix) &&
		strings.HasSuffix(settingID, providerPreferenceSuffix)
}

func (a providerPreferenceAdapter) List(ctx context.Context) ([]preferenceDescriptor, error) {
	settings, err := a.server.cachedProviderSettings(ctx, false)
	if err != nil {
		return nil, err
	}
	return a.server.providerDescriptors(settings), nil
}

func (a providerPreferenceAdapter) Write(ctx context.Context, settingID string, value any) (preferenceDescriptor, error) {
	enabled, ok := value.(bool)
	if !ok {
		return preferenceDescriptor{}, errors.New("provider preference requires boolean")
	}

	a.server.providerPreferences.mu.Lock()
	defer a.server.providerPreferences.mu.Unlock()
	settings, err := a.server.providerSettingsLocked(ctx, false)
	if err != nil {
		return preferenceDescriptor{}, err
	}
	providerID := ""
	for _, setting := range settings {
		if providerPreferenceID(setting.ID) == settingID {
			providerID = setting.ID
			break
		}
	}
	if providerID == "" {
		return preferenceDescriptor{}, errPreferenceNotFound
	}
	if a.server.providerPreferences.set == nil {
		return preferenceDescriptor{}, errors.New("provider preference writer unavailable")
	}
	if err := a.server.providerPreferences.set(ctx, providerID, enabled); err != nil {
		return preferenceDescriptor{}, err
	}
	for i := range settings {
		if settings[i].ID == providerID {
			settings[i].Enabled = enabled
			break
		}
	}
	a.server.providerPreferences.cached = append([]codexbar.ProviderSetting(nil), settings...)
	a.server.providerPreferences.at = a.server.currentTime().UTC()
	a.server.cacheProviderInventory(settings)
	a.server.invalidateUsageCache()
	if !enabled {
		settings, err = a.server.providerSettingsLocked(ctx, true)
		if err != nil {
			return preferenceDescriptor{}, err
		}
		if a.server.wakeDisplayStream != nil {
			a.server.wakeDisplayStream()
		}
		for _, item := range a.server.providerDescriptors(settings) {
			if item.ID == settingID {
				return item, nil
			}
		}
		return preferenceDescriptor{}, errPreferenceNotFound
	}

	var exactReadiness *codexbar.ProviderReadiness
	// The provider preference PATCH is the customer-facing activation/retry
	// path. Verify only the provider that was enabled; another healthy
	// provider must not make this one appear ready.
	if a.server.providerPreferences.verify != nil {
		setup := a.server.providerPreferences.verify(ctx, a.server.home, providerID)
		for i := range setup.Providers {
			if setup.Providers[i].ID == providerID {
				exactReadiness = &setup.Providers[i]
				break
			}
		}
	}

	settings, err = a.server.providerSettingsLocked(ctx, true)
	if err != nil {
		return preferenceDescriptor{}, err
	}
	if exactReadiness != nil {
		for i := range settings {
			if settings[i].ID != providerID {
				continue
			}
			settings[i].Health = providerHealthFromReadiness(exactReadiness.Status)
			break
		}
		a.server.providerPreferences.cached = append([]codexbar.ProviderSetting(nil), settings...)
		if exactReadiness.Status == codexbar.ProviderReady && a.server.wakeDisplayStream != nil {
			a.server.wakeDisplayStream()
		}
	}
	for _, item := range a.server.providerDescriptors(settings) {
		if item.ID == settingID {
			return item, nil
		}
	}
	return preferenceDescriptor{}, errPreferenceNotFound
}

func providerHealthFromReadiness(status string) codexbar.ProviderHealthState {
	switch status {
	case codexbar.ProviderReady:
		return codexbar.ProviderHealthHealthy
	case codexbar.ProviderAuthRequired:
		return codexbar.ProviderHealthAuthRequired
	case codexbar.ProviderNotConfigured, codexbar.ProviderConfigError:
		return codexbar.ProviderHealthSetupRequired
	default:
		return codexbar.ProviderHealthUnavailable
	}
}

var errPreferenceNotFound = errors.New("preference not found")

func (s *Server) preferenceRegistry() []preferenceAdapter {
	if len(s.preferenceAdapters) > 0 {
		return s.preferenceAdapters
	}
	return []preferenceAdapter{providerPreferenceAdapter{server: s}}
}

func (s *Server) handlePreferences(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	section := strings.TrimSpace(r.URL.Query().Get("section"))
	items := make([]preferenceDescriptor, 0)
	matchedSection := section == ""
	for _, adapter := range s.preferenceRegistry() {
		if section != "" && adapter.Section() != section {
			continue
		}
		matchedSection = true
		current, err := adapter.List(r.Context())
		if err != nil {
			writePreferencesReadError(w, err)
			return
		}
		items = append(items, current...)
	}
	if !matchedSection {
		writeError(w, http.StatusBadRequest, "invalid_preference_section", "This settings section is not available.", "Open settings again.")
		return
	}
	writeJSON(w, http.StatusOK, preferencesResponse{OK: true, SchemaVersion: preferenceSchemaVersion, Items: items})
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

	for _, adapter := range s.preferenceRegistry() {
		if !adapter.Owns(settingID) {
			continue
		}
		items, err := adapter.List(r.Context())
		if err != nil {
			writePreferencesReadError(w, err)
			return
		}
		var descriptor *preferenceDescriptor
		for i := range items {
			if items[i].ID == settingID {
				descriptor = &items[i]
				break
			}
		}
		if descriptor == nil {
			writePreferenceNotFound(w)
			return
		}
		if !descriptor.Writable || descriptor.Availability.State != "available" {
			writeError(w, http.StatusConflict, "preference_unavailable", "This setting is not available right now.", "Refresh settings, then try again.")
			return
		}
		value, err := validatePreferenceValue(*descriptor, request.Value)
		if err != nil {
			writeInvalidPreferenceValue(w, descriptor.Type)
			return
		}
		updated, err := adapter.Write(r.Context(), settingID, value)
		if errors.Is(err, errPreferenceNotFound) {
			writePreferenceNotFound(w)
			return
		}
		if err != nil {
			writeError(w, http.StatusBadGateway, "preference_write_failed", "This setting could not be updated.", "Try again in a moment.")
			return
		}
		writeJSON(w, http.StatusOK, preferenceResponse{OK: true, Item: updated})
		return
	}
	writePreferenceNotFound(w)
}

func validatePreferenceValue(descriptor preferenceDescriptor, raw json.RawMessage) (any, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, errors.New("missing preference value")
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		if descriptor.AllowsDefault {
			return nil, nil
		}
		return nil, errors.New("default is not supported")
	}

	switch descriptor.Type {
	case preferenceTypeBoolean:
		var value bool
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		return value, nil
	case preferenceTypeEnum:
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		for _, option := range descriptor.Options {
			if option.Value == value {
				return value, nil
			}
		}
		return nil, errors.New("enum value is not registered")
	case preferenceTypeInteger, preferenceTypeDuration:
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		var number json.Number
		if err := decoder.Decode(&number); err != nil {
			return nil, err
		}
		value, err := number.Int64()
		if err != nil {
			return nil, err
		}
		if constraints := descriptor.Constraints; constraints != nil {
			if constraints.Min != nil && value < *constraints.Min {
				return nil, errors.New("value is below minimum")
			}
			if constraints.Max != nil && value > *constraints.Max {
				return nil, errors.New("value is above maximum")
			}
			if constraints.Step != nil && *constraints.Step > 0 {
				base := int64(0)
				if constraints.Min != nil {
					base = *constraints.Min
				}
				if (value-base)%*constraints.Step != 0 {
					return nil, errors.New("value does not match step")
				}
			}
		}
		return value, nil
	case preferenceTypeString, preferenceTypeSecret:
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, err
		}
		return value, nil
	case preferenceTypeAction:
		var trigger bool
		if err := json.Unmarshal(raw, &trigger); err != nil || !trigger {
			return nil, errors.New("action requires true")
		}
		return true, nil
	default:
		return nil, fmt.Errorf("unsupported preference type %q", descriptor.Type)
	}
}

func writeInvalidPreferenceValue(w http.ResponseWriter, settingType preferenceType) {
	message := "This setting has an invalid value."
	nextAction := "Choose a valid value, then try again."
	if settingType == preferenceTypeBoolean {
		message = "This setting needs an on or off value."
		nextAction = "Choose on or off, then try again."
	}
	writeError(w, http.StatusBadRequest, "invalid_preference_value", message, nextAction)
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
	s.cacheProviderInventory(settings)
	return append([]codexbar.ProviderSetting(nil), settings...), nil
}

func (s *Server) providerInventoryForUsage(ctx context.Context) []codexbar.ProviderSetting {
	now := s.currentTime().UTC()
	if s.providerPreferences.mu.TryLock() {
		settings := append([]codexbar.ProviderSetting(nil), s.providerPreferences.cached...)
		cachedAt := s.providerPreferences.at
		s.providerPreferences.mu.Unlock()
		if len(settings) > 0 && now.Sub(cachedAt) < providerPreferenceCache {
			return settings
		}
	}

	s.providerPreferences.inventoryMu.Lock()
	defer s.providerPreferences.inventoryMu.Unlock()
	if len(s.providerPreferences.inventory) > 0 &&
		now.Sub(s.providerPreferences.inventoryAt) < providerPreferenceCache {
		return append([]codexbar.ProviderSetting(nil), s.providerPreferences.inventory...)
	}
	if s.providerPreferences.loadInventory == nil {
		return nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, providerUsageInventoryTimeout)
	defer cancel()
	settings, err := s.providerPreferences.loadInventory(lookupCtx)
	if err != nil {
		return append([]codexbar.ProviderSetting(nil), s.providerPreferences.inventory...)
	}
	s.providerPreferences.inventory = append([]codexbar.ProviderSetting(nil), settings...)
	s.providerPreferences.inventoryAt = now
	return append([]codexbar.ProviderSetting(nil), settings...)
}

func (s *Server) cacheProviderInventory(settings []codexbar.ProviderSetting) {
	s.providerPreferences.inventoryMu.Lock()
	defer s.providerPreferences.inventoryMu.Unlock()
	s.providerPreferences.inventory = append([]codexbar.ProviderSetting(nil), settings...)
	s.providerPreferences.inventoryAt = s.currentTime().UTC()
}

func filterDisabledProviders(resp usageResponse, settings []codexbar.ProviderSetting) usageResponse {
	if len(settings) == 0 || len(resp.Providers) == 0 {
		return resp
	}

	enabled := make(map[string]struct{})
	for _, setting := range settings {
		if setting.Enabled {
			enabled[setting.ID] = struct{}{}
		}
	}

	providers := make([]usageProviderInfo, 0, len(resp.Providers))
	for _, provider := range resp.Providers {
		if _, visible := enabled[provider.ID]; !visible {
			continue
		}
		providers = append(providers, provider)
	}
	resp.Providers = providers
	if _, visible := enabled[resp.CurrentProvider]; !visible {
		resp.CurrentProvider = ""
	}
	if resp.CurrentProvider == "" && len(providers) > 0 {
		resp.CurrentProvider = providers[0].ID
	}
	resp.UsageMode = usageModeForProviders(providers)
	return resp
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
		} else if setting.Service == codexbar.ProviderServiceOutage &&
			(setting.Health == codexbar.ProviderHealthHealthy || setting.Health == codexbar.ProviderHealthChecking) {
			state = "service_outage"
			message = "This provider is reporting a service outage."
		} else if (setting.Health == codexbar.ProviderHealthUnavailable || setting.Health == codexbar.ProviderHealthChecking) && lastSuccess[setting.ID] != "" {
			state = "stale"
			message = "Live usage is unavailable; the last successful reading is still saved."
		}
		items = append(items, preferenceDescriptor{
			ID:             providerPreferenceID(setting.ID),
			Section:        "providers",
			Owner:          "codexbar",
			Type:           preferenceTypeBoolean,
			Label:          setting.Label,
			Value:          setting.Enabled,
			EffectiveValue: setting.Enabled,
			Availability:   preferenceAvailability{State: "available"},
			WriteStrategy:  "codexbar_command",
			Writable:       true,
			Health: &preferenceHealth{
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
		return "Finish setup for this provider."
	case codexbar.ProviderHealthUnavailable:
		return "Provider is not responding right now."
	default:
		return "Checking provider status."
	}
}

func writePreferencesReadError(w http.ResponseWriter, err error) {
	if codexbar.ProviderSettingsErrorKindOf(err) == codexbar.ProviderSettingsErrorVersion {
		writeError(w, http.StatusServiceUnavailable, "provider_preferences_update_required", "Provider settings need a newer Mac App.", "Update the Mac App, then try again.")
		return
	}
	writeError(w, http.StatusServiceUnavailable, "preferences_unavailable", "Settings are not available right now.", "Make sure the Mac App is open, then try again.")
}

func writePreferenceNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "preference_not_found", "This setting was not found.", "Refresh settings, then try again.")
}
