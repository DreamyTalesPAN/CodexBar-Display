package themeinstall

import (
	"context"
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/themepack"
)

// A device that predates provider slots can be updated into supporting them, so
// a pack requiring them must reach the firmware preflight instead of being
// refused outright.
func TestProviderSlotPackReachesTheFirmwareUpdater(t *testing.T) {
	pack := &themepack.Pack{
		Manifest: themepack.Manifest{
			Kind:                 "vibetv-theme-pack",
			Schema:               1,
			ID:                   "night-clock",
			Name:                 "Night Clock",
			RequiredCapabilities: []string{protocol.FeatureUsageSlotsV1, protocol.FeatureProviderSlotsV1},
		},
	}
	caps := protocol.DeviceCapabilities{
		Known:                true,
		SupportsThemeSpecV1:  true,
		SupportsUsageSlotsV1: true,
	}
	opts := Options{FirmwareUpdater: func(context.Context, string, string) error { return nil }}

	err := pack.ValidateAgainstCapabilities(caps)
	if err == nil {
		t.Fatal("expected the pack to be rejected on firmware without provider slots")
	}
	if !canRetryAfterThemeCapabilityFirmwareUpdate(pack, caps, err, opts) {
		t.Fatal("a provider-slot pack must be eligible for the firmware preflight")
	}
}

// Without a way to supply the capability there is nothing to retry.
func TestProviderSlotPackWithoutUpdaterIsNotEligible(t *testing.T) {
	pack := &themepack.Pack{
		Manifest: themepack.Manifest{
			Kind:                 "vibetv-theme-pack",
			Schema:               1,
			ID:                   "night-clock",
			Name:                 "Night Clock",
			RequiredCapabilities: []string{protocol.FeatureProviderSlotsV1},
		},
	}
	caps := protocol.DeviceCapabilities{Known: true, SupportsThemeSpecV1: true}
	err := errors.New("device does not advertise provider-slots-v1")

	if canRetryAfterThemeCapabilityFirmwareUpdate(pack, caps, err, Options{}) {
		t.Fatal("without a firmware updater nothing is eligible")
	}
}
