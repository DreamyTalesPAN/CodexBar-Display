package protocol

import (
	"encoding/json"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/theme"
)

type Frame struct {
	V             int             `json:"v"`
	Provider      string          `json:"provider,omitempty"`
	Label         string          `json:"label,omitempty"`
	Session       int             `json:"session,omitempty"`
	Weekly        int             `json:"weekly,omitempty"`
	ResetSec      int64           `json:"resetSecs,omitempty"`
	UsageMode     string          `json:"usageMode,omitempty"`
	SessionTokens int64           `json:"sessionTokens,omitempty"`
	WeekTokens    int64           `json:"weekTokens,omitempty"`
	TotalTokens   int64           `json:"totalTokens,omitempty"`
	Theme         string          `json:"theme,omitempty"`
	ThemeSpec     json.RawMessage `json:"themeSpec,omitempty"`
	Error         string          `json:"error,omitempty"`
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
	f.Theme = theme.Normalize(f.Theme)
	if len(f.ThemeSpec) > 0 && !json.Valid(f.ThemeSpec) {
		f.ThemeSpec = nil
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

func ErrorFrame(msg string) Frame {
	return Frame{V: ProtocolVersionV1, Error: msg}
}
