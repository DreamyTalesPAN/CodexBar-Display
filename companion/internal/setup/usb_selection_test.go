package setup

import (
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

func setupUSBHello(string) (protocol.DeviceHello, error) {
	return protocol.DeviceHello{Kind: "hello", Board: "esp8266-smalltv-st7789"}, nil
}

func TestChoosePortIdentifiesCOMAmongUnrelatedPorts(t *testing.T) {
	got, err := choosePort(Options{AssumeYes: true}, deps{
		listPorts: func() ([]string, error) { return []string{"/dev/cu.usbmodem-other", "COM17"}, nil },
		readDeviceHello: func(port string) (protocol.DeviceHello, error) {
			if port == "COM17" {
				return setupUSBHello(port)
			}
			return protocol.DeviceHello{Kind: "hello", Board: "other"}, nil
		},
	})
	if err != nil || got != "COM17" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestChoosePortFailsAmbiguityRegardlessOfInteraction(t *testing.T) {
	for _, yes := range []bool{false, true} {
		for _, interactive := range []bool{false, true} {
			got, err := choosePort(Options{AssumeYes: yes}, deps{
				listPorts:       func() ([]string, error) { return []string{"COM3", "COM7"}, nil },
				readDeviceHello: setupUSBHello,
				isInteractive:   func() bool { return interactive },
			})
			if got != "" || !errors.Is(err, usb.ErrAmbiguousPorts) {
				t.Fatalf("yes=%v interactive=%v: %q, %v", yes, interactive, got, err)
			}
		}
	}
}

func TestChooseExplicitRecoveryPortSkipsHelloSelection(t *testing.T) {
	got, err := choosePort(Options{Port: " COM17 "}, deps{
		resolvePort: func(port string) (string, error) { return port, nil },
		listPorts:   func() ([]string, error) { t.Fatal("must not auto-select an explicit recovery port"); return nil, nil },
		readDeviceHello: func(string) (protocol.DeviceHello, error) {
			t.Fatal("recovery must not require hello")
			return protocol.DeviceHello{}, nil
		},
	})
	if err != nil || got != "COM17" {
		t.Fatalf("got %q, %v", got, err)
	}
}
