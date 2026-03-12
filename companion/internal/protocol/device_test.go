package protocol

import "testing"

func TestCapabilitiesFromHelloKnownAndTheme(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind:                      "hello",
		ProtocolVersion:           1,
		SupportedProtocolVersions: []int{2, 1},
		PreferredProtocolVersion:  2,
		Board:                     "ESP8266-SMALLTV-ST7789",
		Features:                  []string{"theme", "theme-spec-v1"},
		MaxFrameBytes:             512,
		Capabilities: CapabilityBlock{
			Display: DisplayCapabilities{
				WidthPx:        240,
				HeightPx:       240,
				ColorDepthBits: 16,
			},
			Theme: ThemeCapabilities{
				SupportsThemeSpecV1: true,
				MaxThemeSpecBytes:   1024,
				MaxThemePrimitives:  32,
				BuiltinThemes:       []string{"classic", "crt", "mini"},
				CachedThemeID:       "mini-transport",
				CachedThemeRev:      3,
			},
			Transport: TransportCapabilities{
				Active:    "usb",
				Supported: []string{"usb"},
			},
		},
	})

	if !caps.Known {
		t.Fatalf("expected known capabilities")
	}
	if caps.NegotiatedProtocolVersion != 2 {
		t.Fatalf("expected negotiated protocol 2, got %d", caps.NegotiatedProtocolVersion)
	}
	if !caps.SupportsTheme {
		t.Fatalf("expected theme support")
	}
	if !caps.SupportsThemeSpecV1 {
		t.Fatalf("expected theme spec support")
	}
	if caps.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected normalized board: %q", caps.Board)
	}
	if caps.MaxThemeSpecBytes != 1024 || caps.MaxThemePrimitives != 32 {
		t.Fatalf("unexpected theme limits: bytes=%d primitives=%d", caps.MaxThemeSpecBytes, caps.MaxThemePrimitives)
	}
	if caps.ActiveTransport != "usb" {
		t.Fatalf("unexpected transport: %q", caps.ActiveTransport)
	}
	if caps.CachedThemeID != "mini-transport" || caps.CachedThemeRev != 3 {
		t.Fatalf("unexpected theme cache descriptor: id=%q rev=%d", caps.CachedThemeID, caps.CachedThemeRev)
	}
}

func TestCapabilitiesFromHelloUnknownWhenMissingSignal(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{})
	if caps.Known {
		t.Fatalf("expected unknown capabilities")
	}
	if caps.NegotiatedProtocolVersion != 1 {
		t.Fatalf("expected v1 fallback negotiation, got %d", caps.NegotiatedProtocolVersion)
	}
}
