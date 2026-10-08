package usb

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

type discoverFunc func() ([]string, error)

func (f discoverFunc) Discover() ([]string, error) { return f() }

// ResolvePort is the explicit firmware-recovery path. It deliberately does not
// require a hello, because recovery exists for boards whose current firmware
// cannot answer one. Identity-based selection lives in ResolveVibeTVPort and is
// covered by usb_test.go.

func TestResolvePortRequiresAnExplicitTarget(t *testing.T) {
	if _, err := ResolvePort("  "); errcode.Of(err) != errcode.TransportSerialPortNotFound {
		t.Fatalf("accepted an empty recovery target: %v", err)
	}
}

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
	if _, err := ResolvePort(filepath.Join(t.TempDir(), "absent")); err == nil {
		t.Fatal("accepted an absent device path")
	}
}

// A COM name is a serial identifier, not a filesystem path. Stat'ing it always
// fails, so Windows recovery has to confirm it by enumeration instead.
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

func TestSamePortComparesCOMNamesCaseInsensitively(t *testing.T) {
	if !samePort(" com17 ", "COM17") || samePort("COM17", "COM7") {
		t.Fatal("COM comparison is not case-insensitive and exact")
	}
	if !samePort("/dev/cu.usbserial42", "/dev/cu.usbserial42") ||
		samePort("/dev/cu.usbserial42", "/dev/CU.usbserial42") {
		t.Fatal("Unix device paths must compare exactly")
	}
}
