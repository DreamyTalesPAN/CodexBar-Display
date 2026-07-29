package protocol

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

const (
	DefaultUsageWindowLabelBytes = 24
	DefaultUsageWindowIDBytes    = 32
)

type UsageWindow struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Percent  int    `json:"percent"`
	ResetSec int64  `json:"resetSecs"`
}

type UsageSlot = UsageWindow

type Frame struct {
	V                     int             `json:"v"`
	Provider              string          `json:"provider,omitempty"`
	Label                 string          `json:"label,omitempty"`
	Session               int             `json:"session,omitempty"`
	Weekly                int             `json:"weekly,omitempty"`
	ResetSec              int64           `json:"resetSecs,omitempty"`
	UsageUnavailable      bool            `json:"usageUnavailable,omitempty"`
	SessionUnavailable    bool            `json:"sessionUnavailable,omitempty"`
	WeeklyUnavailable     bool            `json:"weeklyUnavailable,omitempty"`
	UsageMode             string          `json:"usageMode,omitempty"`
	UsageWindows          []UsageWindow   `json:"usageWindows,omitempty"`
	UsageSlots            []UsageSlot     `json:"usageSlots,omitempty"`
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
	protocolVersion := f.V
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
	f.ResetSec = f.UsageWindows[0].ResetSec
	if len(f.UsageWindows) > 1 {
		f.Weekly = f.UsageWindows[1].Percent
	} else {
		f.Weekly = 0
	}
	f.SessionUnavailable = false
	f.WeeklyUnavailable = len(f.UsageWindows) < 2
	return f
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
	n := f.Normalize()
	b, err := json.Marshal(n)
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
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
