package protocol

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

// Reset trust states carried in a frame. The device re-evaluates trust with its
// own monotonic clock and may only downgrade the host value, never upgrade it.
const (
	ResetTrustLive    = "live"
	ResetTrustOffline = "offline"
	ResetTrustStale   = "stale"
)

// ResetTrustHorizon is how long a collected reset deadline stays trustworthy
// without fresh data.
const ResetTrustHorizon = 5 * time.Hour

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
	Time                  string          `json:"time,omitempty"`
	Date                  string          `json:"date,omitempty"`
	SessionTokens         int64           `json:"sessionTokens,omitempty"`
	WeekTokens            int64           `json:"weekTokens,omitempty"`
	TotalTokens           int64           `json:"totalTokens,omitempty"`
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
	if f.ResetAgeSec < 0 {
		f.ResetAgeSec = 0
	}
	if f.ResetTrustSec < 0 {
		f.ResetTrustSec = 0
	}
	f.ResetSource = normalizeResetSource(f.ResetSource)
	f.ResetTrust = normalizeResetTrust(f.ResetTrust)
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

func (f Frame) MarshalLine() ([]byte, error) {
	n := f.Normalize()
	b, err := json.Marshal(n)
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
	if f.ResetSec > 0 {
		f.ResetSec -= age
		if f.ResetSec < 0 {
			f.ResetSec = 0
		}
	}
	if f.ResetSource == "" {
		f.ResetSource = ResetSourceKey(f.Provider, "")
	}

	switch {
	case !basisKnown, f.ResetSec <= 0, f.ResetTrustSec <= 0, f.ResetSource == "":
		// Expired, unknown, or unattributable: never hand the device a number
		// it could keep counting down as if it were real.
		f.ResetTrust = ResetTrustStale
		f.ResetSec = 0
		f.ResetTrustSec = 0
	case !sourceLive:
		f.ResetTrust = ResetTrustOffline
	default:
		f.ResetTrust = ResetTrustLive
	}
	return f.Normalize()
}

func normalizeResetTrust(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case ResetTrustLive:
		return ResetTrustLive
	case ResetTrustOffline:
		return ResetTrustOffline
	case ResetTrustStale:
		return ResetTrustStale
	default:
		return ""
	}
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
