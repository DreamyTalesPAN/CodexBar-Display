package protocol

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

const (
	DefaultUsageWindowLabelBytes = 24
	DefaultUsageWindowIDBytes    = 32
	DefaultProviderBytes         = DefaultUsageWindowIDBytes
	DefaultProviderLabelBytes    = DefaultUsageWindowLabelBytes
)

const (
	ResetTrustLive    = "live"
	ResetTrustOffline = "offline"
	ResetTrustStale   = "stale"
)

const ResetTrustHorizon = 5 * time.Hour

type UsageWindow struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Percent  int    `json:"percent"`
	ResetSec int64  `json:"resetSecs"`
}

func (w *UsageWindow) UnmarshalJSON(data []byte) error {
	type rawUsageWindow UsageWindow
	var decoded rawUsageWindow
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if len([]byte(decoded.ID)) > DefaultUsageWindowIDBytes {
		return fmt.Errorf("usage window id exceeds %d UTF-8 bytes", DefaultUsageWindowIDBytes)
	}
	if len([]byte(decoded.Label)) > DefaultUsageWindowLabelBytes {
		return fmt.Errorf("usage window label exceeds %d UTF-8 bytes", DefaultUsageWindowLabelBytes)
	}
	*w = UsageWindow(decoded)
	return nil
}

type UsageSlot = UsageWindow

const minClockTransitionEpoch int64 = 1735689600

// ClockSchedule carries the already validated current offset and, when they
// exist, the next two local UTC-offset changes. The device keeps UTC from SNTP
// and applies each offset when its transition epoch arrives; it does not need a
// timezone database.
type ClockSchedule struct {
	CurrentOffsetMinutes     int   `json:"currentOffsetMinutes"`
	TransitionEpoch          int64 `json:"transitionEpoch,omitempty"`
	OffsetMinutes            int   `json:"offsetMinutes"`
	FollowingTransitionEpoch int64 `json:"followingTransitionEpoch,omitempty"`
	FollowingOffsetMinutes   int   `json:"followingOffsetMinutes,omitempty"`
}

type Frame struct {
	V                     int             `json:"v"`
	Provider              string          `json:"provider,omitempty"`
	Label                 string          `json:"label,omitempty"`
	Session               int             `json:"session,omitempty"`
	Weekly                int             `json:"weekly,omitempty"`
	ResetSec              int64           `json:"resetSecs,omitempty"`
	ResetAgeSec           int64           `json:"resetAgeSecs,omitempty"`
	ResetTrustSec         int64           `json:"resetTrustSecs,omitempty"`
	ResetSource           string          `json:"resetSource,omitempty"`
	ResetTrust            string          `json:"resetTrust,omitempty"`
	UsageUnavailable      bool            `json:"usageUnavailable,omitempty"`
	SessionUnavailable    bool            `json:"sessionUnavailable,omitempty"`
	WeeklyUnavailable     bool            `json:"weeklyUnavailable,omitempty"`
	UsageMode             string          `json:"usageMode,omitempty"`
	UsageWindows          []UsageWindow   `json:"usageWindows,omitempty"`
	UsageSlots            []UsageSlot     `json:"usageSlots,omitempty"`
	Time                  string          `json:"time,omitempty"`
	Date                  string          `json:"date,omitempty"`
	NextClockTransition   *ClockSchedule  `json:"clockSchedule,omitempty"`
	SessionTokens         int64           `json:"sessionTokens,omitempty"`
	WeekTokens            int64           `json:"weekTokens,omitempty"`
	TotalTokens           int64           `json:"totalTokens,omitempty"`
	// TokenTotalsKnown marks a completed token-history result on the wire.
	// Zero totals are omitted by omitempty, so without this marker a device
	// cannot tell a genuine all-zero history from an unavailable one.
	TokenTotalsKnown bool `json:"tokenTotalsKnown,omitempty"`
	Activity              string          `json:"activity,omitempty"`
	Theme                 string          `json:"theme,omitempty"`
	ThemeSpec             json.RawMessage `json:"themeSpec,omitempty"`
	ConfirmClearThemeSpec bool            `json:"confirmClearThemeSpec,omitempty"`
	Update                *UpdateState    `json:"update,omitempty"`
	Error                 string          `json:"error,omitempty"`
}

