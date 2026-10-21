package companionapi

import (
	"context"
	"strconv"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
)

const usageBarsPreferenceID = "codexbar.usageBarsShowUsed"

// CodexBar owns this setting. The registry transports it without storing a
// VibeTV copy; Win-CodexBar has no equivalent setting yet (#874).
type usagePreferenceAdapter struct {
	goos  string
	read  func() bool
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
	return a.descriptor(), nil
}

func (a usagePreferenceAdapter) descriptor() preferenceDescriptor {
	value := strconv.FormatBool(a.read())
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
		Availability:  preferenceAvailability{State: "available"},
		WriteStrategy: "codexbar_command",
		Writable:      !codexbar.UsageBarsShowUsedOverridden(),
	}
}
