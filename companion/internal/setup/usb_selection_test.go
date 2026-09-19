package setup

import (
	"errors"
	"strings"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func setupUSBHello(string) (protocol.DeviceHello, error) {
	return protocol.DeviceHello{Kind: "hello", Board: "esp8266-smalltv-st7789"}, nil
}

// choosePort no longer enumerates and ranks port names: the usb package
// resolves a VibeTV by its protocol identity and returns exactly one port, or
// an error naming why. These tests now assert that contract at the setup
// boundary; the identity rules themselves live in internal/usb.
func TestChoosePortReturnsTheIdentifiedPort(t *testing.T) {
	got, err := choosePort(Options{AssumeYes: true}, deps{
		resolvePort: func(string) (string, error) { return "COM17", nil },
	})
	if err != nil || got != "COM17" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestChoosePortFailsAmbiguityRegardlessOfInteraction(t *testing.T) {
	ambiguous := errors.New("multiple matching VibeTVs: COM3, COM7")
	for _, yes := range []bool{false, true} {
		for _, interactive := range []bool{false, true} {
			got, err := choosePort(Options{AssumeYes: yes}, deps{
				resolvePort:   func(string) (string, error) { return "", ambiguous },
				isInteractive: func() bool { return interactive },
			})
			if got != "" || err == nil || !strings.Contains(err.Error(), "multiple matching VibeTVs") {
				t.Fatalf("yes=%v interactive=%v: %q, %v", yes, interactive, got, err)
			}
		}
	}
}

func TestChooseExplicitRecoveryPortSkipsHelloSelection(t *testing.T) {
	// An explicit port on the flash path is the operator's recovery target, so
	// it goes to the recovery resolver and must not require a hello.
	got, err := choosePort(Options{Port: " COM17 "}, deps{
		resolveRecoveryPort: func(port string) (string, error) { return port, nil },
		resolvePort: func(string) (string, error) {
			t.Fatal("explicit recovery port must not go through identity resolution")
			return "", nil
		},
		readDeviceHello: func(string) (protocol.DeviceHello, error) {
			t.Fatal("recovery must not require hello")
			return protocol.DeviceHello{}, nil
		},
	})
	if err != nil || got != "COM17" {
		t.Fatalf("got %q, %v", got, err)
	}
}