type UpdateState struct {
	Available     bool   `json:"available"`
	LatestVersion string `json:"latestVersion,omitempty"`
	Status        string `json:"status,omitempty"`
	LastError     string `json:"lastError,omitempty"`
	Severity      string `json:"severity,omitempty"`
	Message       string `json:"message,omitempty"`
	FirmwareURL   string `json:"firmwareUrl,omitempty"`
	FilesystemURL string `json:"filesystemUrl,omitempty"`
	SHA256        string `json:"sha256,omitempty"`
}

func (f Frame) Normalize() Frame {
	f.V = NormalizeProtocolVersion(f.V)
	protocolVersion := f.V
	f.Provider = truncateUTF8Bytes(strings.TrimSpace(f.Provider), DefaultProviderBytes)
	f.Label = truncateUTF8Bytes(strings.TrimSpace(f.Label), DefaultProviderLabelBytes)
	if f.Session < 0 {
		f.Session = 0
	}
	if f.Session > 100 {
		f.Session = 100
	}
	if f.Weekly < 0 {
		f.Weekly = 0
	}
	if f.Weekly > 100 {
		f.Weekly = 100
	}
	if f.ResetSec < 0 {
		f.ResetSec = 0
	}
	f.UsageWindows = normalizeUsageWindows(firstNonEmptyUsageWindows(f.UsageWindows, f.UsageSlots))
	f = applyLegacyUsageProjection(f)
	if protocolVersion >= ProtocolVersionV2 {
		f.UsageSlots = nil
	} else {
		f.UsageSlots = legacyUsageSlots(f.UsageWindows)
		f.UsageWindows = nil
	}
	if f.SessionTokens < 0 {
		f.SessionTokens = 0
	}
	if f.WeekTokens < 0 {
		f.WeekTokens = 0
	}
	if f.TotalTokens < 0 {
		f.TotalTokens = 0
	}
	switch strings.TrimSpace(strings.ToLower(f.UsageMode)) {
	case "used", "remaining":
		f.UsageMode = strings.TrimSpace(strings.ToLower(f.UsageMode))
	default:
		f.UsageMode = ""
	}
	f.Time = strings.TrimSpace(f.Time)
	f.Date = strings.TrimSpace(f.Date)
	if f.NextClockTransition != nil && !validClockSchedule(*f.NextClockTransition) {
		f.NextClockTransition = nil
	}
	f.Activity = normalizeActivity(f.Activity)
	f.Theme = theme.Normalize(f.Theme)
	if len(f.ThemeSpec) > 0 && !json.Valid(f.ThemeSpec) {
		f.ThemeSpec = nil
	}
	if len(f.ThemeSpec) > 0 && strings.TrimSpace(string(f.ThemeSpec)) == "null" && !f.ConfirmClearThemeSpec {
		f.ThemeSpec = nil
	}
	if len(f.ThemeSpec) == 0 {
		f.ConfirmClearThemeSpec = false
	}
	if f.Update != nil {
		f.Update.LatestVersion = strings.TrimSpace(f.Update.LatestVersion)
		f.Update.Status = strings.TrimSpace(f.Update.Status)
		f.Update.LastError = strings.TrimSpace(f.Update.LastError)
		f.Update.Severity = strings.TrimSpace(f.Update.Severity)
		f.Update.Message = strings.TrimSpace(f.Update.Message)
		f.Update.FirmwareURL = strings.TrimSpace(f.Update.FirmwareURL)
		f.Update.FilesystemURL = strings.TrimSpace(f.Update.FilesystemURL)
		f.Update.SHA256 = strings.TrimSpace(f.Update.SHA256)
	}
	return f
}

