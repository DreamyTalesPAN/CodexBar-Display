package companionapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/daemon"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

type usageResponse struct {
	OK              bool             `json:"ok"`
	GeneratedAt     string           `json:"generatedAt"`
	Source          string           `json:"source"`
	UsageMode       string           `json:"usageMode"`
	Refresh         usageRefreshInfo `json:"refresh"`
	TokenUsageReady bool             `json:"tokenUsageReady"`
	// TokenUsageUpdating reports that a shown token history is still growing,
	// so the totals derived from it are not final yet.
	TokenUsageUpdating bool                `json:"tokenUsageUpdating"`
	CurrentProvider    string              `json:"currentProvider,omitempty"`
	Providers          []usageProviderInfo `json:"providers"`
	// PreviewFrames is set only for ?previewFrames=1: the stream's frames from
	// the same snapshot as Providers.
	PreviewFrames *previewFramesResponse `json:"previewFrames,omitempty"`
}

type usageRefreshTracker struct {
	RequestedAt time.Time
}

type usageRefreshInfo struct {
	State       string `json:"state"`
	RequestedAt string `json:"requestedAt,omitempty"`
	Message     string `json:"message,omitempty"`
}

// The collector caps one provider collection at 15 minutes. After that bound,
// a manual request cannot still describe a normal in-flight collection.
const usageRefreshRequestMaxAge = 15 * time.Minute

type displayFrameResponse struct {
	DeviceID string         `json:"deviceId,omitempty"`
	OK       bool           `json:"ok"`
	SavedAt  string         `json:"savedAt,omitempty"`
	Source   string         `json:"source,omitempty"`
	Frame    protocol.Frame `json:"frame"`
}

type persistedDisplayFrame struct {
	SavedAt time.Time      `json:"savedAt"`
	Frame   protocol.Frame `json:"frame"`
}

type usageProviderInfo struct {
	ID                    string                   `json:"id"`
	Label                 string                   `json:"label"`
	Source                string                   `json:"source,omitempty"`
	Session               int                      `json:"session"`
	Weekly                int                      `json:"weekly"`
	ResetSec              int64                    `json:"resetSecs,omitempty"`
	UsageMode             string                   `json:"usageMode"`
	SessionTokens         int64                    `json:"sessionTokens,omitempty"`
	WeekTokens            int64                    `json:"weekTokens,omitempty"`
	TotalTokens           int64                    `json:"totalTokens,omitempty"`
	Activity              string                   `json:"activity,omitempty"`
	Stale                 bool                     `json:"stale"`
	UsageUnavailable      bool                     `json:"usageUnavailable,omitempty"`
	SessionUnavailable    bool                     `json:"sessionUnavailable,omitempty"`
	WeeklyUnavailable     bool                     `json:"weeklyUnavailable,omitempty"`
	SessionRetained       bool                     `json:"sessionRetained,omitempty"`
	WeeklyRetained        bool                     `json:"weeklyRetained,omitempty"`
	WindowsRetained       bool                     `json:"windowsRetained,omitempty"`
	CollectedAt           string                   `json:"collectedAt,omitempty"`
	ActivityObservedAt    string                   `json:"activityObservedAt,omitempty"`
	Windows               []usageWindowInfo        `json:"windows,omitempty"`
	Status                *usageStatusInfo         `json:"status,omitempty"`
	Credits               *usageCreditsInfo        `json:"credits,omitempty"`
	ResetCredits          *usageResetCreditsInfo   `json:"resetCredits,omitempty"`
	Cost                  *usageCostInfo           `json:"cost,omitempty"`
	CostSettled           bool                     `json:"costSettled,omitempty"`
	Plan                  string                   `json:"plan,omitempty"`
	Spend                 *usageSpendInfo          `json:"spend,omitempty"`
	TokenUsageReady       bool                     `json:"-"`
	TokenStatsCollectedAt time.Time                `json:"-"`
	Pace                  []usagePaceInfo          `json:"pace,omitempty"`
	UsageOverTime         []usageOverTimePointInfo `json:"usageOverTime,omitempty"`

	// NeverRead: no usage reading has ever arrived for this provider. Its
	// zeros are unknown, not used, so a display mode change must not flip them.
	NeverRead bool `json:"-"`
}

