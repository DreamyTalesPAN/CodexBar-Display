package setup

import (
	"errors"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func setupUSBHello(string) (protocol.DeviceHello, error) {
	return protocol.DeviceHello{Kind: "hello", Board: "esp8266-smalltv-st7789"}, nil
}

func TestChooseCOMPortUsesSharedIdentityResolver(t *testing.T) {
	got, err := choosePort(Options{AssumeYes: true, SkipFlash: true}, deps{resolvePort: func(explicit string) (string, error) {
		if explicit != "" {
			t.Fatalf("unexpected explicit target %q", explicit)
		}
		return "COM17", nil
	}})
	if err != nil || got != "COM17" {
		t.Fatalf("got %q, %v", got, err)
	}
}
func TestChooseCOMPortPropagatesIdentityFailure(t *testing.T) {
	want := errors.New("multiple matching VibeTVs")
	got, err := choosePort(Options{SkipFlash: true}, deps{resolvePort: func(string) (string, error) { return "", want }})
	if got != "" || !errors.Is(err, want) {
		t.Fatalf("got %q, %v", got, err)
	}
}
func TestChooseExplicitRecoveryPortSkipsHelloSelection(t *testing.T) {
	got, err := choosePort(Options{Port: " COM17 "}, deps{
		resolveRecoveryPort: func(port string) (string, error) { return port, nil },
		resolvePort:         func(string) (string, error) { t.Fatal("recovery queried identity"); return "", nil },
	})
	if err != nil || got != "COM17" {
		t.Fatalf("got %q, %v", got, err)
	}
}