func validClockSchedule(schedule ClockSchedule) bool {
	if !validClockOffset(schedule.CurrentOffsetMinutes) {
		return false
	}
	if schedule.TransitionEpoch == 0 {
		return schedule.OffsetMinutes == 0 &&
			schedule.FollowingTransitionEpoch == 0 &&
			schedule.FollowingOffsetMinutes == 0
	}
	if schedule.TransitionEpoch < minClockTransitionEpoch ||
		!validClockOffset(schedule.OffsetMinutes) {
		return false
	}
	if schedule.FollowingTransitionEpoch == 0 {
		return schedule.FollowingOffsetMinutes == 0
	}
	return schedule.FollowingTransitionEpoch > schedule.TransitionEpoch &&
		schedule.FollowingTransitionEpoch >= minClockTransitionEpoch &&
		validClockOffset(schedule.FollowingOffsetMinutes)
}

func validClockOffset(offsetMinutes int) bool {
	return offsetMinutes >= -720 && offsetMinutes <= 840 && offsetMinutes%15 == 0
}

func firstNonEmptyUsageWindows(windows []UsageWindow, slots []UsageSlot) []UsageWindow {
	if len(windows) > 0 {
		return windows
	}
	return slots
}

func normalizeUsageWindows(windows []UsageWindow) []UsageWindow {
	if len(windows) == 0 {
		return nil
	}
	out := make([]UsageWindow, 0, len(windows))
	for _, window := range windows {
		window.ID = truncateUTF8Bytes(strings.TrimSpace(strings.ToLower(window.ID)), DefaultUsageWindowIDBytes)
		window.Label = truncateUTF8Bytes(strings.TrimSpace(window.Label), DefaultUsageWindowLabelBytes)
		if window.Label == "" {
			window.Label = window.ID
		}
		window.Label = truncateUTF8Bytes(window.Label, DefaultUsageWindowLabelBytes)
		if window.ID == "" || window.Label == "" {
			continue
		}
		if window.Percent < 0 {
			window.Percent = 0
		}
		if window.Percent > 100 {
			window.Percent = 100
		}
		if window.ResetSec < 0 {
			window.ResetSec = 0
		}
		out = append(out, window)
	}
	return out
}

func legacyUsageSlots(windows []UsageWindow) []UsageSlot {
	if len(windows) == 0 {
		return nil
	}
	limit := minInt(len(windows), 2)
	out := make([]UsageSlot, limit)
	copy(out, windows[:limit])
	return out
}

func applyLegacyUsageProjection(f Frame) Frame {
	if len(f.UsageWindows) == 0 {
		return f
	}
	f.Session = f.UsageWindows[0].Percent
	f.ResetSec = 0
	for _, window := range f.UsageWindows {
		if window.ResetSec > 0 {
			f.ResetSec = window.ResetSec
			break
		}
	}
	if len(f.UsageWindows) > 1 {
		f.Weekly = f.UsageWindows[1].Percent
	} else {
		f.Weekly = 0
	}
	f.SessionUnavailable = false
	f.WeeklyUnavailable = len(f.UsageWindows) < 2
	return f
}

func reanchorResetSec(resetSec int64, age int64) int64 {
	if resetSec <= 0 || resetSec <= age {
		return 0
	}
	return resetSec - age
}

func clearResetCountdowns(f *Frame) {
	f.ResetSec = 0
	for i := range f.UsageWindows {
		f.UsageWindows[i].ResetSec = 0
	}
	for i := range f.UsageSlots {
		f.UsageSlots[i].ResetSec = 0
	}
}

