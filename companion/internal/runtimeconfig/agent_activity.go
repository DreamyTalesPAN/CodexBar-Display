package runtimeconfig

import "time"

// Presentation preferences belong to VibeTV; observation and usage keep their
// existing owners. A missing section uses the approved design defaults.
type AgentActivitySettings struct {
	Enabled  bool   `json:"enabled"`
	Blink    bool   `json:"blink"`
	Reminder string `json:"reminder"`
	Quiet    string `json:"quiet"`
}

func (c Config) AgentActivitySettings() AgentActivitySettings {
	if c.AgentActivity != nil {
		return *c.AgentActivity
	}
	return AgentActivitySettings{Enabled: true, Blink: true, Reminder: "5", Quiet: "off"}
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
