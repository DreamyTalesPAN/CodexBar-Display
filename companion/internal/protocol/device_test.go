package protocol

import "testing"

func TestCapabilitiesFromHelloKnownAndTheme(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind:                      "hello",
		ProtocolVersion:           1,
		SupportedProtocolVersions: []int{2, 1},
		PreferredProtocolVersion:  2,
		Board:                     "ESP8266-SMALLTV-ST7789",
		Firmware:                  "1.0.0",
		Features:                  []string{"theme", "theme-spec-v1"},
		MaxFrameBytes:             512,
		Capabilities: CapabilityBlock{
			Display: DisplayCapabilities{
				WidthPx:        240,
				HeightPx:       240,
				ColorDepthBits: 16,
				Brightness: DisplayBrightnessCapabilities{
					Supported: true,
				},
			},
			Theme: ThemeCapabilities{
				SupportsThemeSpecV1:     true,
				SupportsStoredThemes:    true,
				MaxThemeSpecBytes:       1024,
				MaxStoredThemeSpecBytes: 4096,
				MaxThemePrimitives:      32,
				MaxThemeGifAssets:       1,
				MaxThemeGifBytes:        24576,
				MaxThemeGifWidth:        80,
				MaxThemeGifHeight:       80,
				MaxThemeGifPixels:       6400,
				SupportedPrimitiveTypes: []string{"Text", "RECT", "progress", "gif"},
				BuiltinThemes:           []string{"classic", "crt", "mini"},
				CachedThemeID:           "mini-transport",
				CachedThemeRev:          3,
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
	if !caps.SupportsStoredThemes {
		t.Fatalf("expected stored theme support")
	}
	if caps.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected normalized board: %q", caps.Board)
	}
	if caps.Firmware != "1.0.0" {
		t.Fatalf("unexpected firmware version: %q", caps.Firmware)
	}
	if caps.MaxThemeSpecBytes != 1024 || caps.MaxStoredThemeSpecBytes != 4096 || caps.MaxThemePrimitives != 32 {
		t.Fatalf("unexpected theme limits: inline=%d stored=%d primitives=%d", caps.MaxThemeSpecBytes, caps.MaxStoredThemeSpecBytes, caps.MaxThemePrimitives)
	}
	if caps.MaxThemeGifAssets != 1 || caps.MaxThemeGifBytes != 24576 || caps.MaxThemeGifWidth != 80 || caps.MaxThemeGifHeight != 80 || caps.MaxThemeGifPixels != 6400 {
		t.Fatalf("unexpected GIF limits: %+v", caps)
	}
	if got, want := caps.SupportedPrimitiveTypes, []string{"text", "rect", "progress", "gif"}; len(got) != len(want) {
		t.Fatalf("unexpected primitive type count: got=%v want=%v", got, want)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("unexpected primitive type at %d: got=%v want=%v", i, got, want)
			}
		}
	}
	if caps.ActiveTransport != "usb" {
		t.Fatalf("unexpected transport: %q", caps.ActiveTransport)
	}
	if !caps.SupportsBrightness || caps.MinBrightnessPercent != 10 || caps.MaxBrightnessPercent != 100 {
		t.Fatalf("unexpected brightness capabilities: supported=%t min=%d max=%d", caps.SupportsBrightness, caps.MinBrightnessPercent, caps.MaxBrightnessPercent)
	}
	if caps.CachedThemeID != "mini-transport" || caps.CachedThemeRev != 3 {
		t.Fatalf("unexpected theme cache descriptor: id=%q rev=%d", caps.CachedThemeID, caps.CachedThemeRev)
	}
}

func TestCapabilitiesFromCompactHelloTreatsThemeSpecAsThemeSupport(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind:            "hello",
		ProtocolVersion: 2,
		Board:           "esp8266-smalltv-st7789",
		Firmware:        "1.0.33",
		MaxFrameBytes:   2048,
		Capabilities: CapabilityBlock{
			Display: DisplayCapabilities{
				Brightness: DisplayBrightnessCapabilities{Supported: true},
			},
			Theme: ThemeCapabilities{
				SupportsThemeSpecV1:     true,
				MaxThemeSpecBytes:       2048,
				MaxStoredThemeSpecBytes: 4096,
				MaxThemePrimitives:      32,
				MaxThemeGifBytes:        24576,
			},
			Transport: TransportCapabilities{Active: "wifi"},
		},
	})

	if !caps.Known {
		t.Fatalf("expected known capabilities")
	}
	if !caps.SupportsTheme {
		t.Fatalf("expected ThemeSpec support to imply theme support")
	}
	if !caps.SupportsThemeSpecV1 {
		t.Fatalf("expected theme spec support")
	}
	if !caps.SupportsStoredThemes {
		t.Fatalf("expected stored theme support to be inferred from its advertised limit")
	}
	if caps.ActiveTransport != "wifi" {
		t.Fatalf("unexpected transport: %q", caps.ActiveTransport)
	}
	if caps.MaxFrameBytes != 2048 || caps.MaxThemeSpecBytes != 2048 || caps.MaxStoredThemeSpecBytes != 4096 || caps.MaxThemePrimitives != 32 || caps.MaxThemeGifBytes != 24576 {
		t.Fatalf("unexpected compact limits: %+v", caps)
	}
	if !caps.SupportsBrightness {
		t.Fatalf("expected brightness support")
	}
}

func TestStoredThemeSpecBytesLimitFallsBackForOlderFirmware(t *testing.T) {
	caps := DeviceCapabilities{MaxThemeSpecBytes: 2048}
	if got := caps.StoredThemeSpecBytesLimit(); got != 2048 {
		t.Fatalf("unexpected legacy stored theme limit: %d", got)
	}

	caps.MaxStoredThemeSpecBytes = 4096
	if got := caps.StoredThemeSpecBytesLimit(); got != 4096 {
		t.Fatalf("unexpected explicit stored theme limit: %d", got)
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
