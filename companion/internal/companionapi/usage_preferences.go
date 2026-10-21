package companionapi

import (
	"context"
	"errors"
	"strconv"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

const usageBarsPreferenceID = "codexbar.usageBarsShowUsed"

// CodexBar owns this setting. The registry transports it without storing a
// VibeTV copy; Win-CodexBar has no equivalent setting yet (#874).
type usagePreferenceAdapter struct {
	goos  string
	read  func() (bool, error)
	write func(context.Context, bool) error
}

func (usagePreferenceAdapter) Section() string { return "display" }

func (usagePreferenceAdapter) Owns(settingID string) bool {
	return settingID == usageBarsPreferenceID
}

func (a usagePreferenceAdapter) List(context.Context) ([]preferenceDescriptor, error) {
	if a.goos != "darwin" {
		return nil, nil
	}
	return []preferenceDescriptor{a.descriptor()}, nil
}

func (a usagePreferenceAdapter) Write(ctx context.Context, _ string, value any) (preferenceDescriptor, error) {
	// The registry validates that this is one of the two registered options.
	if err := a.write(ctx, value == "true"); err != nil {
		return preferenceDescriptor{}, err
	}
	descriptor := a.descriptor()
	if descriptor.Availability.State != "available" || descriptor.Value != value {
		return preferenceDescriptor{}, errors.New("CodexBar usage preference could not be confirmed")
	}
	return descriptor, nil
}

func (a usagePreferenceAdapter) descriptor() preferenceDescriptor {
	showUsed, err := a.read()
	var value any
	availability := preferenceAvailability{State: "unavailable"}
	if err == nil {
		value = strconv.FormatBool(showUsed)
		availability.State = "available"
	}
	return preferenceDescriptor{
		ID:             usageBarsPreferenceID,
		Section:        "display",
		Owner:          "codexbar",
		Type:           preferenceTypeEnum,
		Label:          "Show",
		Value:          value,
		EffectiveValue: value,
		Options: []preferenceOption{
			{Value: "true", Label: "Used"},
			{Value: "false", Label: "Remaining"},
		},
		Availability:  availability,
		WriteStrategy: "codexbar_command",
		Writable:      !codexbar.UsageBarsShowUsedOverridden(),
	}
}
