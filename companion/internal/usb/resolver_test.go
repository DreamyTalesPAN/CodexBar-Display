package usb

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

type discoverFunc func() ([]string, error)

func TestExplicitUnixPathBypassesDiscovery(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix device path")
	}
	old := defaultDiscoverer
	t.Cleanup(func() { defaultDiscoverer = old })
	defaultDiscoverer = discoverFunc(func() ([]string, error) { return nil, errors.New("discovery unavailable") })
	path := filepath.Join(t.TempDir(), "serial-link")
	if err := os.Symlink("/dev/null", path); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolvePort(path); err != nil || got != path {
		t.Fatalf("path=%q err=%v", got, err)
	}
}

func (f discoverFunc) Discover() ([]string, error) { return f() }

func TestResolveExplicitCOMRecoveryWithoutHelloOrStat(t *testing.T) {
	oldDiscoverer := defaultDiscoverer
	t.Cleanup(func() { defaultDiscoverer = oldDiscoverer })
	defaultDiscoverer = discoverFunc(func() ([]string, error) { return []string{"COM17"}, nil })
	got, err := ResolvePort(" com17 ")
	if err != nil || got != "COM17" {
		t.Fatalf("explicit recovery: %q, %v", got, err)
	}
	if _, err := ResolvePort("COM99"); err == nil {
		t.Fatal("accepted absent port")
	}
}

func TestResolvePortPropagatesDiscoveryFailure(t *testing.T) {
	oldDiscoverer := defaultDiscoverer
	t.Cleanup(func() { defaultDiscoverer = oldDiscoverer })
	want := errors.New("enumeration failed")
	defaultDiscoverer = discoverFunc(func() ([]string, error) { return nil, want })
	if _, err := ResolvePort("COM99"); !errors.Is(err, want) {
		t.Fatalf("lost discovery error: %v", err)
	}
}

// The old board-only selector is superseded by #407's device identity contract.
func TestCOMDiscoveryRequiresIdentityAndRejectsAmbiguity(t *testing.T) {
	devices, err := discoverVibeTVs([]string{"COM3", "COM7", "Bluetooth"}, func(port string) (protocol.DeviceHello, error) {
		if port == "COM3" {
			return cableHello("device-a"), nil
		}
		return protocol.DeviceHello{Kind: "hello", Board: vibeTVBoardID}, nil
	}, "windows")
	if err != nil || len(devices) != 1 || devices[0].Port != "COM3" {
		t.Fatalf("devices=%+v err=%v", devices, err)
	}
	_, err = resolveVibeTVCandidates([]string{"COM3", "COM7"}, "", "", func(port string) (protocol.DeviceHello, error) { return cableHello(port), nil })
	if err == nil {
		t.Fatal("accepted ambiguous identities")
	}
}
