package usb

import "testing"

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
