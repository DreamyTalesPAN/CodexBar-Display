package companionapi

import (
	"context"
	"errors"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

type agentPreferenceAdapter struct{ server *Server }

func (agentPreferenceAdapter) Section() string { return "agents" }
func (agentPreferenceAdapter) Owns(id string) bool {
	switch id {
	case "vibetv.agents.enabled", "vibetv.agents.blink", "vibetv.agents.reminder", "vibetv.agents.quiet", "vibetv.agents.doneDuration":
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
		{ID: "vibetv.agents.enabled", Type: preferenceTypeBoolean, Label: "Show agent activity", Description: "For all supported agents. Off means VibeTV shows usage only.", Value: s.Enabled},
		{ID: "vibetv.agents.doneDuration", Type: preferenceTypeEnum, Label: "Keep ‘Done’ on screen", Description: "How long a finished session stays visible. New activity takes over immediately.", Value: s.DoneDuration, Options: []preferenceOption{{"10", "10 seconds"}, {"30", "30 seconds"}, {"60", "1 minute"}, {"120", "2 minutes"}, {"300", "5 minutes"}}},
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
	a.server.agentPreferencesMu.Lock()
	defer a.server.agentPreferencesMu.Unlock()
	previous, err := a.server.loadConfigNormalized()
	if err != nil {
		return preferenceDescriptor{}, err
	}
	if id == "vibetv.agents.enabled" {
		if a.server.configureAgents == nil {
			return preferenceDescriptor{}, errors.New("agent activity is unavailable")
		}
		if _, err := a.server.configureAgents(ctx, value.(bool)); err != nil {
			return preferenceDescriptor{}, err
		}
	}
	_, err = a.server.updateConfig(func(cfg *runtimeconfig.Config) {
		s := cfg.AgentActivitySettings()
		switch id {
		case "vibetv.agents.enabled":
			s.Enabled = value.(bool)
		case "vibetv.agents.blink":
			s.Blink = value.(bool)
		case "vibetv.agents.reminder":
			s.Reminder = value.(string)
		case "vibetv.agents.doneDuration":
			s.DoneDuration = value.(string)
		case "vibetv.agents.quiet":
			s.Quiet = value.(string)
		}
		cfg.AgentActivity = &s
	})
	if err != nil {
		if id == "vibetv.agents.enabled" {
			_, rollbackErr := a.server.configureAgents(context.WithoutCancel(ctx), previous.AgentActivitySettings().Enabled)
			err = errors.Join(err, rollbackErr)
		}
		return preferenceDescriptor{}, err
	}
	if a.server.renderDisplayStream != nil {
		a.server.renderDisplayStream()
	}
	items, err := a.List(ctx)
	for _, item := range items {
		if item.ID == id {
			return item, err
		}
	}
	return preferenceDescriptor{}, errPreferenceNotFound
}
