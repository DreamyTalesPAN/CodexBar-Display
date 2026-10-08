package companionapi

import (
	"context"
	"strconv"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

const (
	usageDisplayModePreferenceID = "vibetv.usage.displayMode"
	displayRotatePreferenceID    = "vibetv.display.rotateSeconds"
)

// displayPreferenceAdapter serves the VibeTV-owned display preferences. They
// live in the runtime config, where the display worker reads them every cycle.
type displayPreferenceAdapter struct {
	server *Server
}

func (displayPreferenceAdapter) Section() string { return "display" }

func (displayPreferenceAdapter) Owns(settingID string) bool {
	return settingID == usageDisplayModePreferenceID || settingID == displayRotatePreferenceID
}

func (a displayPreferenceAdapter) List(context.Context) ([]preferenceDescriptor, error) {
	cfg, err := a.server.config()
	if err != nil {
		return nil, err
	}
	return []preferenceDescriptor{usageDisplayModeDescriptor(cfg), displayRotateDescriptor(cfg)}, nil
}

func (a displayPreferenceAdapter) Write(_ context.Context, settingID string, value any) (preferenceDescriptor, error) {
	// The registry has validated the value: a registered option, or nil for
	// Default.
	option, _ := value.(string)
	cfg, err := a.server.updateConfig(func(cfg *runtimeconfig.Config) {
		if settingID == displayRotatePreferenceID {
			cfg.DisplayRotateSeconds, _ = strconv.Atoi(option)
		} else {
			cfg.UsageDisplayMode = option
		}
	})
	if err != nil {
		return preferenceDescriptor{}, err
	}
	if a.server.renderDisplayStream != nil {
		a.server.renderDisplayStream()
	}
	if settingID == displayRotatePreferenceID {
		return displayRotateDescriptor(cfg), nil
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

// displayRotateDescriptor is the timed rotation of Automatic (issue #322). It
// is a preference of its own rather than part of /v1/provider-display, whose
// body the Control Center rewrites whenever the provider pool changes.
func displayRotateDescriptor(cfg runtimeconfig.Config) preferenceDescriptor {
	value := strconv.Itoa(cfg.DisplayRotateSeconds)
	return preferenceDescriptor{
		ID:             displayRotatePreferenceID,
		Section:        "display",
		Owner:          "vibetv",
		Type:           preferenceTypeEnum,
		Label:          "Switch providers",
		Value:          value,
		EffectiveValue: value,
		Options: []preferenceOption{
			{Value: "0", Label: "When activity changes"},
			{Value: "30", Label: "Every 30 seconds"},
			{Value: "60", Label: "Every minute"},
			{Value: "300", Label: "Every 5 minutes"},
		},
		Availability:  preferenceAvailability{State: "available"},
		WriteStrategy: "vibetv_override",
		Writable:      true,
	}
}
