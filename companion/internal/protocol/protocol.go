package protocol

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

type UsageSlot struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Percent  int    `json:"percent"`
	ResetSec int64  `json:"resetSecs"`
}

type Frame struct {
	V                     int             `json:"v"`
	Provider              string          `json:"provider,omitempty"`
	Label                 string          `json:"label,omitempty"`
	Session               int             `json:"session,omitempty"`
	Weekly                int             `json:"weekly,omitempty"`
	ResetSec              int64           `json:"resetSecs,omitempty"`
	UsageUnavailable      bool            `json:"usageUnavailable,omitempty"`
	UsageMode             string          `json:"usageMode,omitempty"`
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
	f.UsageSlots = normalizeUsageSlots(f.UsageSlots)
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

func normalizeUsageSlots(slots []UsageSlot) []UsageSlot {
	if len(slots) == 0 {
		return nil
	}
	out := make([]UsageSlot, 0, 2)
	for _, slot := range slots {
		if len(out) == 2 {
			break
		}
		slot.ID = truncateUTF8Bytes(strings.TrimSpace(strings.ToLower(slot.ID)), 32)
		slot.Label = truncateUTF8Bytes(strings.TrimSpace(slot.Label), 24)
		if slot.Label == "" {
			slot.Label = slot.ID
		}
		slot.Label = truncateUTF8Bytes(slot.Label, 24)
		if slot.ID == "" || slot.Label == "" {
			continue
		}
		if slot.Percent < 0 {
			slot.Percent = 0
		}
		if slot.Percent > 100 {
			slot.Percent = 100
		}
		if slot.ResetSec < 0 {
			slot.ResetSec = 0
		}
		out = append(out, slot)
	}
	return out
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
