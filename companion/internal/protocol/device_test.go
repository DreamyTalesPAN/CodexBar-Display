package protocol

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCapabilitiesFromHelloKnownAndTheme(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind:                      "hello",
		ProtocolVersion:           1,
		SupportedProtocolVersions: []int{2, 1},
		PreferredProtocolVersion:  2,
		Board:                     "ESP8266-SMALLTV-ST7789",
		Firmware:                  "1.0.0",
		DeviceID:                  "14799300",
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
				MaxThemeGifLzwBits:      11,
				SupportedPrimitiveTypes: []string{"Text", "RECT", "progress", "gif"},
				BuiltinThemes:           []string{"classic", "crt", "mini"},
				CachedThemeID:           "mini-transport",
				CachedThemeRev:          3,
			},
			Transport: TransportCapabilities{
				Active:    "usb",
				Supported: []string{"usb"},
				Mode:      "cable",
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
	if caps.MaxThemeGifAssets != 1 || caps.MaxThemeGifBytes != 24576 || caps.MaxThemeGifWidth != 80 || caps.MaxThemeGifHeight != 80 || caps.MaxThemeGifPixels != 6400 || caps.MaxThemeGifLzwBits != 11 {
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
	if caps.DeviceID != "14799300" || caps.ConnectionMode != "cable" {
		t.Fatalf("unexpected Cable identity: id=%q mode=%q", caps.DeviceID, caps.ConnectionMode)
	}
	if !caps.SupportsBrightness || caps.MinBrightnessPercent != 10 || caps.MaxBrightnessPercent != 100 {
		t.Fatalf("unexpected brightness capabilities: supported=%t min=%d max=%d", caps.SupportsBrightness, caps.MinBrightnessPercent, caps.MaxBrightnessPercent)
	}
	if caps.CachedThemeID != "mini-transport" || caps.CachedThemeRev != 3 {
		t.Fatalf("unexpected theme cache descriptor: id=%q rev=%d", caps.CachedThemeID, caps.CachedThemeRev)
	}
}

func TestCapabilitiesFromHelloMapsGIFLZWLimitFromJSON(t *testing.T) {
	var hello DeviceHello
	if err := json.Unmarshal([]byte(`{"kind":"hello","capabilities":{"theme":{"maxThemeGifLzwBits":11}}}`), &hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	caps := CapabilitiesFromHello(hello)
	if !caps.Known || caps.MaxThemeGifLzwBits != 11 {
		t.Fatalf("expected mapped 11-bit GIF LZW capability, got %+v", caps)
	}
}

func TestDeviceHelloPreservesPairingWindowCapabilities(t *testing.T) {
	var hello DeviceHello
	if err := json.Unmarshal([]byte(`{"kind":"hello","capabilities":{"auth":{"paired":true,"tokenHeader":" X-VibeTV-Token ","pairingWindowOpen":true,"pairingWindowSeconds":1799}}}`), &hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	hello = hello.Normalize()
	if hello.Capabilities.Auth == nil {
		t.Fatal("expected auth capabilities")
	}
	if !hello.Capabilities.Auth.Paired || !hello.Capabilities.Auth.PairingWindowOpen {
		t.Fatalf("unexpected pairing state: %+v", hello.Capabilities.Auth)
	}
	if hello.Capabilities.Auth.TokenHeader != "X-VibeTV-Token" || hello.Capabilities.Auth.PairingWindowSeconds != 1799 {
		t.Fatalf("unexpected normalized auth capabilities: %+v", hello.Capabilities.Auth)
	}

	encoded, err := json.Marshal(hello.Capabilities)
	if err != nil {
		t.Fatalf("encode capabilities: %v", err)
	}
	for _, field := range []string{`"paired":true`, `"tokenHeader":"X-VibeTV-Token"`, `"pairingWindowOpen":true`, `"pairingWindowSeconds":1799`} {
		if !strings.Contains(string(encoded), field) {
			t.Fatalf("encoded auth capabilities missing %s: %s", field, encoded)
		}
	}
}

func TestDeviceHelloClearsClosedPairingWindowSeconds(t *testing.T) {
	hello := (DeviceHello{Capabilities: CapabilityBlock{Auth: &AuthCapabilities{
		PairingWindowOpen:    false,
		PairingWindowSeconds: 120,
	}}}).Normalize()
	if hello.Capabilities.Auth == nil || hello.Capabilities.Auth.PairingWindowSeconds != 0 {
		t.Fatalf("closed pairing window retained seconds: %+v", hello.Capabilities.Auth)
	}
}

func TestDeviceHelloNormalizesIdentityAndNetworkMode(t *testing.T) {
	hello := (DeviceHello{
		DeviceID:    " esp8266-123ABC ",
		NetworkMode: " STATION ",
	}).Normalize()
	if hello.DeviceID != "esp8266-123ABC" || hello.NetworkMode != "station" {
		t.Fatalf("unexpected normalized hello: %+v", hello)
	}
	fallback := (DeviceHello{Capabilities: CapabilityBlock{Transport: TransportCapabilities{Mode: " SETUP "}}}).Normalize()
	if fallback.NetworkMode != "setup" {
		t.Fatalf("expected transport mode fallback, got %+v", fallback)
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

func TestCapabilitiesFromHelloAdvertisesUsageSlots(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind:     "hello",
		Features: []string{FeatureTheme, FeatureThemeSpecV1, FeatureUsageSlotsV1},
	})
	if !caps.Known || !caps.SupportsUsageSlotsV1 {
		t.Fatalf("expected usage-slots-v1 capability, got %+v", caps)
	}

	legacy := CapabilitiesFromHello(DeviceHello{
		Kind:     "hello",
		Features: []string{FeatureTheme, FeatureThemeSpecV1},
	})
	if legacy.SupportsUsageSlotsV1 {
		t.Fatalf("legacy ThemeSpec support must not imply usage slots: %+v", legacy)
	}
}

func TestCapabilitiesFromHelloAdvertisesProviderAssetsColorStopsAndValign(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind: "hello",
		Features: []string{
			FeatureTheme,
			FeatureThemeSpecV1,
			FeatureProviderAssetsV1,
			FeatureColorStopsV1,
			FeatureTextValignV1,
		},
	})
	if !caps.Known || !caps.SupportsProviderAssetsV1 || !caps.SupportsColorStopsV1 || !caps.SupportsTextValignV1 {
		t.Fatalf("expected new ThemeSpec capabilities from features, got %+v", caps)
	}

	fromBlock := CapabilitiesFromHello(DeviceHello{
		Kind: "hello",
		Capabilities: CapabilityBlock{
			Theme: ThemeCapabilities{
				SupportsProviderAssetsV1: true,
				SupportsColorStopsV1:     true,
				SupportsTextValignV1:     true,
			},
		},
	})
	if !fromBlock.SupportsProviderAssetsV1 || !fromBlock.SupportsColorStopsV1 || !fromBlock.SupportsTextValignV1 {
		t.Fatalf("expected new ThemeSpec capabilities from theme block, got %+v", fromBlock)
	}

	legacy := CapabilitiesFromHello(DeviceHello{
		Kind:     "hello",
		Features: []string{FeatureTheme, FeatureThemeSpecV1, FeatureProviderSlotsV1},
	})
	if legacy.SupportsProviderAssetsV1 || legacy.SupportsColorStopsV1 || legacy.SupportsTextValignV1 {
		t.Fatalf("provider-slots-v1 must not imply the new ThemeSpec capabilities: %+v", legacy)
	}
}

func TestCapabilitiesFromHelloAdvertisesProgressArc(t *testing.T) {
	fromFeature := CapabilitiesFromHello(DeviceHello{
		Kind:     "hello",
		Features: []string{FeatureTheme, FeatureThemeSpecV1, FeatureProgressArcV1},
	})
	fromBlock := CapabilitiesFromHello(DeviceHello{
		Kind:         "hello",
		Capabilities: CapabilityBlock{Theme: ThemeCapabilities{SupportsProgressArcV1: true}},
	})
	if !fromFeature.SupportsProgressArcV1 || !fromBlock.SupportsProgressArcV1 {
		t.Fatalf("expected progress-arc-v1 from the feature and from the theme block, got %+v and %+v", fromFeature, fromBlock)
	}
	older := CapabilitiesFromHello(DeviceHello{
		Kind:     "hello",
		Features: []string{FeatureTheme, FeatureThemeSpecV1, FeatureColorStopsV1, FeatureTextValignV1},
	})
	if older.SupportsProgressArcV1 {
		t.Fatalf("firmware 1.0.42 capabilities must not imply progress-arc-v1: %+v", older)
	}
}

// Issue #526: the answer firmware 1.0.45 gave to GET /hello over WiFi at low
// heap, captured byte for byte from VibeTV 16198106 on 2026-10-06.
func TestDecodeWiFiHelloNamesTheHelloWithoutCapabilities(t *testing.T) {
	body, err := os.ReadFile("testdata/wifi-hello-1.0.45-without-capabilities.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != 397 || !bytes.HasSuffix(body, []byte(`"maxFrameBytes":2048,"capabilities":}`)) {
		t.Fatalf("fixture is not the captured answer: %d bytes", len(body))
	}

	hello, err := DecodeWiFiHello(bytes.NewReader(body))
	if err == nil {
		t.Fatalf("a hello without capabilities must not pass as a complete hello: %+v", hello)
	}
	if hello.DeviceID != "" || CapabilitiesFromHello(hello).Known {
		t.Fatalf("the failed decode must not hand out a usable hello: %+v", hello)
	}
	identity, ok := HelloIdentity(err)
	if !ok {
		t.Fatalf("the known truncation must keep the identity, got %v", err)
	}
	if identity.DeviceID != "16198106" || identity.Board != "esp8266-smalltv-st7789" ||
		identity.Firmware != "1.0.45" || !identity.HasFeature(FeatureCableTransferV1) {
		t.Fatalf("unexpected identity: %+v", identity)
	}
	if transport := identity.Capabilities.Transport; transport.Mode != "" || transport.Active != "" ||
		len(transport.Supported) != 0 || transport.CableOnlyUpdates != nil {
		t.Fatalf("capabilities that were not sent must stay empty: %+v", transport)
	}

	for name, broken := range map[string]string{
		"cut elsewhere":      `{"kind":"hello","deviceId":"16198106","capabilities":{"transport":`,
		"no device ID":       `{"kind":"hello","board":"esp8266-smalltv-st7789","capabilities":}`,
		"broken before then": `{"kind":"hello","deviceId":,"capabilities":}`,
		"not a hello at all": `<html>busy</html>`,
		"empty answer":       ``,
	} {
		_, err := DecodeWiFiHello(strings.NewReader(broken))
		if err == nil {
			t.Fatalf("%s: expected an error", name)
		}
		if _, ok := HelloIdentity(err); ok {
			t.Fatalf("%s: only the known truncation keeps an identity", name)
		}
	}

	complete, err := DecodeWiFiHello(strings.NewReader(`{"kind":"hello","deviceId":" 16198106 ","capabilities":{"transport":{"mode":"WiFi"}}}`))
	if err != nil || complete.DeviceID != "16198106" || complete.Capabilities.Transport.Mode != "wifi" {
		t.Fatalf("a complete hello must decode normalized: %+v %v", complete, err)
	}
}