type usageWindowInfo struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	UsedPercent   int    `json:"usedPercent"`
	ResetSec      int64  `json:"resetSecs,omitempty"`
	WindowMinutes int    `json:"windowMinutes,omitempty"`
	// Both come from CodexBar's pace for this window and are absent when it
	// sends none. Nothing here is computed.
	WillLastToReset *bool `json:"willLastToReset,omitempty"`
	ETASeconds      int64 `json:"etaSeconds,omitempty"`
	// CodexBar's own pace words for this window: its stage name, its delta
	// (positive = ahead of plan = deficit, negative = reserve) and the used
	// percent it expects by now. ExpectedUsedPercent follows the display mode
	// like UsedPercent does.
	Stage               string `json:"stage,omitempty"`
	DeltaPercent        *int   `json:"deltaPercent,omitempty"`
	ExpectedUsedPercent *int   `json:"expectedUsedPercent,omitempty"`
}

type usageStatusInfo struct {
	Indicator   string `json:"indicator,omitempty"`
	Description string `json:"description,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	URL         string `json:"url,omitempty"`
}

type usageCreditsInfo struct {
	Remaining float64 `json:"remaining"`
	UpdatedAt string  `json:"updatedAt,omitempty"`
}

type usageResetCreditsInfo struct {
	AvailableCount int    `json:"availableCount"`
	NextExpiresAt  string `json:"nextExpiresAt,omitempty"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}

type usageCostInfo struct {
	CurrencyCode      string             `json:"currencyCode,omitempty"`
	UpdatedAt         string             `json:"updatedAt,omitempty"`
	TodayCostUSD      float64            `json:"todayCostUSD,omitempty"`
	Last30DaysCostUSD float64            `json:"last30DaysCostUSD,omitempty"`
	Last30DaysTokens  int64              `json:"last30DaysTokens,omitempty"`
	LatestTokens      int64              `json:"latestTokens,omitempty"`
	TopModel          string             `json:"topModel,omitempty"`
	Daily             []usageCostDayInfo `json:"daily,omitempty"`
	// KnownZero: the engine finished a complete scan and found no usage.
	KnownZero bool `json:"knownZero,omitempty"`
}

// usageSpendInfo is CodexBar's extra-usage cap for the provider, passed on as
// CodexBar reports it. Period is CodexBar's own word for the cap.
type usageSpendInfo struct {
	Limit    float64 `json:"limit"`
	Used     float64 `json:"used"`
	Currency string  `json:"currency"`
	Period   string  `json:"period,omitempty"`
}

type usageCostDayInfo struct {
	Day          string               `json:"day"`
	TotalCostUSD float64              `json:"totalCostUSD,omitempty"`
	TotalTokens  int64                `json:"totalTokens,omitempty"`
	Models       []usageCostModelInfo `json:"models,omitempty"`
}

type usageCostModelInfo struct {
	Name        string  `json:"name"`
	TotalTokens int64   `json:"totalTokens,omitempty"`
	CostUSD     float64 `json:"costUSD,omitempty"`
}

type usagePaceInfo struct {
	Window              string `json:"window"`
	Stage               string `json:"stage,omitempty"`
	DeltaPercent        int    `json:"deltaPercent,omitempty"`
	ExpectedUsedPercent int    `json:"expectedUsedPercent,omitempty"`
	WillLastToReset     bool   `json:"willLastToReset"`
	ETASeconds          int64  `json:"etaSeconds,omitempty"`
	Summary             string `json:"summary,omitempty"`
}

type usageOverTimePointInfo struct {
	Day              string                  `json:"day"`
	TotalCreditsUsed float64                 `json:"totalCreditsUsed"`
	Services         []usageServiceUsageInfo `json:"services,omitempty"`
}

type usageServiceUsageInfo struct {
	Service     string  `json:"service"`
	CreditsUsed float64 `json:"creditsUsed"`
}

