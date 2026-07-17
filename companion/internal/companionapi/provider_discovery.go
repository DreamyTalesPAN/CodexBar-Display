package companionapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

const (
	providerDiscoverySchema  = 1
	providerStateScanning    = "scanning"
	providerStateReady       = "ready"
	providerStateSetup       = "setup_required"
	providerStateError       = "error"
	providerDiscoveryTimeout = 70 * time.Second
)

type providerStatusInfo struct {
	State           string   `json:"state"`
	CodexBarVersion string   `json:"codexBarVersion,omitempty"`
	Providers       []string `json:"providers"`
	Message         string   `json:"message"`
}

type providerDiscoveryMarker struct {
	SchemaVersion   int      `json:"schemaVersion"`
	CodexBarVersion string   `json:"codexBarVersion"`
	Providers       []string `json:"providers"`
	CompletedAt     string   `json:"completedAt"`
}

func installedCodexBarVersion(ctx context.Context) (string, error) {
	bin, err := codexbar.FindBinary()
	if err != nil {
		return "", err
	}
	return codexbar.InstalledVersion(ctx, bin)
}

func (s *Server) providerStatusSnapshot() providerStatusInfo {
	s.providerMu.RLock()
	defer s.providerMu.RUnlock()
	status := s.providerStatus
	status.Providers = append([]string(nil), status.Providers...)
	return status
}

func (s *Server) setProviderStatus(status providerStatusInfo) {
	status.Providers = normalizedProviderIDs(status.Providers)
	s.providerMu.Lock()
	s.providerStatus = status
	s.providerMu.Unlock()
}

func (s *Server) startProviderDiscovery(force bool) bool {
	s.providerMu.Lock()
	if s.providerDiscoveryBusy {
		s.providerMu.Unlock()
		return false
	}
	s.providerDiscoveryBusy = true
	s.providerStatus.State = providerStateScanning
	s.providerStatus.Message = "Finding your AI tools."
	s.providerMu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), providerDiscoveryTimeout)
		defer cancel()
		s.runProviderDiscovery(ctx, force)
		s.providerMu.Lock()
		s.providerDiscoveryBusy = false
		s.providerMu.Unlock()
	}()
	return true
}

func (s *Server) runProviderDiscovery(ctx context.Context, force bool) {
	version, err := s.providerVersion(ctx)
	if err != nil {
		s.setProviderStatus(providerStatusInfo{
			State:     providerStateError,
			Providers: []string{},
			Message:   "VibeTV could not check your AI tools.",
		})
		return
	}

	if !force {
		if marker, ok := s.loadProviderDiscoveryMarker(); ok &&
			marker.SchemaVersion == providerDiscoverySchema &&
			marker.CodexBarVersion == version {
			if parsed, fetchErr := s.fetchUsage(ctx); fetchErr == nil && len(parsed) > 0 {
				s.setProviderStatus(providerReadyStatus(version, parsed))
				return
			}
		}
	}

	parsed, err := s.discoverProviders(ctx)
	if err != nil || len(parsed) == 0 {
		state := providerStateError
		message := "VibeTV could not check your AI tools."
		if err == nil || errors.Is(err, codexbar.ErrNoProviders) ||
			codexbar.FetchErrorKindOf(err) == codexbar.FetchErrorNoProviders ||
			codexbar.FetchErrorKindOf(err) == codexbar.FetchErrorCommand {
			state = providerStateSetup
			message = "Sign in to your AI tool, then check again."
		}
		s.setProviderStatus(providerStatusInfo{
			State:           state,
			CodexBarVersion: version,
			Providers:       []string{},
			Message:         message,
		})
		return
	}

	status := providerReadyStatus(version, parsed)
	if err := s.saveProviderDiscoveryMarker(providerDiscoveryMarker{
		SchemaVersion:   providerDiscoverySchema,
		CodexBarVersion: version,
		Providers:       status.Providers,
		CompletedAt:     s.currentTime().UTC().Format(time.RFC3339Nano),
	}); err != nil {
		s.setProviderStatus(providerStatusInfo{
			State:           providerStateError,
			CodexBarVersion: version,
			Providers:       status.Providers,
			Message:         "Your AI tools were found, but setup could not be saved.",
		})
		return
	}
	s.setProviderStatus(status)
}

func providerReadyStatus(version string, parsed []codexbar.ParsedFrame) providerStatusInfo {
	return providerStatusInfo{
		State:           providerStateReady,
		CodexBarVersion: version,
		Providers:       parsedProviderIDs(parsed),
		Message:         "AI tools found.",
	}
}

func parsedProviderIDs(parsed []codexbar.ParsedFrame) []string {
	providers := make([]string, 0, len(parsed))
	for _, item := range parsed {
		provider := strings.TrimSpace(strings.ToLower(item.Provider))
		if provider == "" {
			provider = strings.TrimSpace(strings.ToLower(item.Frame.Provider))
		}
		if provider != "" {
			providers = append(providers, provider)
		}
	}
	return normalizedProviderIDs(providers)
}

func normalizedProviderIDs(providers []string) []string {
	seen := make(map[string]struct{}, len(providers))
	result := make([]string, 0, len(providers))
	for _, provider := range providers {
		provider = strings.TrimSpace(strings.ToLower(provider))
		if provider == "" {
			continue
		}
		if _, ok := seen[provider]; ok {
			continue
		}
		seen[provider] = struct{}{}
		result = append(result, provider)
	}
	sort.Strings(result)
	return result
}

func (s *Server) handleProviderDiscover(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	s.startProviderDiscovery(true)
	writeJSON(w, http.StatusAccepted, struct {
		OK       bool               `json:"ok"`
		Provider providerStatusInfo `json:"provider"`
	}{
		OK:       true,
		Provider: s.providerStatusSnapshot(),
	})
}

func (s *Server) providerDiscoveryMarkerPath() string {
	return filepath.Join(s.home, "Library", "Application Support", "codexbar-display", "provider-discovery.json")
}

func (s *Server) loadProviderDiscoveryMarker() (providerDiscoveryMarker, bool) {
	var marker providerDiscoveryMarker
	data, err := os.ReadFile(s.providerDiscoveryMarkerPath())
	if err != nil || json.Unmarshal(data, &marker) != nil {
		return providerDiscoveryMarker{}, false
	}
	marker.Providers = normalizedProviderIDs(marker.Providers)
	if marker.SchemaVersion <= 0 || strings.TrimSpace(marker.CodexBarVersion) == "" || len(marker.Providers) == 0 {
		return providerDiscoveryMarker{}, false
	}
	return marker, true
}

func (s *Server) saveProviderDiscoveryMarker(marker providerDiscoveryMarker) error {
	path := s.providerDiscoveryMarkerPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create provider discovery directory: %w", err)
	}
	data, err := json.MarshalIndent(marker, "", "  ")
	if err != nil {
		return fmt.Errorf("encode provider discovery marker: %w", err)
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(filepath.Dir(path), ".provider-discovery-*.tmp")
	if err != nil {
		return fmt.Errorf("create provider discovery marker: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("protect provider discovery marker: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write provider discovery marker: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync provider discovery marker: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close provider discovery marker: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace provider discovery marker: %w", err)
	}
	return nil
}
