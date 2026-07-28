package dashboard

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"
)

var ErrUnexpectedPayload = errors.New("unexpected dashboard usage payload")

type Snapshot struct {
	SchemaVersion int                 `json:"schemaVersion"`
	GeneratedAt   *time.Time          `json:"generatedAt"`
	Providers     []DashboardProvider `json:"providers"`
}

type DashboardProvider struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Source    string            `json:"source"`
	Windows   []DashboardWindow `json:"windows"`
	Error     json.RawMessage   `json:"error"`
	UpdatedAt *time.Time        `json:"updatedAt"`
}

type DashboardWindow struct {
	Kind             string     `json:"kind"`
	Label            string     `json:"label"`
	UsedPercent      *float64   `json:"usedPercent"`
	RemainingPercent *float64   `json:"remainingPercent"`
	ResetAt          *time.Time `json:"resetAt"`
}

type UsageProvider struct {
	Provider string          `json:"provider"`
	Usage    UsageMetadata   `json:"usage"`
	Error    json.RawMessage `json:"error"`
}

type UsageMetadata struct {
	Primary          *RateWindow       `json:"primary"`
	Secondary        *RateWindow       `json:"secondary"`
	Tertiary         *RateWindow       `json:"tertiary"`
	ExtraRateWindows []NamedRateWindow `json:"extraRateWindows"`
	Extra            []NamedRateWindow `json:"extra"`
}

type RateWindow struct {
	UsedPercent            *float64   `json:"usedPercent"`
	WindowMinutes          *int       `json:"windowMinutes"`
	ResetsAt               *time.Time `json:"resetsAt"`
	ResetAt                *time.Time `json:"resetAt"`
	IsSyntheticPlaceholder bool       `json:"isSyntheticPlaceholder"`
	UsageKnown             *bool      `json:"usageKnown"`
}

type NamedRateWindow struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Label      string     `json:"label"`
	Name       string     `json:"name"`
	Window     RateWindow `json:"window"`
	UsageKnown *bool      `json:"usageKnown"`
}

type ProviderWindows struct {
	ID          string
	UpdatedAt   *time.Time
	Unavailable bool
	Windows     []UsageWindow
}

type UsageWindow struct {
	ID            string
	Label         string
	UsedPercent   float64
	ResetAt       *time.Time
	WindowMinutes *int
}

func DecodeSnapshot(raw []byte) (Snapshot, error) {
	var snapshot Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return Snapshot{}, err
	}
	if snapshot.SchemaVersion == 0 && len(snapshot.Providers) == 0 {
		return Snapshot{}, ErrUnexpectedPayload
	}
	return snapshot, nil
}

func DecodeUsage(raw []byte) ([]UsageProvider, error) {
	var providers []UsageProvider
	if err := json.Unmarshal(raw, &providers); err == nil {
		return providers, nil
	}

	var wrapped struct {
		Providers []UsageProvider `json:"providers"`
	}
	if err := json.Unmarshal(raw, &wrapped); err == nil && wrapped.Providers != nil {
		return wrapped.Providers, nil
	}

	var single UsageProvider
	if err := json.Unmarshal(raw, &single); err == nil && strings.TrimSpace(single.Provider) != "" {
		return []UsageProvider{single}, nil
	}
	return nil, ErrUnexpectedPayload
}

func UsageForProvider(providers []UsageProvider, providerID string) (UsageProvider, bool) {
	providerID = normalizeKey(providerID)
	for _, provider := range providers {
		if normalizeKey(provider.Provider) == providerID {
			return provider, true
		}
	}
	return UsageProvider{}, false
}

func NormalizeProvider(provider DashboardProvider, usage UsageProvider) ProviderWindows {
	out := ProviderWindows{
		ID:        strings.TrimSpace(provider.ID),
		UpdatedAt: provider.UpdatedAt,
	}
	if hasProviderError(provider.Error) || hasProviderError(usage.Error) {
		out.Unavailable = true
		return out
	}

	metadata := indexUsageMetadata(usage.Usage)
	candidates := make([]windowCandidate, 0, len(provider.Windows))
	for _, source := range provider.Windows {
		window, ok := normalizeDashboardWindow(source, metadata)
		if !ok {
			continue
		}
		candidates = append(candidates, window)
	}
	out.Windows = dedupeStructuralAliases(candidates)
	if len(out.Windows) == 0 {
		out.Windows = nil
	}
	return out
}