func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	hiddenWindows, err := usagePreviewHiddenWindows(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_hidden_windows", "hiddenWindows must be a JSON object of provider to window ids.", "Send the limits as {\"provider\":[\"window\"]}.")
		return
	}
	now := s.currentTime()
	showUsed := s.usageBarsShowUsed()
	manualRefresh := usageRefreshRequested(r)
	if manualRefresh {
		s.requestUsageRefresh(now)
	}
	inventoryCh := make(chan []codexbar.ProviderSetting, 1)
	go func() {
		inventoryCh <- s.providerInventoryForUsage(r.Context())
	}()
	var inventory []codexbar.ProviderSetting
	inventoryLoaded := false
	loadInventory := func() {
		if !inventoryLoaded {
			inventory = <-inventoryCh
			inventoryLoaded = true
		}
	}
	writeUsage := func(resp usageResponse, usage daemon.PersistedUsage) {
		loadInventory()
		resp = filterDisabledProviders(resp, inventory)
		resp.Refresh = s.usageRefreshInfo(now, usageForVisibleProviders(usage, resp.Providers))
		writeJSON(w, http.StatusOK, usageResponseForDisplayMode(resp, showUsed))
	}
	if s.loadUsage != nil {
		if usage, ok := s.loadUsage(now); ok && len(usage.Providers) > 0 {
			loadInventory()
			enabledUsage := usageForEnabledProviders(usage, inventory)
			resp := usageResponseFromPersisted(now, enabledUsage)
			if len(resp.Providers) > 0 {
				if usagePreviewFramesRequested(r) {
					resp.PreviewFrames = previewFramesFor(usage, inventory, showUsed, s.currentSystemBusy() != nil, s.previewDeviceCapabilities(), now, s.firmwareUpdates, s.runtimeTheme, hiddenWindows, s.cachedSingleProviderTheme())
				}
				writeUsage(resp, enabledUsage)
				return
			}
		}
	}

	if manualRefresh {
		resp := emptyUsageResponse(now, "codexbar-display")
		writeUsage(resp, daemon.PersistedUsage{})
		return
	}

	writeError(
		w,
		http.StatusServiceUnavailable,
		"usage_unavailable",
		"Usage is still loading.",
		"Keep this page open. VibeTV will retry automatically.",
	)
}

func usageForVisibleProviders(usage daemon.PersistedUsage, visible []usageProviderInfo) daemon.PersistedUsage {
	visibleByID := make(map[string]struct{}, len(visible))
	for _, provider := range visible {
		visibleByID[provider.ID] = struct{}{}
	}
	providers := make([]daemon.ProviderUsageSnapshot, 0, len(visibleByID))
	for _, provider := range usage.Providers {
		id := usageProviderID(provider.Provider, provider.Frame.Provider)
		if _, ok := visibleByID[id]; ok {
			providers = append(providers, provider)
		}
	}
	usage.Providers = providers
	return usage
}

func usageForEnabledProviders(usage daemon.PersistedUsage, settings []codexbar.ProviderSetting) daemon.PersistedUsage {
	if len(settings) == 0 {
		return usage
	}
	enabled := enabledProviderIDs(settings)
	providers := make([]daemon.ProviderUsageSnapshot, 0, len(usage.Providers))
	for _, provider := range usage.Providers {
		id := usageProviderID(provider.Provider, provider.Frame.Provider)
		if _, ok := enabled[id]; ok {
			providers = append(providers, provider)
		}
	}
	usage.Providers = providers
	return usage
}

func usagePreviewFramesRequested(r *http.Request) bool {
	return r != nil && r.URL.Query().Get("previewFrames") == "1"
}

// maxPreviewHiddenWindowsBytes bounds the optional hiddenWindows query value.
const maxPreviewHiddenWindowsBytes = 2048

// usagePreviewHiddenWindows reads the limits a preview should show instead of
// the stored ones (the setup draft). Absent means the stored limits.
func usagePreviewHiddenWindows(r *http.Request) (map[string][]string, error) {
	if r == nil || !r.URL.Query().Has("hiddenWindows") {
		return nil, nil
	}
	raw := r.URL.Query().Get("hiddenWindows")
	if len(raw) > maxPreviewHiddenWindowsBytes {
		return nil, errors.New("hiddenWindows too large")
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	var hidden map[string][]string
	if err := decoder.Decode(&hidden); err != nil || hidden == nil || decoder.More() {
		return nil, errors.New("hiddenWindows is not a JSON object")
	}
	return hidden, nil
}

func usageRefreshRequested(r *http.Request) bool {
	if r == nil {
		return false
	}
	raw := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("refresh")))
	return raw == "1" || raw == "true" || raw == "yes"
}

