package themespec

import (
	"encoding/json"
	"strings"
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
			{Type: "text", X: 8, Y: 48, Binding: "label", FontSize: 2, Color: "#FFFFFF"},
			{Type: "gif", X: 80, Y: 96, Width: 64, Height: 64, AssetPath: "/themes/mini/mini.gif"},
			{Type: "sprite", X: 24, Y: 116, Width: 32, Height: 32, AssetPath: "/themes/u/hero.cba"},
			{Type: "pixels", X: 4, Y: 4, Width: 8, Height: 2, Color: "#FFFFFF", Data: "A5F0"},
		},
	}

	if err := Validate(spec); err != nil {
		t.Fatalf("expected valid spec, got %v", err)
	}
}

func TestValidateAcceptsCompactV1Spec(t *testing.T) {
	raw := []byte(`{
		"v":1,
		"id":"mini-transport",
		"rev":1,
		"fb":"mini",
		"p":[
			{"t":"tx","x":8,"y":20,"v":"Codex","s":2,"c":"#FFFFFF"},
			{"t":"tx","x":8,"y":48,"b":"l","s":2,"c":"#FFFFFF"},
			{"t":"g","x":80,"y":96,"w":64,"h":64,"a":"/themes/mini/mini.gif"},
			{"t":"sp","x":24,"y":116,"w":32,"h":32,"a":"/themes/u/hero.cba"},
			{"t":"p","x":8,"y":72,"w":120,"h":14,"br":7,"b":"s","c":"#CCFF00"},
			{"t":"px","x":4,"y":4,"w":8,"h":2,"c":"#FFFFFF","d":"A5F0"}
		]
	}`)
	var spec Spec
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("unmarshal compact spec: %v", err)
	}

	if err := Validate(spec); err != nil {
		t.Fatalf("expected compact spec to validate, got %v", err)
	}
	if got := normalizeSpec(spec).Primitives[4].BorderRadius; got != 7 {
		t.Fatalf("expected compact border radius 7, got %d", got)
	}
}

func TestValidateRejectsBorderRadiusOutsideSupportedRange(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{Type: "progress", Width: 120, Height: 14, BorderRadius: 121},
		},
	}

	if err := Validate(spec); err == nil || !strings.Contains(err.Error(), "borderRadius") {
		t.Fatalf("expected borderRadius validation error, got %v", err)
	}
}

func TestValidateRejectsInvalidPixelsData(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{Type: "pixels", X: 0, Y: 0, Width: 8, Height: 2, Color: "#FFFFFF", Data: "A5"},
		},
	}

	if err := Validate(spec); err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestValidateAcceptsMulticolorPixelsRLE(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{
				Type:    "pixels",
				X:       0,
				Y:       0,
				Width:   16,
				Height:  2,
				Palette: []string{"#FF0000", "#00FF00"},
				Rows:    []string{"5.4a7.", "2b12.2a"},
			},
		},
	}

	if err := Validate(spec); err != nil {
		t.Fatalf("expected valid multicolor pixels spec, got %v", err)
	}
}

func TestValidateRejectsInvalidMulticolorPixelsRLE(t *testing.T) {
	tests := []struct {
		name      string
		primitive Primitive
	}{
		{
			name: "row count mismatch",
			primitive: Primitive{
				Type:    "pixels",
				Width:   4,
				Height:  2,
				Palette: []string{"#FF0000"},
				Rows:    []string{"4a"},
			},
		},
		{
			name: "row width mismatch",
			primitive: Primitive{
				Type:    "pixels",
				Width:   4,
				Height:  1,
				Palette: []string{"#FF0000"},
				Rows:    []string{"3a"},
			},
		},
		{
			name: "palette index out of range",
			primitive: Primitive{
				Type:    "pixels",
				Width:   4,
				Height:  1,
				Palette: []string{"#FF0000"},
				Rows:    []string{"4b"},
			},
		},
		{
			name: "zero run length",
			primitive: Primitive{
				Type:    "pixels",
				Width:   4,
				Height:  1,
				Palette: []string{"#FF0000"},
				Rows:    []string{"0a4."},
			},
		},
		{
			name: "bad palette color",
			primitive: Primitive{
				Type:    "pixels",
				Width:   4,
				Height:  1,
				Palette: []string{"red"},
				Rows:    []string{"4a"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := Spec{
				ThemeSpecVersion: 1,
				ThemeID:          "mini-transport",
				ThemeRev:         1,
				Primitives:       []Primitive{tt.primitive},
			}

			if err := Validate(spec); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
}

func TestValidateRejectsUnsafeGifAssetPath(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{Type: "gif", X: 0, Y: 0, Width: 10, Height: 10, AssetPath: "/../mini.gif"},
		},
	}

	if err := Validate(spec); err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestValidateRejectsUnsafeSpriteAssetPath(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{Type: "sprite", X: 0, Y: 0, AssetPath: "/themes/../hero.cba"},
		},
	}

	if err := Validate(spec); err == nil {
		t.Fatalf("expected validation error")
	}
}

func TestValidateAcceptsStateAssetsForSpriteAndGif(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		Primitives: []Primitive{
			{
				Type:   "sprite",
				X:      0,
				Y:      0,
				Width:  24,
				Height: 24,
				StateAssets: map[string]string{
					"idle":   "/themes/u/idle.cbi",
					"coding": "/themes/u/coding.cbi",
				},
			},
			{
				Type:   "gif",
				X:      0,
				Y:      24,
				Width:  24,
				Height: 24,
				StateAssets: map[string]string{
					"idle": "/themes/u/idle.gif",
				},
			},
		},
	}

	if err := Validate(spec); err != nil {
		t.Fatalf("expected stateAssets spec to validate, got %v", err)
	}
}