type usageWindowMetadata struct {
	usageKnown      bool
	synthetic       bool
	windowMinutes   *int
	metadataReset   *time.Time
	structuralAlias bool
}

type windowCandidate struct {
	window     UsageWindow
	structural bool
}

func normalizeDashboardWindow(source DashboardWindow, metadata map[string]usageWindowMetadata) (windowCandidate, bool) {
	id := normalizeKey(source.Kind)
	label := strings.TrimSpace(source.Label)
	if id == "" || label == "" || source.UsedPercent == nil {
		return windowCandidate{}, false
	}

	meta, ok := metadata[id]
	if !ok || !meta.usageKnown || meta.synthetic {
		return windowCandidate{}, false
	}

	resetAt := source.ResetAt
	if resetAt == nil {
		resetAt = meta.metadataReset
	}

	return windowCandidate{
		window: UsageWindow{
			ID:            id,
			Label:         label,
			UsedPercent:   clampPercent(*source.UsedPercent),
			ResetAt:       resetAt,
			WindowMinutes: meta.windowMinutes,
		},
		structural: meta.structuralAlias,
	}, true
}

func indexUsageMetadata(usage UsageMetadata) map[string]usageWindowMetadata {
	index := make(map[string]usageWindowMetadata)
	addStructuralWindow(index, "session", usage.Primary)
	addStructuralWindow(index, "weekly", usage.Secondary)
	addStructuralWindow(index, "tertiary", usage.Tertiary)
	for _, extra := range append(usage.ExtraRateWindows, usage.Extra...) {
		addNamedWindow(index, extra)
	}
	return index
}

func addStructuralWindow(index map[string]usageWindowMetadata, dashboardKind string, window *RateWindow) {
	if window == nil {
		return
	}
	index[dashboardKind] = usageWindowMetadata{
		usageKnown:      knownUsage(window.UsageKnown),
		synthetic:       window.IsSyntheticPlaceholder,
		windowMinutes:   window.WindowMinutes,
		metadataReset:   window.resetAt(),
		structuralAlias: true,
	}
}

func addNamedWindow(index map[string]usageWindowMetadata, named NamedRateWindow) {
	id := normalizeKey(named.ID)
	if id == "" {
		id = normalizeKey(named.Name)
	}
	if id == "" {
		id = normalizeKey(named.Title)
	}
	if id == "" {
		return
	}
	usageKnown := knownUsage(named.UsageKnown)
	if named.Window.UsageKnown != nil {
		usageKnown = knownUsage(named.Window.UsageKnown)
	}
	index[id] = usageWindowMetadata{
		usageKnown:    usageKnown,
		synthetic:     named.Window.IsSyntheticPlaceholder,
		windowMinutes: named.Window.WindowMinutes,
		metadataReset: named.Window.resetAt(),
	}
}

func (window RateWindow) resetAt() *time.Time {
	if window.ResetsAt != nil {
		return window.ResetsAt
	}
	return window.ResetAt
}

func dedupeStructuralAliases(candidates []windowCandidate) []UsageWindow {
	out := make([]UsageWindow, 0, len(candidates))
	for i, candidate := range candidates {
		if candidate.structural && hasMatchingNamedWindow(candidate, candidates, i) {
			continue
		}
		out = append(out, candidate.window)
	}
	return out
}

func hasMatchingNamedWindow(structural windowCandidate, candidates []windowCandidate, structuralIndex int) bool {
	for i, candidate := range candidates {
		if i == structuralIndex || candidate.structural {
			continue
		}
		if sameWindowIdentity(structural.window, candidate.window) {
			return true
		}
	}
	return false
}

func sameWindowIdentity(a, b UsageWindow) bool {
	if !samePercent(a.UsedPercent, b.UsedPercent) {
		return false
	}
	if a.ResetAt == nil || b.ResetAt == nil || !a.ResetAt.Equal(*b.ResetAt) {
		return false
	}
	if a.WindowMinutes != nil && b.WindowMinutes != nil {
		return *a.WindowMinutes == *b.WindowMinutes
	}
	return true
}

func samePercent(a, b float64) bool {
	return math.Abs(a-b) <= 1e-9
}

func knownUsage(raw *bool) bool {
	return raw == nil || *raw
}

func hasProviderError(raw json.RawMessage) bool {
	trimmed := strings.TrimSpace(string(raw))
	return trimmed != "" && trimmed != "null" && trimmed != "{}"
}

func normalizeKey(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func clampPercent(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return math.Max(0, math.Min(100, value))
}
