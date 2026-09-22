package runtimeconfig

import (
	"strconv"
	"time"
)

// The master switch is opt-in because enabling it installs local observation
// hooks for every supported agent. Other presentation defaults follow the design.
type AgentActivitySettings struct {
	DoneDuration string `json:"doneDuration,omitempty"`
	Enabled      bool   `json:"enabled"`
	Blink        bool   `json:"blink"`
	Reminder     string `json:"reminder"`
	Quiet        string `json:"quiet"`
}

func (c Config) AgentActivitySettings() AgentActivitySettings {
	if c.AgentActivity != nil {
		s := *c.AgentActivity
		s.DoneDuration = strconv.Itoa(s.DoneSeconds())
		return s
	}
	return AgentActivitySettings{DoneDuration: "30", Enabled: false, Blink: true, Reminder: "5", Quiet: "off"}
}

func (s AgentActivitySettings) Muted(now time.Time) bool {
	if !s.Enabled || !s.Blink {
		return true
	}
	h := now.Hour()
	return s.Quiet == "22" && (h >= 22 || h < 8) || s.Quiet == "00" && h < 7
}

func (s AgentActivitySettings) ReminderSeconds() int {
	switch s.Reminder {
	case "5":
		return 300
	case "15":
		return 900
	}
	return 0
}

func (s AgentActivitySettings) DoneSeconds() int {
	switch s.DoneDuration {
	case "10", "30", "60", "120", "300":
		seconds, _ := strconv.Atoi(s.DoneDuration)
		return seconds
	}
	return 30
}