func TestValidateAcceptsCompactStateAssets(t *testing.T) {
	raw := []byte(`{
		"v":1,
		"id":"mini-transport",
		"rev":1,
		"p":[
			{"t":"sp","x":0,"y":0,"w":24,"h":24,"sa":{"idle":"/themes/u/idle.cbi","coding":"/themes/u/coding.cbi"}}
		]
	}`)

	spec, _, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse compact stateAssets spec: %v", err)
	}
	if err := Validate(spec); err != nil {
		t.Fatalf("expected compact stateAssets spec to validate, got %v", err)
	}
	if got := spec.Primitives[0].StateAssets["coding"]; got != "/themes/u/coding.cbi" {
		t.Fatalf("compact stateAssets did not normalize, got %q", got)
	}
}

func TestValidateAcceptsCompactActivityBinding(t *testing.T) {
	raw := []byte(`{
		"v":1,
		"id":"mini-transport",
		"rev":1,
		"p":[
			{"t":"tx","x":0,"y":0,"s":1,"b":"act"}
		]
	}`)

	spec, _, err := Parse(raw)
	if err != nil {
		t.Fatalf("parse compact activity binding: %v", err)
	}
	if err := Validate(spec); err != nil {
		t.Fatalf("expected compact activity binding to validate, got %v", err)
	}
	if got := spec.Primitives[0].Binding; got != "activity" {
		t.Fatalf("compact activity binding did not expand, got %q", got)
	}
}