func hasResetCountdown(f Frame) bool {
	if f.ResetSec > 0 {
		return true
	}
	for _, window := range f.UsageWindows {
		if window.ResetSec > 0 {
			return true
		}
	}
	for _, slot := range f.UsageSlots {
		if slot.ResetSec > 0 {
			return true
		}
	}
	return false
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func truncateUTF8Bytes(value string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(value) <= maxBytes {
		return value
	}
	value = value[:maxBytes]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}

func (f Frame) MarshalLine() ([]byte, error) {
	return f.Normalize().MarshalNormalizedLine()
}

// MarshalNormalizedLine serializes a frame that has already been normalized.
// It is for callers that need the normalized frame as well as its wire form.
func (f Frame) MarshalNormalizedLine() ([]byte, error) {
	b, err := json.Marshal(f)
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// ResetSourceKey identifies the provider plus usage window a reset deadline was
// derived from. A changed key means a different countdown, so the device must
// drop the previous deadline instead of continuing it.
func ResetSourceKey(provider string, window string) string {
	provider = strings.TrimSpace(provider)
	window = strings.TrimSpace(window)
	if provider == "" {
		return ""
	}
	if window == "" {
		return normalizeResetSource(provider)
	}
	return normalizeResetSource(provider + ":" + window)
}

// ApplyResetTrust re-anchors the reset deadline to sendAt and fills the
// freshness fields.
//
// The device has no wall clock, so nothing is expressed as an absolute time.
// Every value is a seconds count valid at the instant this frame is received:
// the device only has to tick `resetSecs` and `resetTrustSecs` down with its own
// monotonic clock. `resetSecs` reaching zero means the deadline passed;
// `resetTrustSecs` reaching zero means the basis is too old to be trusted, no
// matter how long the device was without updates or how often it rebooted.
//
// collectedAt is when the underlying usage data was read, sendAt when this frame
// leaves the host, and sourceLive reports whether that data is current rather
// than a resend of the last known good frame.
func (f Frame) ApplyResetTrust(collectedAt time.Time, sendAt time.Time, sourceLive bool) Frame {
	if sendAt.IsZero() {
		sendAt = time.Now()
	}
	basisKnown := !collectedAt.IsZero()
	age := int64(0)
	if basisKnown && sendAt.After(collectedAt) {
		age = int64(sendAt.Sub(collectedAt) / time.Second)
	}
	horizon := int64(ResetTrustHorizon / time.Second)

	f.ResetAgeSec = age
	f.ResetTrustSec = horizon - age
	if f.ResetTrustSec < 0 {
		f.ResetTrustSec = 0
	}
	f.ResetSec = reanchorResetSec(f.ResetSec, age)
	for i := range f.UsageWindows {
		f.UsageWindows[i].ResetSec = reanchorResetSec(f.UsageWindows[i].ResetSec, age)
	}
	for i := range f.UsageSlots {
		f.UsageSlots[i].ResetSec = reanchorResetSec(f.UsageSlots[i].ResetSec, age)
	}
	if f.ResetSource == "" {
		f.ResetSource = ResetSourceKey(f.Provider, "")
	}

	switch {
	case !basisKnown, !hasResetCountdown(f), f.ResetTrustSec <= 0, f.ResetSource == "":
		// Expired, unknown, or unattributable: never hand the device a number
		// it could keep counting down as if it were real.
		f.ResetTrust = ResetTrustStale
		clearResetCountdowns(&f)
		f.ResetTrustSec = 0
	case !sourceLive:
		f.ResetTrust = ResetTrustOffline
	default:
		f.ResetTrust = ResetTrustLive
	}
	return f.Normalize()
}

func normalizeResetSource(raw string) string {
	source := strings.TrimSpace(strings.ToLower(raw))
	if source == "" || len(source) > 31 {
		return ""
	}
	for _, r := range source {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == ':' || r == '.' {
			continue
		}
		return ""
	}
	return source
}

func normalizeActivity(raw string) string {
	activity := strings.TrimSpace(strings.ToLower(raw))
	if activity == "" || len(activity) > 31 {
		return ""
	}
	for _, r := range activity {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return ""
	}
	return activity
}

func ErrorFrame(msg string) Frame {
	return Frame{V: ProtocolVersionV1, Error: msg}
}
