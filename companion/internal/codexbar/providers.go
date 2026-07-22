package codexbar

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const minProviderSettingsVersion = "0.27.0"

var runProviderCommandFn = runUsageCommand

type ProviderHealthState string

const (
	ProviderHealthHealthy       ProviderHealthState = "healthy"
	ProviderHealthAuthRequired  ProviderHealthState = "auth_required"
	ProviderHealthSetupRequired ProviderHealthState = "setup_required"
	ProviderHealthUnavailable   ProviderHealthState = "unavailable"
	ProviderHealthChecking      ProviderHealthState = "checking"
)

type ProviderServiceState string

const (
	ProviderServiceOperational ProviderServiceState = "operational"
	ProviderServiceDegraded    ProviderServiceState = "degraded"
	ProviderServiceOutage      ProviderServiceState = "outage"
	ProviderServiceUnknown     ProviderServiceState = "unknown"
)

type ProviderSetting struct {
	ID             string
	Label          string
	Enabled        bool
	DefaultEnabled bool
	Health         ProviderHealthState
	Service        ProviderServiceState
}

type ProviderSettingsErrorKind string

const (
	ProviderSettingsErrorUnavailable ProviderSettingsErrorKind = "unavailable"
	ProviderSettingsErrorVersion     ProviderSettingsErrorKind = "version"
)

type ProviderSettingsError struct {
	Kind ProviderSettingsErrorKind
	Err  error
}

func (e *ProviderSettingsError) Error() string {
	if e == nil || e.Err == nil {
		return "provider settings error"
	}
	return e.Err.Error()
}

func (e *ProviderSettingsError) Unwrap() error { return e.Err }

func ProviderSettingsErrorKindOf(err error) ProviderSettingsErrorKind {
	var settingsErr *ProviderSettingsError
	if errors.As(err, &settingsErr) {
		return settingsErr.Kind
	}
	return ProviderSettingsErrorUnavailable
}

// FetchProviderSettings reads CodexBar's dynamic provider inventory and joins
// best-effort health. Provider errors are classified here and never exposed.
func FetchProviderSettings(ctx context.Context) ([]ProviderSetting, error) {
	settings, bin, err := fetchProviderInventory(ctx)
	if err != nil {
		return nil, err
	}

	timeout := commandTimeout()
	healthRaw, healthErr := runProviderCommandFn(ctx, timeout, bin, "usage", "--json", "--status", "--web-timeout", "8")
	health := parseProviderHealth(healthRaw)
	for i := range settings {
		if !settings[i].Enabled {
			continue
		}
		if current, ok := health[settings[i].ID]; ok {
			settings[i].Health = current.health
			settings[i].Service = current.service
		} else if healthErr != nil {
			settings[i].Health = ProviderHealthUnavailable
		}
	}
	return settings, nil
}

func fetchProviderInventory(ctx context.Context) ([]ProviderSetting, string, error) {
	bin, err := FindBinary()
	if err != nil {
		return nil, "", providerSettingsError(ProviderSettingsErrorUnavailable, err)
	}
	if err := checkProviderSettingsVersion(ctx, bin); err != nil {
		return nil, "", providerSettingsError(ProviderSettingsErrorVersion, err)
	}

	timeout := commandTimeout()
	raw, err := runProviderCommandFn(ctx, timeout, bin, "config", "providers", "--json")
	if err != nil {
		return nil, "", providerSettingsError(ProviderSettingsErrorUnavailable, err)
	}
	settings, err := parseProviderSettings(raw)
	if err != nil {
		return nil, "", providerSettingsError(ProviderSettingsErrorUnavailable, err)
	}
	return settings, bin, nil
}

