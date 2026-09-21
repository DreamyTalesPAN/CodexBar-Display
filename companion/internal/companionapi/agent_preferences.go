package companionapi

import (
	"context"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type agentPreferenceAdapter struct{ server *Server }

func (agentPreferenceAdapter) Section() string { return "agents" }
func (agentPreferenceAdapter) Owns(id string) bool {
	switch id {
	case "vibetv.agents.enabled", "vibetv.agents.blink", "vibetv.agents.reminder", "vibetv.agents.quiet":
		return true
	}
	return false
}
func (a agentPreferenceAdapter) List(context.Context) ([]preferenceDescriptor, error) {
	cfg, err := a.server.loadConfigNormalized()
	if err != nil {
		return nil, err
	}
	s := cfg.AgentActivitySettings()
	items := []preferenceDescriptor{
		{ID: "vibetv.agents.enabled", Type: preferenceTypeBoolean, Label: "Show agent activity", Description: "Off means VibeTV shows usage only.", Value: s.Enabled},
		{ID: "vibetv.agents.blink", Type: preferenceTypeBoolean, Label: "Blink the screen when an agent needs you", Description: "Two short blinks, then the line stays.", Value: s.Blink},
		{ID: "vibetv.agents.reminder", Type: preferenceTypeEnum, Label: "Remind me again", Description: "While a session is still waiting.", Value: s.Reminder, Options: []preferenceOption{{"5", "After 5 minutes"}, {"15", "After 15 minutes"}, {"never", "Never"}}},
		{ID: "vibetv.agents.quiet", Type: preferenceTypeEnum, Label: "Quiet from", Description: "No blinks at night. The line still updates.", Value: s.Quiet, Options: []preferenceOption{{"off", "Never quiet"}, {"22", "22:00 to 08:00"}, {"00", "00:00 to 07:00"}}},
	}
	for i := range items {
		items[i].Section = "agents"
		items[i].Owner = "vibetv"
		items[i].EffectiveValue = items[i].Value
		items[i].Writable = true
		items[i].Availability = preferenceAvailability{State: "available"}
		items[i].WriteStrategy = "vibetv_override"
	}
	return items, nil
}
func (a agentPreferenceAdapter) Write(ctx context.Context, id string, value any) (preferenceDescriptor, error) {
	if !a.Owns(id) {
		return preferenceDescriptor{}, errPreferenceNotFound
	}
	_, err := a.server.updateConfig(func(cfg *runtimeconfig.Config) {
		s := cfg.AgentActivitySettings()
		switch id {
		case "vibetv.agents.enabled":
			s.Enabled = value.(bool)
		case "vibetv.agents.blink":
			s.Blink = value.(bool)
		case "vibetv.agents.reminder":
			s.Reminder = value.(string)
		case "vibetv.agents.quiet":
			s.Quiet = value.(string)
		}
		cfg.AgentActivity = &s
	})
	if err != nil {
		return preferenceDescriptor{}, err
	}
	items, err := a.List(ctx)
	for _, item := range items {
		if item.ID == id {
			return item, err
		}
	}
	return preferenceDescriptor{}, errPreferenceNotFound
}
