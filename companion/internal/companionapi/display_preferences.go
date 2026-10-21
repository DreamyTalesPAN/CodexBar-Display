package companionapi

import (
	"context"
	"strconv"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
)

// Used or Remaining is CodexBar's own choice (usageBarsShowUsed); VibeTV keeps
// no second copy of it (AGENTS.md, CodexBar Integration Boundary).
const (
	displayRotatePreferenceID = "vibetv.display.rotateSeconds"
	displayPacePreferenceID   = "vibetv.display.showPace"
)

// displayPreferenceAdapter serves the VibeTV-owned display preference. It
// lives in the runtime config, where the display worker reads it every cycle.
type displayPreferenceAdapter struct {
	server *Server
}

func (displayPreferenceAdapter) Section() string { return "display" }

func (displayPreferenceAdapter) Owns(settingID string) bool {
	return settingID == displayRotatePreferenceID || settingID == displayPacePreferenceID
}

func (a displayPreferenceAdapter) List(context.Context) ([]preferenceDescriptor, error) {
	cfg, err := a.server.config()
	if err != nil {
		return nil, err
	}
	return []preferenceDescriptor{displayRotateDescriptor(cfg), displayPaceDescriptor(cfg)}, nil
}

func (a displayPreferenceAdapter) Write(_ context.Context, settingID string, value any) (preferenceDescriptor, error) {
	// The registry has validated the value: a registered option, or a boolean.
	cfg, err := a.server.updateConfig(func(cfg *runtimeconfig.Config) {
		if settingID == displayPacePreferenceID {
			show, _ := value.(bool)
			cfg.HidePace = !show
			return
		}
		option, _ := value.(string)
		cfg.DisplayRotateSeconds, _ = strconv.Atoi(option)
	})
	if err != nil {
		return preferenceDescriptor{}, err
	}
	if a.server.renderDisplayStream != nil {
		a.server.renderDisplayStream()
	}
	if settingID == displayPacePreferenceID {
		return displayPaceDescriptor(cfg), nil
	}
	return displayRotateDescriptor(cfg), nil
}

// displayPaceDescriptor is the switch of the Pace section: CodexBar's reserve
// or deficit on the VibeTV themes that have a place for it. On by default. It
// only changes what the frame carries; Usage keeps showing pace.
func displayPaceDescriptor(cfg runtimeconfig.Config) preferenceDescriptor {
	return preferenceDescriptor{
		ID:             displayPacePreferenceID,
		Section:        "display",
		Owner:          "vibetv",
		Type:           preferenceTypeBoolean,
		Label:          "Show reserve or deficit",
		Value:          !cfg.HidePace,
		EffectiveValue: !cfg.HidePace,
		Availability:   preferenceAvailability{State: "available"},
		WriteStrategy:  "vibetv_override",
		Writable:       true,
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
