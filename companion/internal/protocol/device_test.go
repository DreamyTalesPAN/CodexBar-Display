package protocol

import "testing"

func TestCapabilitiesFromHelloKnownAndTheme(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{
		Kind:            "hello",
		ProtocolVersion: 1,
		Board:           "ESP8266-SMALLTV-ST7789",
		Features:        []string{"theme"},
		MaxFrameBytes:   512,
	})

	if !caps.Known {
		t.Fatalf("expected known capabilities")
	}
	if !caps.SupportsTheme {
		t.Fatalf("expected theme support")
	}
	if caps.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected normalized board: %q", caps.Board)
	}
}

func TestCapabilitiesFromHelloUnknownWhenMissingSignal(t *testing.T) {
	caps := CapabilitiesFromHello(DeviceHello{})
	if caps.Known {
		t.Fatalf("expected unknown capabilities")
	}
}
