package themespec

import (
	"encoding/json"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestValidateAcceptsMinimalV1Spec(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		FallbackTheme:    "mini",
		Primitives: []Primitive{
			{Type: "rect", X: 0, Y: 0, Width: 120, Height: 80, Color: "#001122"},
			{Type: "text", X: 8, Y: 20, Text: "Codex", FontSize: 2, Color: "#FFFFFF"},
		},
	}

	if err := Validate(spec); err != nil {
		t.Fatalf("expected valid spec, got %v", err)
	}
}

func TestValidateRejectsUnknownPrimitiveType(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{Type: "triangle", X: 0, Y: 0, Width: 10, Height: 10},
		},
	}

	if err := Validate(spec); err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestValidateAgainstCapabilitiesChecksLimits(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		FallbackTheme:    "mini",
		Primitives: []Primitive{
			{Type: "text", X: 1, Y: 1, Text: "hello"},
			{Type: "rect", X: 0, Y: 0, Width: 10, Height: 10},
		},
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		t.Fatalf("marshal raw: %v", err)
	}

	caps := protocol.DeviceCapabilities{
		Known:               true,
		SupportsThemeSpecV1: true,
		MaxThemeSpecBytes:   len(raw) - 1,
		MaxThemePrimitives:  1,
		BuiltinThemes:       []string{"classic", "mini"},
	}
	if err := ValidateAgainstCapabilities(spec, raw, caps); err == nil {
		t.Fatalf("expected capability mismatch")
	}
}

func TestValidateAgainstCapabilitiesAcceptsCompatibleSpec(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		FallbackTheme:    "mini",
		Primitives: []Primitive{
			{Type: "text", X: 1, Y: 1, Text: "hello"},
		},
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		t.Fatalf("marshal raw: %v", err)
	}

	caps := protocol.DeviceCapabilities{
		Known:               true,
		SupportsThemeSpecV1: true,
		MaxThemeSpecBytes:   len(raw) + 10,
		MaxThemePrimitives:  8,
		BuiltinThemes:       []string{"classic", "mini"},
	}
	if err := ValidateAgainstCapabilities(spec, raw, caps); err != nil {
		t.Fatalf("expected compatible spec, got %v", err)
	}
}
