package usb

import (
	"errors"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

func listSerialPorts(t *testing.T, ports ...string) {
	t.Helper()
	old := defaultDiscoverer
	oldAttached := attachedPorts
	t.Cleanup(func() { defaultDiscoverer, attachedPorts = old, oldAttached })
	defaultDiscoverer = discoverFunc(func() ([]string, error) { return ports, nil })
	attachedPorts = func() ([]string, error) { return ports, nil }
}

const unplugTestHello = `{"kind":"hello","board":"esp8266-smalltv-st7789","deviceId":"5804558","capabilities":{"transport":{"active":"usb","mode":"cable"}}}` + "\n"

func openUnplugTestSender(t *testing.T, port *mockSerialPort) *Sender {
	t.Helper()
	listSerialPorts(t, "COM3")
	port.readQueue = [][]byte{[]byte(unplugTestHello)}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"COM3": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 30 * time.Second,
	})
	t.Cleanup(sender.Close)
	if _, err := sender.DeviceHello("COM3"); err != nil {
		t.Fatal(err)
	}
	return sender
}

// Windows physical test: one second after USB was unplugged, a status check
// waited about 97 seconds behind a serial call on the vanished port.
func TestResolveReportsUnpluggedPortWhileASerialCallIsStuck(t *testing.T) {
	for _, control := range []bool{false, true} {
		port := newMockSerialPort()
		sender := openUnplugTestSender(t, port)
		listSerialPorts(t)
		sender.mu.Lock() // a call stuck on the old handle
		resolve := sender.ResolvePort
		if control {
			resolve = sender.ResolveControlPort
		}
		done := make(chan error, 1)
		go func() {
			_, err := resolve("", "5804558")
			done <- err
		}()
		select {
		case err := <-done:
			if errcode.Of(err) != errcode.TransportSerialPortNotFound {
				t.Fatalf("control=%v: unplug not reported as a missing port: %v", control, err)
			}
		case <-time.After(time.Second):
			t.Fatalf("control=%v: status waited on the stuck serial call", control)
		}
		sender.mu.Unlock()
	}
}

func TestResolveClosesTheHandleOfAnUnpluggedPort(t *testing.T) {
	port := newMockSerialPort()
	sender := openUnplugTestSender(t, port)
	listSerialPorts(t)
	if _, err := sender.ResolveControlPort("", "5804558"); errcode.Of(err) != errcode.TransportSerialPortNotFound {
		t.Fatalf("unplug not reported as a missing port: %v", err)
	}
	if _, open := sender.CurrentHello(); open || port.closeCalls != 1 {
		t.Fatalf("stale handle kept: closes=%d", port.closeCalls)
	}
}

// On Windows the old handle of an unplugged CH340 keeps failing reads. Waiting
// out the whole 30-second hello window held the sender for every caller.
func TestDeviceHelloStopsOnReadErrorsOfAnUnpluggedPort(t *testing.T) {
	port := newMockSerialPort()
	sender := openUnplugTestSender(t, port)
	port.mu.Lock()
	port.readErr = errors.New("The device does not recognize the command.")
	port.mu.Unlock()
	started := time.Now()
	if _, err := sender.DeviceHello("COM3"); err == nil {
		t.Fatal("unplugged port returned an identity")
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("hello probe waited %s on a failing port", elapsed)
	}
	if port.closeCalls != 1 {
		t.Fatalf("failing handle kept: closes=%d", port.closeCalls)
	}
}

// Windows physical retest: the first status check closed the vanished port,
// and every later one forgot which port was unplugged and probed all ports.
func TestCablePortStaysUnpluggedAfterItsHandleClosed(t *testing.T) {
	port := newMockSerialPort()
	sender := openUnplugTestSender(t, port)
	listSerialPorts(t)
	if err := sender.cablePortVanished(); errcode.Of(err) != errcode.TransportSerialPortNotFound {
		t.Fatalf("unplug not reported: %v", err)
	}
	if port.closeCalls != 1 {
		t.Fatalf("stale handle kept: closes=%d", port.closeCalls)
	}
	if err := sender.cablePortVanished(); errcode.Of(err) != errcode.TransportSerialPortNotFound {
		t.Fatalf("closing the handle forgot the unplugged port: %v", err)
	}
	listSerialPorts(t, "COM3")
	if err := sender.cablePortVanished(); err != nil {
		t.Fatalf("replugged port still reported missing: %v", err)
	}
}

// A built-in COM1 never answers, and probing it waited out the whole hello
// window on every search for the VibeTV.
func TestCableSearchSkipsPortsKnownNotToBeUSB(t *testing.T) {
	listSerialPorts(t, "COM1", "COM3")
	old := nonUSBPorts
	t.Cleanup(func() { nonUSBPorts = old })
	nonUSBPorts = func() map[string]bool { return map[string]bool{"COM1": true} }
	got, err := listCablePorts()
	if err != nil || len(got) != 1 || got[0] != "COM3" {
		t.Fatalf("got %q, %v", got, err)
	}
}
