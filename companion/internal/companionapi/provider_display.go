package companionapi

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
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
	s.saveProviderDisplay(w, selection, settings)
}

// saveProviderDisplay checks a display choice, stores it and puts it on
// VibeTV. The Settings page and the keyboard shortcut both end here, so a
// choice made either way is the same choice.
func (s *Server) saveProviderDisplay(w http.ResponseWriter, selection providerDisplaySelection, settings []codexbar.ProviderSetting) {
	if !automaticProviderDisplayIncludesAllEnabled(selection, settings) {
		s.recordSetupEvent(setupEvent{Stage: "display_mode", Status: "failed", Message: "Every enabled provider must be included for display.", Code: "provider_display_incomplete", NextAction: "Refresh providers and save Automatic again."})
		writeError(w, http.StatusConflict, "provider_display_incomplete", "Every enabled provider must be included for display.", "Refresh providers and save Automatic again.")
		return
	}
	if code, message, nextAction := validateProviderDisplay(selection, settings); code != "" {
		s.recordSetupEvent(setupEvent{Stage: "display_mode", Status: "failed", Message: message, Code: code, NextAction: nextAction})
		writeError(w, http.StatusConflict, code, message, nextAction)
		return
	}
	selection.Valid = true
	// A provider switch saves the selection again. Only another mode or
	// another pinned provider is a change for the setup log (#579); the
	// providers Automatic switches between are logged as provider choices.
	changed := false
	_, err := s.updateConfig(func(cfg *runtimeconfig.Config) {
		stored := cfg.ProviderDisplay
		changed = stored == nil || stored.Mode != selection.Mode ||
			selection.Mode == providerDisplayModeFixed && !slices.Equal(stored.ProviderIDs, selection.ProviderIDs)
		cfg.ProviderDisplay = &runtimeconfig.ProviderDisplayConfig{
			Mode:        selection.Mode,
			ProviderIDs: append([]string(nil), selection.ProviderIDs...),
		}
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if s.renderDisplayStream != nil {
		s.renderDisplayStream()
	}
	// After a failed save the log must not end on "failed".
	if last, ok := s.timeline.Latest("display_mode"); changed || ok && last.State == "failed" {
		s.recordSetupEvent(setupEvent{Stage: "display_mode", Status: "succeeded", Message: providerDisplayMessage(selection, settings)})
	}
	writeJSON(w, http.StatusOK, providerDisplayResponse{OK: true, Selection: selection})
}

// handleProviderDisplayNext is the keyboard shortcut of the Mac App and the
// Windows App (issue #424). It pins VibeTV to the provider after the one on
// screen and saves that exactly as choosing it under Manual does, so Automatic
// does not take the screen back. The order is the provider list's and wraps
// after the last. Only providers Manual offers take part
// (setup-providers-screen.tsx setupProviderCanDisplay): switched on, in working
// order, and with a reading VibeTV can show. Fewer than two of them leave
// nothing to switch to, and the choice stays as it is.
func (s *Server) handleProviderDisplayNext(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
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
	selection := effectiveProviderDisplay(cfg, settings)
	var usage daemon.PersistedUsage
	if s.loadUsage != nil {
		usage, _ = s.loadUsage(s.currentTime().UTC())
	}
	// Automatic has no provider of its own: the one on screen is the one the
	// last frame was built from.
	shown := usage.CurrentProvider
	if selection.Mode == providerDisplayModeFixed && len(selection.ProviderIDs) == 1 {
		shown = selection.ProviderIDs[0]
	}
	// Only a reading the display worker sends to VibeTV (sendCycleResult): not a
	// retained or expired one, which the snapshot calls stale, and with usage
	// in its frame. Pinning another one would change Settings and not the
	// screen.
	readable := make(map[string]bool, len(usage.Providers))
	for _, snapshot := range usage.Providers {
		if info, ok := usageProviderFromSnapshot(snapshot); ok {
			readable[info.ID] = !info.UsageUnavailable && !snapshot.Frame.UsageUnavailable
		}
	}
	var eligible []string
	next := 0
	for _, descriptor := range s.providerDescriptors(settings) {
		if !providerCanDisplay(descriptor) || !readable[descriptor.ProviderID] {
			continue
		}
		if descriptor.ProviderID == shown {
			next = len(eligible) + 1
		}
		eligible = append(eligible, descriptor.ProviderID)
	}
	if len(eligible) < 2 {
		writeJSON(w, http.StatusOK, providerDisplayResponse{OK: true, Selection: selection})
		return
	}
	s.saveProviderDisplay(w, providerDisplaySelection{
		Mode:        providerDisplayModeFixed,
		ProviderIDs: []string{eligible[next%len(eligible)]},
		Configured:  true,
	}, settings)
}

// providerDisplayMessage names the saved display choice in the customer's words.
func providerDisplayMessage(selection providerDisplaySelection, settings []codexbar.ProviderSetting) string {
	if selection.Mode == providerDisplayModeAutomatic {
		return "Automatic: VibeTV switches between your providers."
	}
	name := "the chosen provider"
	for _, setting := range settings {
		if len(selection.ProviderIDs) == 1 && setting.ID == selection.ProviderIDs[0] && setting.Label != "" {
			name = setting.Label
		}
	}
	return "Always show " + name + "."
}

func (s *Server) handleProviderSetupComplete(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	// Continue accepts the same fresh descriptors that opened the button in the
	// provider list. Forcing another CodexBar read here repeated the full scan,
	// left the button pending, and could contradict the answer still on screen.
	settings, err := s.cachedProviderSettings(r.Context(), false)
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
	selected := make(map[string]struct{}, len(selection.ProviderIDs))
	for _, providerID := range selection.ProviderIDs {
		selected[providerID] = struct{}{}
	}
	// Only the Automatic pool has to name every enabled provider: it is the set
	// VibeTV rotates through, so one left out of it is collected and never
	// shown. "Always show one" names exactly one provider by definition.
	// Setup is complete once VibeTV has something real to show, which is one
	// working provider -- the rule docs/control-center-ui-principles.md has
	// carried all along. Demanding every enabled one instead handed a customer
	// whose second provider was merely not signed in a wizard they could not
	// leave, on a Mac whose first provider was working: the rotation already
	// skips what it cannot read (daemon.go preferAvailableProviders), so the
	// broken one costs nothing but the refusal did.
	if !automaticProviderDisplayIncludesAllEnabled(selection, settings) {
		writeError(w, http.StatusConflict, "provider_display_incomplete", "Every enabled provider must be included for display.", "Add this provider to Automatic mode, select it in Always show, or turn it off.")
		return
	}
	// What VibeTV will actually show, beside what merely works somewhere.
	readyShown := 0
	readyAnywhere := 0
	for _, descriptor := range s.providerDescriptors(settings) {
		if !providerCanDisplay(descriptor) {
			continue
		}
		readyAnywhere++
		if _, shown := selected[descriptor.ProviderID]; shown {
			readyShown++
		}
	}
	if readyShown == 0 {
		// Something works, but not what VibeTV was told to show. Any healthy
		// provider used to be enough, so a Mac pinned to a provider that had
		// since been signed out finished setup on the strength of one it had
		// been told never to show, and the customer reached the live step in
		// front of a blank VibeTV: a fixed selection pins without fallback
		// (daemon.go applyProviderDisplaySelection). The two counts can only
		// differ for a fixed selection -- the pool loop above requires every
		// enabled provider to be in an Automatic pool, and validateProviderDisplay
		// requires every selected one to be enabled -- so Automatic keeps the
		// refusal it had. It is also the display choice, not the provider, that
		// this names: without another provider to show instead, the display step
		// would have nothing to offer and the provider step owns the fix.
		if readyAnywhere > 0 {
			writeError(w, http.StatusConflict, "provider_display_not_ready", "The provider VibeTV shows is not ready.", "Show a different provider, or switch to Automatic.")
			return
		}
		writeError(w, http.StatusConflict, "provider_check_required", "At least one enabled provider must be ready.", "Check your providers and fix or turn off any provider that needs attention.")
		return
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

// providerCanDisplay reports whether a provider row is switched on and in
// working order. A saved reading counts too: it is still a real reading, and it
// is the same rule setup-providers-screen.tsx setupProviderCanDisplay uses to
// decide what may be pinned. Refusing at the end of setup what the display step
// still offers would be a loop with no way out.
func providerCanDisplay(descriptor preferenceDescriptor) bool {
	on, _ := descriptor.Value.(bool)
	return on && descriptor.Health != nil &&
		(descriptor.Health.State == string(codexbar.ProviderHealthHealthy) ||
			descriptor.Health.State == providerHealthStateStale)
}

func effectiveProviderDisplay(cfg runtimeconfig.Config, settings []codexbar.ProviderSetting) providerDisplaySelection {
	selection := providerDisplaySelection{Mode: providerDisplayModeAutomatic}
	if cfg.ProviderDisplay == nil {
		for _, setting := range settings {
			if setting.Enabled {
				selection.ProviderIDs = append(selection.ProviderIDs, setting.ID)
			}
		}
		// An install from before this choice existed is already set up and
		// working, and the pool synthesised above is exactly what choosing
		// Automatic would write. Reporting it as still to be made sent every
		// such customer through the wizard on the update that adds the step.
		selection.Configured = cfg.ProviderDisplayPredatesSetup()
	} else {
		selection.Configured = true
		selection.Mode = cfg.ProviderDisplay.Mode
		selection.ProviderIDs = append([]string(nil), cfg.ProviderDisplay.ProviderIDs...)
	}
	if selection.Mode == providerDisplayModeAutomatic {
		selection.ProviderIDs = selection.ProviderIDs[:0]
		for _, setting := range settings {
			if setting.Enabled {
				selection.ProviderIDs = append(selection.ProviderIDs, setting.ID)
			}
		}
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

func automaticProviderDisplayIncludesAllEnabled(selection providerDisplaySelection, settings []codexbar.ProviderSetting) bool {
	if selection.Mode != providerDisplayModeAutomatic {
		return true
	}
	selected := make(map[string]struct{}, len(selection.ProviderIDs))
	for _, providerID := range selection.ProviderIDs {
		selected[providerID] = struct{}{}
	}
	for _, setting := range settings {
		if _, ok := selected[setting.ID]; setting.Enabled && !ok {
			return false
		}
	}
	return true
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
