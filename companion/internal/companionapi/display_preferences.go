package companionapi

import (
	"context"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

const usageDisplayModePreferenceID = "vibetv.usage.displayMode"

// displayPreferenceAdapter serves the VibeTV-owned display preferences. They
// live in the runtime config, where the display worker reads them every cycle.
type displayPreferenceAdapter struct {
	server *Server
}

func (displayPreferenceAdapter) Section() string { return "display" }

func (displayPreferenceAdapter) Owns(settingID string) bool {
	return settingID == usageDisplayModePreferenceID
}

func (a displayPreferenceAdapter) List(context.Context) ([]preferenceDescriptor, error) {
	cfg, err := a.server.config()
	if err != nil {
		return nil, err
	}
	return []preferenceDescriptor{usageDisplayModeDescriptor(cfg)}, nil
}

func (a displayPreferenceAdapter) Write(_ context.Context, _ string, value any) (preferenceDescriptor, error) {
	// The registry has validated the value: a registered option, or nil for
	// Default.
	mode, _ := value.(string)
	cfg, err := a.server.updateConfig(func(cfg *runtimeconfig.Config) {
		cfg.UsageDisplayMode = mode
	})
	if err != nil {
		return preferenceDescriptor{}, err
	}
	if a.server.renderDisplayStream != nil {
		a.server.renderDisplayStream()
	}
	return usageDisplayModeDescriptor(cfg), nil
}

func usageDisplayModeDescriptor(cfg runtimeconfig.Config) preferenceDescriptor {
	var value any
	if cfg.UsageDisplayMode != "" {
		value = cfg.UsageDisplayMode
	}
	effective := "remaining"
	if cfg.UsageShowsUsed(codexbar.UsageBarsShowUsed) {
		effective = "used"
	}
	return preferenceDescriptor{
		ID:             usageDisplayModePreferenceID,
		Section:        "display",
		Owner:          "vibetv",
		Type:           preferenceTypeEnum,
		Label:          "Usage display",
		Value:          value,
		EffectiveValue: effective,
		AllowsDefault:  true,
		Options: []preferenceOption{
			{Value: "used", Label: "Used"},
			{Value: "remaining", Label: "Remaining"},
		},
		Availability:  preferenceAvailability{State: "available"},
		WriteStrategy: "vibetv_override",
		Writable:      true,
	}
}