func (s *Server) requestUsageRefresh(now time.Time) {
	if s == nil {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	s.usageRefreshMu.Lock()
	// A click while a refresh is waiting keeps that request: moved to now, it
	// would turn down the reading the first click is waiting for (#579).
	pending := s.usageRefresh.RequestedAt
	newRequest := pending.IsZero() || !now.Before(pending.Add(usageRefreshRequestMaxAge))
	if newRequest {
		s.usageRefresh.RequestedAt = now.UTC()
	}
	s.usageRefreshMu.Unlock()
	// serve keeps each reading for its refresh interval and then answers once
	// more with it while it measures again, so a wake alone could wait up to a
	// minute (#918). A fresh serve has no reading yet: the collection after it
	// starts measures.
	if newRequest && s.freshUsageService != nil && s.restartUsageService != nil {
		s.usageServiceReplacePending.Store(true)
		s.requestUsageServiceReplace("manual usage refresh")
		return
	}
	if s.wakeDisplayStream != nil {
		s.wakeDisplayStream()
	}
}

func (s *Server) usageRefreshInfo(now time.Time, usage daemon.PersistedUsage) usageRefreshInfo {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	now = now.UTC()

	s.usageRefreshMu.Lock()
	requestedAt := s.usageRefresh.RequestedAt
	if !requestedAt.IsZero() {
		if usageHasFreshSnapshotAfter(usage, requestedAt) {
			s.usageRefresh.RequestedAt = time.Time{}
			s.usageRefreshMu.Unlock()
			return usageRefreshInfo{State: "fresh", Message: usageRefreshMessage("fresh")}
		}
		if !now.Before(requestedAt.Add(usageRefreshRequestMaxAge)) {
			s.usageRefreshMu.Unlock()
			return usageRefreshInfo{
				State:       "unavailable",
				RequestedAt: formatOptionalTime(requestedAt),
				Message:     "Usage refresh did not produce new data. Current values may be out of date.",
			}
		}
		s.usageRefreshMu.Unlock()
		return usageRefreshInfo{
			State:       "refreshing",
			RequestedAt: formatOptionalTime(requestedAt),
			Message:     usageRefreshMessage("refreshing"),
		}
	}
	s.usageRefreshMu.Unlock()

	if usageHasFreshSnapshot(usage) {
		return usageRefreshInfo{State: "fresh", Message: usageRefreshMessage("fresh")}
	}
	return usageRefreshInfo{State: "unavailable", Message: usageRefreshMessage("unavailable")}
}

func clearUsageProviderTokenHistory(provider *usageProviderInfo) {
	if provider == nil {
		return
	}
	provider.SessionTokens = 0
	provider.WeekTokens = 0
	provider.TotalTokens = 0
	provider.Cost = nil
	provider.CostSettled = false
	provider.TokenUsageReady = false
	provider.TokenStatsCollectedAt = time.Time{}
}

func usageHasFreshSnapshotAfter(usage daemon.PersistedUsage, requestedAt time.Time) bool {
	if requestedAt.IsZero() {
		return usageHasFreshSnapshot(usage)
	}
	if len(usage.Providers) == 0 {
		return false
	}
	for _, provider := range usage.Providers {
		if provider.Stale || provider.CollectedAt.IsZero() {
			return false
		}
		if provider.CollectedAt.Before(requestedAt) {
			return false
		}
	}
	return true
}

func usageHasFreshSnapshot(usage daemon.PersistedUsage) bool {
	for _, provider := range usage.Providers {
		if !provider.Stale && !provider.CollectedAt.IsZero() {
			return true
		}
	}
	return false
}

func usageRefreshMessage(state string) string {
	switch state {
	case "refreshing":
		return "Refreshing usage. Current values stay visible until new data arrives."
	case "fresh":
		return "Usage is up to date."
	default:
		return "Usage is not available yet."
	}
}

func (s *Server) handleDisplayFrameLatest(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	cableMode := runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable"
	streamLog := readDisplayStreamLog(displayStreamOutLogPath())
	boundary, boundaryOK := streamLog.boundary()
	if boundaryOK {
		sentAt, _, line, found := streamLog.lastFrameAfter(boundary)
		frame, valid := frameFromDisplayStreamLogLine(line)
		deviceID := displayStreamLogValue(line, "deviceId")
		if found && valid && (!cableMode || (strings.EqualFold(displayStreamLogValue(line, "transport"), "usb") &&
			deviceID != "" && strings.EqualFold(deviceID, cfg.DeviceID))) {
			writeJSON(w, http.StatusOK, displayFrameResponse{
				DeviceID: deviceID,
				OK:       true,
				SavedAt:  sentAt.UTC().Format(time.RFC3339Nano),
				Source:   "last-sent-frame",
				Frame:    frame.Normalize(),
			})
			return
		}
	}

	saved, ok := s.loadLastGoodDisplayFrame()
	// Persisted usage has no device identity. Cable preview must use the actual
	// acknowledged frame above, never the previous device's last-good snapshot.
	if cableMode || !ok || !boundaryOK || (!boundary.IsZero() && saved.SavedAt.Before(boundary)) {
		writeError(
			w,
			http.StatusNotFound,
			"display_frame_unavailable",
			"Display frame is not available.",
			"Keep the Mac App running until VibeTV receives a usage frame.",
		)
		return
	}

	writeJSON(w, http.StatusOK, displayFrameResponse{
		OK:      true,
		SavedAt: saved.SavedAt.UTC().Format(time.RFC3339Nano),
		Source:  "last-good-frame",
		Frame:   saved.Frame.Normalize(),
	})
}

func (s *Server) loadLastGoodDisplayFrame() (persistedDisplayFrame, bool) {
	path := s.lastGoodDisplayFramePath()
	if path == "" {
		return persistedDisplayFrame{}, false
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return persistedDisplayFrame{}, false
	}

	var saved persistedDisplayFrame
	if err := json.Unmarshal(raw, &saved); err != nil {
		return persistedDisplayFrame{}, false
	}
	frame := saved.Frame.Normalize()
	if saved.SavedAt.IsZero() || strings.TrimSpace(frame.Error) != "" {
		return persistedDisplayFrame{}, false
	}
	saved.Frame = frame
	return saved, true
}

func (s *Server) lastGoodDisplayFramePath() string {
	home := strings.TrimSpace(s.home)
	if home == "" {
		return ""
	}
	return runtimepaths.Path(home, "last-good-frame.json")
}

func usageResponseFromPersisted(now time.Time, usage daemon.PersistedUsage) usageResponse {
	providers := make([]usageProviderInfo, 0, len(usage.Providers))
	for _, provider := range usage.Providers {
		if info, ok := usageProviderFromSnapshot(provider); ok {
			dropPaceAfterReset(info.Windows, now, provider.CollectedAt)
			providers = append(providers, info)
		}
	}
	resp := emptyUsageResponse(now, "codexbar-display")
	resp.CurrentProvider = strings.TrimSpace(usage.CurrentProvider)
	resp.UsageMode = usageModeForProviders(providers)
	resp.TokenUsageReady = usageProvidersHaveTokenResult(providers)
	resp.TokenUsageUpdating = usageProvidersHaveUpdatingTokenHistory(providers)
	if !resp.TokenUsageReady {
		for i := range providers {
			clearUsageProviderTokenHistory(&providers[i])
		}
	}
	resp.Providers = providers
	if resp.CurrentProvider == "" && len(providers) > 0 {
		resp.CurrentProvider = providers[0].ID
	}
	return resp
}

func emptyUsageResponse(now time.Time, source string) usageResponse {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return usageResponse{
		OK:          true,
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Source:      strings.TrimSpace(source),
		UsageMode:   "used",
		Providers:   []usageProviderInfo{},
	}
}

func usageProvidersHaveTokenResult(providers []usageProviderInfo) bool {
	if len(providers) == 0 {
		return false
	}
	var completedAt time.Time
	for _, provider := range providers {
		if !provider.TokenUsageReady && provider.Cost == nil {
			return false
		}
		if provider.TokenStatsCollectedAt.IsZero() {
			continue
		}
		if completedAt.IsZero() {
			completedAt = provider.TokenStatsCollectedAt
		} else if !provider.TokenStatsCollectedAt.Equal(completedAt) {
			return false
		}
	}
	return true
}

// usageProvidersHaveUpdatingTokenHistory reports whether any shown token
// history is still growing. One unsettled provider makes every total derived
// from the shown set provisional.
func usageProvidersHaveUpdatingTokenHistory(providers []usageProviderInfo) bool {
	for _, provider := range providers {
		if provider.Cost != nil && !provider.CostSettled {
			return true
		}
	}
	return false
}

func usageProviderFromSnapshot(snapshot daemon.ProviderUsageSnapshot) (usageProviderInfo, bool) {
	frame := snapshot.Frame.Normalize()
	if strings.TrimSpace(frame.Error) != "" {
		return usageProviderInfo{}, false
	}
	if frame.UsageUnavailable && !snapshotHasUsableUsage(frame, snapshot.Meta) && !snapshotIsUnavailableUsageCarrier(snapshot, frame) {
		return usageProviderInfo{}, false
	}
	id := usageProviderID(snapshot.Provider, frame.Provider)
	if id == "" {
		return usageProviderInfo{}, false
	}
	// A stale reading that still has its numbers: its lanes are real unless
	// the source flagged them. A cleared or never-read reading is not retained.
	retained := snapshot.Stale && !snapshot.NoReading && !snapshot.CollectedAt.IsZero() && !frame.UsageUnavailable
	neverRead := snapshot.NoReading || snapshot.CollectedAt.IsZero()
	return usageProviderInfo{
		ID:                    id,
		Label:                 usageProviderLabel(id, frame.Label),
		Source:                strings.TrimSpace(snapshot.Source),
		Session:               frame.Session,
		Weekly:                frame.Weekly,
		ResetSec:              frame.ResetSec,
		UsageMode:             usageModeOrDefault(frame.UsageMode),
		SessionTokens:         frame.SessionTokens,
		WeekTokens:            frame.WeekTokens,
		TotalTokens:           frame.TotalTokens,
		Activity:              strings.TrimSpace(frame.Activity),
		Stale:                 snapshot.Stale,
		UsageUnavailable:      snapshot.Stale || (frame.UsageUnavailable && len(snapshot.Meta.Windows) == 0),
		SessionUnavailable:    snapshot.Stale || frame.UsageUnavailable || frame.SessionUnavailable,
		WeeklyUnavailable:     snapshot.Stale || frame.UsageUnavailable || frame.WeeklyUnavailable,
		SessionRetained:       retained && !frame.SessionUnavailable,
		WeeklyRetained:        retained && !frame.WeeklyUnavailable,
		CollectedAt:           formatOptionalTime(snapshot.CollectedAt),
		ActivityObservedAt:    formatOptionalTime(snapshot.ActivityObservedAt),
		Windows:               usageWindowsFromMeta(snapshot.Meta, snapshot.Stale),
		WindowsRetained:       retained,
		Status:                usageStatusFromMeta(snapshot.Meta),
		Credits:               usageCreditsFromMeta(snapshot.Meta),
		ResetCredits:          usageResetCreditsFromMeta(snapshot.Meta),
		Cost:                  usageCostFromMeta(snapshot.Meta),
		CostSettled:           snapshot.TokenHistorySettled,
		Plan:                  strings.TrimSpace(snapshot.Meta.Plan),
		Spend:                 usageSpendFromMeta(snapshot.Meta),
		TokenUsageReady:       !snapshot.TokenStatsCollectedAt.IsZero(),
		TokenStatsCollectedAt: snapshot.TokenStatsCollectedAt,
		Pace:                  usagePaceFromMeta(snapshot.Meta),
		UsageOverTime:         usageOverTimeFromMeta(snapshot.Meta),
		NeverRead:             neverRead,
	}, true
}

func snapshotIsUnavailableUsageCarrier(snapshot daemon.ProviderUsageSnapshot, frame protocol.Frame) bool {
	if snapshot.CollectedAt.IsZero() || !frame.UsageUnavailable {
		return false
	}
	return !snapshot.Stale || (frame.SessionUnavailable && frame.WeeklyUnavailable)
}

func snapshotHasUsableUsage(frame protocol.Frame, meta codexbar.ProviderUsageMeta) bool {
	if len(meta.Windows) > 0 || meta.Cost != nil {
		return true
	}
	return frame.Session != 0 ||
		frame.Weekly != 0 ||
		frame.SessionTokens != 0 ||
		frame.WeekTokens != 0 ||
		frame.TotalTokens != 0 ||
		len(frame.UsageSlots) > 0
}

// A stale reading keeps its windows and loses their pace: CodexBar paced a
// window against its reset as it stood when the reading was fresh.
func usageWindowsFromMeta(meta codexbar.ProviderUsageMeta, stale bool) []usageWindowInfo {
	if len(meta.Windows) == 0 {
		return nil
	}
	out := make([]usageWindowInfo, 0, len(meta.Windows))
	for _, window := range meta.Windows {
		id := strings.TrimSpace(strings.ToLower(window.ID))
		label := strings.TrimSpace(window.Label)
		if id == "" || label == "" {
			continue
		}
		info := usageWindowInfo{
			ID:            id,
			Label:         label,
			UsedPercent:   clampUsagePercent(window.UsedPercent),
			ResetSec:      window.ResetSec,
			WindowMinutes: window.WindowMinutes,
		}
		if pace, ok := codexbar.PaceForWindow(meta.Pace, id); ok && !stale && window.ResetSec > 0 {
			willLast := pace.WillLastToReset
			info.WillLastToReset = &willLast
			info.ETASeconds = pace.ETASeconds
			info.Stage = strings.TrimSpace(pace.Stage)
			if pace.HasDeltaPercent {
				delta := pace.DeltaPercent
				info.DeltaPercent = &delta
			}
			if pace.HasExpectedUsedPercent {
				expected := clampUsagePercent(pace.ExpectedUsedPercent)
				info.ExpectedUsedPercent = &expected
			}
		}
		out = append(out, info)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// A window whose reset has passed since CodexBar collected it loses its pace,
// like a stale reading: the pace belonged to the window that is gone.
func dropPaceAfterReset(windows []usageWindowInfo, now, collectedAt time.Time) {
	if now.IsZero() || collectedAt.IsZero() || !now.After(collectedAt) {
		return
	}
	age := int64(now.Sub(collectedAt) / time.Second)
	for i := range windows {
		if windows[i].ResetSec <= age {
			windows[i].WillLastToReset, windows[i].ETASeconds = nil, 0
			windows[i].Stage, windows[i].DeltaPercent, windows[i].ExpectedUsedPercent = "", nil, nil
		}
	}
}

func usageStatusFromMeta(meta codexbar.ProviderUsageMeta) *usageStatusInfo {
	if meta.Status == nil {
		return nil
	}
	status := usageStatusInfo{
		Indicator:   strings.TrimSpace(meta.Status.Indicator),
		Description: strings.TrimSpace(meta.Status.Description),
		UpdatedAt:   formatOptionalTime(meta.Status.UpdatedAt),
		URL:         strings.TrimSpace(meta.Status.URL),
	}
	if status.Indicator == "" && status.Description == "" && status.UpdatedAt == "" && status.URL == "" {
		return nil
	}
	return &status
}

func usageCreditsFromMeta(meta codexbar.ProviderUsageMeta) *usageCreditsInfo {
	if meta.Credits == nil {
		return nil
	}
	return &usageCreditsInfo{
		Remaining: meta.Credits.Remaining,
		UpdatedAt: formatOptionalTime(meta.Credits.UpdatedAt),
	}
}

func usageResetCreditsFromMeta(meta codexbar.ProviderUsageMeta) *usageResetCreditsInfo {
	if meta.ResetCredits == nil {
		return nil
	}
	info := usageResetCreditsInfo{
		AvailableCount: meta.ResetCredits.AvailableCount,
		NextExpiresAt:  formatOptionalTime(meta.ResetCredits.NextExpiresAt),
		UpdatedAt:      formatOptionalTime(meta.ResetCredits.UpdatedAt),
	}
	if info.AvailableCount == 0 && info.NextExpiresAt == "" && info.UpdatedAt == "" {
		return nil
	}
	return &info
}

func usageSpendFromMeta(meta codexbar.ProviderUsageMeta) *usageSpendInfo {
	if meta.Spend == nil {
		return nil
	}
	return &usageSpendInfo{
		Limit:    meta.Spend.Limit,
		Used:     meta.Spend.Used,
		Currency: meta.Spend.Currency,
		Period:   meta.Spend.Period,
	}
}

func usageCostFromMeta(meta codexbar.ProviderUsageMeta) *usageCostInfo {
	if meta.Cost == nil {
		return nil
	}
	cost := usageCostInfo{
		CurrencyCode:      strings.TrimSpace(meta.Cost.CurrencyCode),
		UpdatedAt:         formatOptionalTime(meta.Cost.UpdatedAt),
		TodayCostUSD:      meta.Cost.TodayCostUSD,
		Last30DaysCostUSD: meta.Cost.Last30DaysCostUSD,
		Last30DaysTokens:  meta.Cost.Last30DaysTokens,
		LatestTokens:      meta.Cost.LatestTokens,
		TopModel:          strings.TrimSpace(meta.Cost.TopModel),
		Daily:             usageCostDaysFromMeta(meta.Cost.Daily),
		KnownZero:         meta.Cost.KnownZero,
	}
	if cost.CurrencyCode == "" {
		cost.CurrencyCode = "USD"
	}
	if !cost.KnownZero &&
		cost.TodayCostUSD <= 0 &&
		cost.Last30DaysCostUSD <= 0 &&
		cost.Last30DaysTokens <= 0 &&
		cost.LatestTokens <= 0 &&
		cost.TopModel == "" &&
		len(cost.Daily) == 0 &&
		cost.UpdatedAt == "" {
		return nil
	}
	return &cost
}

func usageCostDaysFromMeta(days []codexbar.ProviderCostDay) []usageCostDayInfo {
	if len(days) == 0 {
		return nil
	}
	out := make([]usageCostDayInfo, 0, len(days))
	for _, day := range days {
		key := strings.TrimSpace(day.Day)
		if key == "" {
			continue
		}
		models := make([]usageCostModelInfo, 0, len(day.Models))
		for _, model := range day.Models {
			name := strings.TrimSpace(model.Name)
			if name == "" {
				continue
			}
			models = append(models, usageCostModelInfo{
				Name:        name,
				TotalTokens: model.TotalTokens,
				CostUSD:     model.CostUSD,
			})
		}
		out = append(out, usageCostDayInfo{
			Day:          key,
			TotalCostUSD: day.TotalCostUSD,
			TotalTokens:  day.TotalTokens,
			Models:       models,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usagePaceFromMeta(meta codexbar.ProviderUsageMeta) []usagePaceInfo {
	if len(meta.Pace) == 0 {
		return nil
	}
	out := make([]usagePaceInfo, 0, len(meta.Pace))
	for _, pace := range meta.Pace {
		window := strings.TrimSpace(strings.ToLower(pace.Window))
		if window == "" {
			continue
		}
		out = append(out, usagePaceInfo{
			Window:              window,
			Stage:               strings.TrimSpace(pace.Stage),
			DeltaPercent:        pace.DeltaPercent,
			ExpectedUsedPercent: clampUsagePercent(pace.ExpectedUsedPercent),
			WillLastToReset:     pace.WillLastToReset,
			ETASeconds:          pace.ETASeconds,
			Summary:             strings.TrimSpace(pace.Summary),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usageOverTimeFromMeta(meta codexbar.ProviderUsageMeta) []usageOverTimePointInfo {
	if len(meta.OverTime) == 0 {
		return nil
	}
	out := make([]usageOverTimePointInfo, 0, len(meta.OverTime))
	for _, point := range meta.OverTime {
		day := strings.TrimSpace(point.Day)
		if day == "" {
			continue
		}
		services := make([]usageServiceUsageInfo, 0, len(point.Services))
		for _, service := range point.Services {
			name := strings.TrimSpace(service.Service)
			if name == "" || service.CreditsUsed <= 0 {
				continue
			}
			services = append(services, usageServiceUsageInfo{
				Service:     name,
				CreditsUsed: service.CreditsUsed,
			})
		}
		out = append(out, usageOverTimePointInfo{
			Day:              day,
			TotalCreditsUsed: point.TotalCreditsUsed,
			Services:         services,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func usageProviderID(values ...string) string {
	for _, value := range values {
		id := strings.TrimSpace(strings.ToLower(value))
		if id != "" {
			return id
		}
	}
	return ""
}

func usageProviderLabel(id string, label string) string {
	label = strings.TrimSpace(label)
	if label != "" {
		return label
	}
	if id == "" {
		return "Provider"
	}
	return strings.ToUpper(id[:1]) + id[1:]
}

func usageModeOrDefault(mode string) string {
	mode = strings.TrimSpace(strings.ToLower(mode))
	if mode == "remaining" {
		return "remaining"
	}
	return "used"
}

func usageModeForProviders(providers []usageProviderInfo) string {
	for _, provider := range providers {
		if provider.UsageMode != "" {
			return usageModeOrDefault(provider.UsageMode)
		}
	}
	return "used"
}

func usageResponseForDisplayMode(resp usageResponse, showUsed bool) usageResponse {
	targetMode := "used"
	if !showUsed {
		targetMode = "remaining"
	}
	for i := range resp.Providers {
		resp.Providers[i] = usageProviderForDisplayMode(resp.Providers[i], targetMode)
	}
	resp.UsageMode = targetMode
	return resp
}

func usageProviderForDisplayMode(provider usageProviderInfo, targetMode string) usageProviderInfo {
	if provider.NeverRead {
		// No reading yet: the zeros are unknown, so there is nothing to flip and
		// no direction to claim. A "remaining" mode would read 0 as real usage.
		return provider
	}
	currentMode := usageModeOrDefault(provider.UsageMode)
	if currentMode != targetMode {
		provider.Session = 100 - clampUsagePercent(provider.Session)
		provider.Weekly = 100 - clampUsagePercent(provider.Weekly)
		for i := range provider.Windows {
			provider.Windows[i].UsedPercent = 100 - clampUsagePercent(provider.Windows[i].UsedPercent)
			if expected := provider.Windows[i].ExpectedUsedPercent; expected != nil {
				flipped := 100 - clampUsagePercent(*expected)
				provider.Windows[i].ExpectedUsedPercent = &flipped
			}
		}
	}
	provider.UsageMode = usageModeOrDefault(targetMode)
	return provider
}

func clampUsagePercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func formatOptionalTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}
