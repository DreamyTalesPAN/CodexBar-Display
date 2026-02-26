package usb

import (
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestChooseAutoPortPrefersUSBModem(t *testing.T) {
	port, err := chooseAutoPort([]string{
		"/dev/cu.Bluetooth-Incoming-Port",
		"/dev/cu.usbmodem1101",
		"/dev/cu.usbserial1420",
	})
	if err != nil {
		t.Fatalf("expected a selected port, got error: %v", err)
	}
	if port != "/dev/cu.usbmodem1101" {
		t.Fatalf("expected usbmodem port, got %q", port)
	}
}

func TestChooseAutoPortSkipsBluetoothOnlySet(t *testing.T) {
	_, err := chooseAutoPort([]string{
		"/dev/cu.Bluetooth-Incoming-Port",
		"/dev/cu.iPhone-WirelessiAP",
	})
	if err == nil {
		t.Fatalf("expected error when no usb serial device is present")
	}
}

func TestParseDeviceHelloLineJSON(t *testing.T) {
	line := `{"kind":"hello","protocolVersion":1,"board":"esp8266-smalltv-st7789","features":["theme"]}`
	hello, ok := parseDeviceHelloLine(line)
	if !ok {
		t.Fatalf("expected hello parse success")
	}
	if hello.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected board %q", hello.Board)
	}
	if !hello.HasFeature(protocol.FeatureTheme) {
		t.Fatalf("expected theme feature in hello")
	}
}

func TestParseDeviceHelloLineLegacyReady(t *testing.T) {
	hello, ok := parseDeviceHelloLine("vibeblock_ready_display")
	if !ok {
		t.Fatalf("expected legacy ready to parse as hello")
	}
	if hello.ProtocolVersion != 1 {
		t.Fatalf("unexpected protocol version %d", hello.ProtocolVersion)
	}
}

func TestParseDeviceHelloLineRejectsNoise(t *testing.T) {
	if _, ok := parseDeviceHelloLine("frame_received"); ok {
		t.Fatalf("unexpected parse success for non-hello line")
	}
}
