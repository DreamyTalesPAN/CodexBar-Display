package usb

import (
	"testing"
	"time"
)

// A shipped VibeTV whose firmware predates Cable support never answers a
// serial hello. Discovery must give up quickly so the customer-visible search
// can still report the device found over WiFi, instead of spending the
// boot-tolerant control window on a port that stays silent.
func TestDeviceHelloForDiscoveryGivesUpBeforeControlWindow(t *testing.T) {
	port := newMockSerialPort()
	opener := &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:       opener,
		Sleep:        func(time.Duration) {},
		HelloWindow:  30 * time.Second,
		WriteTimeout: 50 * time.Millisecond,
	})
	defer sender.Close()

	start := time.Now()
	if _, err := sender.DeviceHelloForDiscovery("/dev/mock"); err == nil {
		t.Fatal("silent device must not report a hello")
	}
	elapsed := time.Since(start)
	if elapsed >= 10*time.Second {
		t.Fatalf("discovery waited %s; it must stay well below the %s control window", elapsed, 30*time.Second)
	}
}

// Control paths still tolerate a device that reboots when the port opens, so
// shortening discovery must not shorten them.
func TestDeviceHelloKeepsControlWindow(t *testing.T) {
	port := newMockSerialPort()
	opener := &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:       opener,
		Sleep:        func(time.Duration) {},
		HelloWindow:  600 * time.Millisecond,
		WriteTimeout: 50 * time.Millisecond,
	})
	defer sender.Close()

	start := time.Now()
	if _, err := sender.DeviceHello("/dev/mock"); err == nil {
		t.Fatal("silent device must not report a hello")
	}
	if elapsed := time.Since(start); elapsed < 600*time.Millisecond {
		t.Fatalf("control hello returned after %s; it must use the full configured window", elapsed)
	}
}
