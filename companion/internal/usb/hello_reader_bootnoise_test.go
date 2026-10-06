package usb

import "testing"

func TestParseDeviceHelloLineSkipsBootNoiseBeforeHello(t *testing.T) {
	// Firmware 1.0.41 prints its boot hello straight after the boot ROM's
	// output, which reads as noise at 115200 baud and ends without a line break.
	line := "\xe3\x03\xec{\x82\xfb\x04\xfe" + `{"kind":"hello","protocolVersion":2,"board":"esp8266-smalltv-st7789","firmware":"1.0.41"}`
	hello, ok := parseDeviceHelloLine(line)
	if !ok {
		t.Fatal("boot hello after boot noise was not recognised")
	}
	if hello.Firmware != "1.0.41" {
		t.Fatalf("firmware = %q, want 1.0.41", hello.Firmware)
	}
	if _, ok := parseDeviceHelloLine("\xfe" + `{"kind":"error","code":"x"}`); ok {
		t.Fatal("noise before another reply must not be read as a hello")
	}
}