// SetProviderEnabled validates the exact provider ID against CodexBar's live
// inventory before invoking the CLI with separate process arguments.
func SetProviderEnabled(ctx context.Context, providerID string, enabled bool) error {
	settings, bin, err := fetchProviderInventory(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, setting := range settings {
		if setting.ID == providerID {
			found = true
			break
		}
	}
	if !found {
		return providerSettingsError(ProviderSettingsErrorUnavailable, errors.New("unknown provider"))
	}

	action := "disable"
	if enabled {
		action = "enable"
	}
	_, err = runProviderCommandFn(ctx, commandTimeout(), bin, "config", action, "--provider", providerID)
	if err != nil {
		return providerSettingsError(ProviderSettingsErrorUnavailable, err)
	}
	return nil
}

func checkProviderSettingsVersion(ctx context.Context, bin string) error {
	version, err := installedVersion(ctx, bin)
	if err != nil {
		return err
	}
	minimum, err := parseLooseVersion(minProviderSettingsVersion)
	if err != nil {
		return err
	}
	if version.Compare(minimum) < 0 {
		return fmt.Errorf("CodexBar %s is too old; need >= %s", version.String(), minProviderSettingsVersion)
	}
	return nil
}

func providerSettingsError(kind ProviderSettingsErrorKind, err error) error {
	return &ProviderSettingsError{Kind: kind, Err: err}
}

func parseProviderSettings(raw []byte) ([]ProviderSetting, error) {
	var inventory []struct {
		Provider       string `json:"provider"`
		DisplayName    string `json:"displayName"`
		Enabled        bool   `json:"enabled"`
		DefaultEnabled bool   `json:"defaultEnabled"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(raw), &inventory); err != nil {
		return nil, fmt.Errorf("parse provider inventory: %w", err)
	}
	settings := make([]ProviderSetting, 0, len(inventory))
	seen := make(map[string]struct{}, len(inventory))
	for _, item := range inventory {
		id := strings.TrimSpace(strings.ToLower(item.Provider))
		if !validProviderID(id) {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		label := strings.TrimSpace(item.DisplayName)
		if label == "" {
			label = humanLabel(id)
		}
		health := ProviderHealthChecking
		if !item.Enabled {
			health = ProviderHealthChecking
		}
		settings = append(settings, ProviderSetting{
			ID:             id,
			Label:          label,
			Enabled:        item.Enabled,
			DefaultEnabled: item.DefaultEnabled,
			Health:         health,
			Service:        ProviderServiceUnknown,
		})
	}
	if len(settings) == 0 {
		return nil, errors.New("provider inventory is empty")
	}
	return settings, nil
}

func validProviderID(id string) bool {
	if id == "" || len(id) > 80 {
		return false
	}
	for _, character := range id {
		if (character >= 'a' && character <= 'z') ||
			(character >= '0' && character <= '9') ||
			character == '-' || character == '_' || character == '.' {
			continue
		}
		return false
	}
	return true
}

type providerHealth struct {
	health  ProviderHealthState
	service ProviderServiceState
}

func parseProviderHealth(raw []byte) map[string]providerHealth {
	items, err := extractProvidersFromRawJSON(raw)
	if err != nil {
		return nil
	}
	result := make(map[string]providerHealth, len(items))
	for _, item := range items {
		payload, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := strings.TrimSpace(strings.ToLower(firstString(payload, "provider", "id")))
		if id == "" {
			continue
		}
		state := ProviderHealthHealthy
		if providerPayloadHasError(payload) {
			state = classifyProviderHealth(providerHealthErrorText(payload["error"]))
		}
		result[id] = providerHealth{
			health:  state,
			service: classifyProviderService(firstStringAtPaths(payload, "status.indicator")),
		}
	}
	return result
}

func providerHealthErrorText(value any) string {
	switch current := value.(type) {
	case string:
		return current
	case map[string]any:
		return firstString(current, "message", "kind")
	default:
		return ""
	}
}

func classifyProviderHealth(raw string) ProviderHealthState {
	message := strings.ToLower(raw)
	for _, marker := range []string{"auth", "unauthorized", "oauth", "expired", "sign in", "signin", "login", "cookie", "token"} {
		if strings.Contains(message, marker) {
			return ProviderHealthAuthRequired
		}
	}
	for _, marker := range []string{"no available fetch strategy", "not configured", "missing", "not found", "required"} {
		if strings.Contains(message, marker) {
			return ProviderHealthSetupRequired
		}
	}
	return ProviderHealthUnavailable
}

func classifyProviderService(indicator string) ProviderServiceState {
	switch strings.TrimSpace(strings.ToLower(indicator)) {
	case "none", "operational", "ok":
		return ProviderServiceOperational
	case "minor", "maintenance":
		return ProviderServiceDegraded
	case "major", "critical":
		return ProviderServiceOutage
	default:
		return ProviderServiceUnknown
	}
}