func TestValidateRejectsInvalidStateAssets(t *testing.T) {
	tests := []struct {
		name        string
		stateAssets map[string]string
	}{
		{
			name: "uppercase state",
			stateAssets: map[string]string{
				"Idle": "/themes/u/idle.cbi",
			},
		},
		{
			name: "unsafe path",
			stateAssets: map[string]string{
				"idle": "/themes/../idle.cbi",
			},
		},
		{
			name: "unsupported state",
			stateAssets: map[string]string{
				"thinking": "/themes/u/thinking.cbi",
			},
		},
		{
			name: "empty path",
			stateAssets: map[string]string{
				"idle": "",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := Spec{
				ThemeSpecVersion: 1,
				ThemeID:          "mini-transport",
				ThemeRev:         1,
				Primitives: []Primitive{
					{Type: "sprite", X: 0, Y: 0, Width: 24, Height: 24, StateAssets: tt.stateAssets},
				},
			}

			if err := Validate(spec); err == nil {
				t.Fatalf("expected validation error")
			}
		})
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

func TestValidateStoredAgainstCapabilitiesUsesStoredLimit(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "stored-theme",
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
	raw = append(raw, []byte(strings.Repeat(" ", 2300-len(raw)))...)

	caps := protocol.DeviceCapabilities{
		Known:                   true,
		SupportsThemeSpecV1:     true,
		SupportsStoredThemes:    true,
		MaxThemeSpecBytes:       2048,
		MaxStoredThemeSpecBytes: 4096,
		MaxThemePrimitives:      8,
		BuiltinThemes:           []string{"mini"},
	}
	if err := ValidateAgainstCapabilities(spec, raw, caps); err == nil {
		t.Fatalf("expected inline validation to reject 2300-byte spec")
	}
	if err := ValidateStoredAgainstCapabilities(spec, raw, caps); err != nil {
		t.Fatalf("expected stored validation to accept 2300-byte spec: %v", err)
	}

	caps.MaxStoredThemeSpecBytes = 2048
	if err := ValidateStoredAgainstCapabilities(spec, raw, caps); err == nil {
		t.Fatalf("expected stored validation to reject spec above stored limit")
	}
}

func TestValidateStoredAgainstCapabilitiesFallsBackToInlineLimit(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "legacy-theme",
		ThemeRev:         1,
		Primitives:       []Primitive{{Type: "text", X: 1, Y: 1, Text: "hello"}},
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		t.Fatalf("marshal raw: %v", err)
	}

	caps := protocol.DeviceCapabilities{
		Known:               true,
		SupportsThemeSpecV1: true,
		MaxThemeSpecBytes:   len(raw) - 1,
	}
	if err := ValidateStoredAgainstCapabilities(spec, raw, caps); err == nil {
		t.Fatalf("expected legacy inline limit fallback to reject oversized stored spec")
	}
}

func TestValidateAgainstCapabilitiesChecksGifLimits(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "mini-transport",
		ThemeRev:         1,
		FallbackTheme:    "mini",
		Primitives: []Primitive{
			{Type: "gif", X: 0, Y: 0, Width: 96, Height: 80, AssetPath: "/themes/u/too-big.gif"},
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
		MaxThemeGifAssets:   1,
		MaxThemeGifWidth:    80,
		MaxThemeGifHeight:   80,
		MaxThemeGifPixels:   6400,
		BuiltinThemes:       []string{"mini"},
	}
	if err := ValidateAgainstCapabilities(spec, raw, caps); err == nil {
		t.Fatalf("expected GIF capability mismatch")
	}
}

func TestValidateAgainstCapabilitiesChecksPrimitiveTypes(t *testing.T) {
	spec := Spec{
		ThemeSpecVersion: 1,
		ThemeID:          "sprite-theme",
		ThemeRev:         1,
		FallbackTheme:    "mini",
		Primitives: []Primitive{
			{Type: "sprite", X: 0, Y: 0, Width: 24, Height: 24, AssetPath: "/themes/u/s.cbi"},
		},
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		t.Fatalf("marshal raw: %v", err)
	}

	caps := protocol.DeviceCapabilities{
		Known:                   true,
		SupportsThemeSpecV1:     true,
		MaxThemeSpecBytes:       len(raw) + 10,
		MaxThemePrimitives:      8,
		SupportedPrimitiveTypes: []string{"text", "rect", "progress", "gif"},
		BuiltinThemes:           []string{"mini"},
	}
	if err := ValidateAgainstCapabilities(spec, raw, caps); err == nil {
		t.Fatalf("expected primitive type capability mismatch")
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
		Known:                   true,
		SupportsThemeSpecV1:     true,
		MaxThemeSpecBytes:       len(raw) + 10,
		MaxThemePrimitives:      8,
		SupportedPrimitiveTypes: []string{"text", "rect", "progress"},
		BuiltinThemes:           []string{"classic", "mini"},
	}
	if err := ValidateAgainstCapabilities(spec, raw, caps); err != nil {
		t.Fatalf("expected compatible spec, got %v", err)
	}
}

func TestValidateUsageSlotOwnershipRequiresCapability(t *testing.T) {
	spec, raw, err := Parse([]byte(`{
		"v":1,
		"id":"usage-slots",
		"rev":1,
		"p":[{"t":"tx","x":0,"y":0,"sl":2,"v":"{usageSlot2Label}"}]
	}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := Validate(spec); err != nil {
		t.Fatalf("validate: %v", err)
	}

	legacyCaps := protocol.DeviceCapabilities{
		Known:               true,
		SupportsThemeSpecV1: true,
	}
	if err := ValidateAgainstCapabilities(spec, raw, legacyCaps); err == nil ||
		!strings.Contains(err.Error(), "usage-slots-v1") {
		t.Fatalf("expected usage slot capability rejection, got %v", err)
	}
	legacyCaps.SupportsUsageSlotsV1 = true
	if err := ValidateAgainstCapabilities(spec, raw, legacyCaps); err != nil {
		t.Fatalf("expected slot-capable device to accept spec: %v", err)
	}
}

func TestValidateCompactUsageSlotTemplateRequiresCapability(t *testing.T) {
	spec, raw, err := Parse([]byte(`{
		"v":1,
		"id":"usage-slots",
		"rev":1,
		"p":[{"t":"tx","x":0,"y":0,"v":"{us1p}%"}]
	}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	legacyCaps := protocol.DeviceCapabilities{
		Known:               true,
		SupportsThemeSpecV1: true,
	}
	if err := ValidateAgainstCapabilities(spec, raw, legacyCaps); err == nil ||
		!strings.Contains(err.Error(), "usage-slots-v1") {
		t.Fatalf("expected compact template capability rejection, got %v", err)
	}
}

func TestValidateRejectsInvalidUsageSlotOwnership(t *testing.T) {
	spec, _, err := Parse([]byte(`{
		"v":1,
		"id":"usage-slots",
		"rev":1,
		"p":[{"t":"tx","x":0,"y":0,"sl":3,"v":"bad"}]
	}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := Validate(spec); err == nil || !strings.Contains(err.Error(), "slot must be 1 or 2") {
		t.Fatalf("expected invalid slot rejection, got %v", err)
	}
}
