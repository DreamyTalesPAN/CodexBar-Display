package usb

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

func TestSelectPortRequiresKnownHello(t *testing.T) {
	for _, name := range []string{"COM17", "/dev/ttyACM0", "/dev/ttyUSB0", "/dev/cu.usbserial42"} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			got, err := SelectPort([]string{"/dev/cu.usbmodem-unrelated", name, name, " "}, func(path string) (protocol.DeviceHello, error) {
				calls++
				if path == name {
					return protocol.DeviceHello{Kind: "hello", Board: " ESP8266-SMALLTV-ST7789 "}, nil
				}
				return protocol.DeviceHello{Kind: "hello", Board: "other-board"}, nil
			})
			if err != nil || got != name || calls != 2 {
				t.Fatalf("got %q, %v, %d probes", got, err, calls)
			}
		})
	}
}

func TestSelectPortConsolidatesExactDarwinAliasesBeforeProbing(t *testing.T) {
	for _, ports := range [][]string{
		{"/dev/tty.device-A", "/dev/cu.device-A"},
		{" /dev/cu.device-A ", "/dev/tty.device-A", "/dev/cu.device-A"},
	} {
		calls := 0
		got, err := SelectPort(ports, func(path string) (protocol.DeviceHello, error) {
			calls++
			if path != "/dev/cu.device-A" {
				t.Fatalf("must not open dial-in alias: %s", path)
			}
			return protocol.DeviceHello{Kind: "hello", Board: "esp8266-smalltv-st7789"}, nil
		})
		if err != nil || got != "/dev/cu.device-A" || calls != 1 {
			t.Fatalf("got %q, %v, probes=%d", got, err, calls)
		}
	}
	// A different suffix is a different device, not an alias. A tty-only
	// enumeration must still be eligible for identification.
	calls := 0
	_, err := SelectPort([]string{"/dev/cu.device-A", "/dev/tty.device-B"}, func(string) (protocol.DeviceHello, error) {
		calls++
		return protocol.DeviceHello{Kind: "hello", Board: "esp8266-smalltv-st7789"}, nil
	})
	if !errors.Is(err, ErrAmbiguousPorts) || calls != 2 {
		t.Fatalf("different devices collapsed: %v, probes=%d", err, calls)
	}
}

func TestSelectPortRejectsUnidentifiedAndAmbiguousDevices(t *testing.T) {
	for _, hello := range []protocol.DeviceHello{{}, {Kind: "hello"}, {Kind: "hello", Board: "other"}, {Kind: "noise", Board: "esp8266-smalltv-st7789"}} {
		if got, err := SelectPort([]string{"COM3"}, func(string) (protocol.DeviceHello, error) { return hello, nil }); err == nil || got != "" {
			t.Fatalf("accepted %+v: %q, %v", hello, got, err)
		}
	}
	_, err := SelectPort([]string{"COM3", "COM7"}, func(string) (protocol.DeviceHello, error) {
		return protocol.DeviceHello{Kind: "hello", Board: "esp32-lilygo-t-display-s3"}, nil
	})
	if !errors.Is(err, ErrAmbiguousPorts) {
		t.Fatalf("expected ambiguity, got %v", err)
	}
	if _, err := SelectPort(nil, nil); err == nil {
		t.Fatal("accepted empty list")
	}
	if _, err := SelectPort([]string{"COM3"}, func(string) (protocol.DeviceHello, error) { return protocol.DeviceHello{}, errors.New("busy") }); err == nil {
		t.Fatal("accepted unreadable port")
	}
}

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

func TestResolverCachesActivePortAndRescansAfterFailure(t *testing.T) {
	oldSender, oldDiscoverer := defaultSender, defaultDiscoverer
	t.Cleanup(func() { defaultSender.Close(); defaultSender, defaultDiscoverer = oldSender, oldDiscoverer })
	var ports []*mockSerialPort
	opener := &mockOpener{openFn: func(string, *serial.Mode) (SerialPort, error) {
		p := newMockSerialPort()
		p.readQueue = [][]byte{[]byte("{\"kind\":\"hello\",\"board\":\"esp8266-smalltv-st7789\"}\n")}
		ports = append(ports, p)
		return p, nil
	}}
	defaultSender = NewSenderWithConfig(SenderConfig{Opener: opener, Sleep: func(time.Duration) {}, HelloWindow: time.Millisecond})
	scans := 0
	defaultDiscoverer = discoverFunc(func() ([]string, error) { scans++; return []string{"COM17"}, nil })
	for i := 0; i < 3; i++ {
		got, err := ResolvePort("")
		if err != nil || got != "COM17" {
			t.Fatalf("resolve: %q, %v", got, err)
		}
		if _, err := ResolvePort(got); err != nil {
			t.Fatal(err)
		}
		if err := SendLine(got, []byte("frame")); err != nil {
			t.Fatal(err)
		}
	}
	if scans != 1 || len(ports) != 1 {
		t.Fatalf("rescanned active port: scans=%d opens=%d", scans, len(ports))
	}
	ports[0].writeErr = errors.New("disconnected")
	if err := SendLine("COM17", []byte("frame")); err == nil {
		t.Fatal("expected failure")
	}
	if _, err := ResolvePort(""); err != nil {
		t.Fatal(err)
	}
	if scans != 2 || len(ports) != 2 {
		t.Fatalf("did not rediscover after failure: scans=%d opens=%d", scans, len(ports))
	}
}

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

func TestResolverRestoresSelectedHandleAndClosesAmbiguousHandles(t *testing.T) {
	for _, ambiguous := range []bool{false, true} {
		t.Run(map[bool]string{false: "restore-selected", true: "close-ambiguous"}[ambiguous], func(t *testing.T) {
			oldSender, oldDiscoverer := defaultSender, defaultDiscoverer
			t.Cleanup(func() { defaultSender.Close(); defaultSender, defaultDiscoverer = oldSender, oldDiscoverer })
			var opened []*mockSerialPort
			opener := &mockOpener{openFn: func(path string, _ *serial.Mode) (SerialPort, error) {
				board := "other-board"
				if path == "COM3" || ambiguous {
					board = "esp8266-smalltv-st7789"
				}
				port := newMockSerialPort()
				port.readQueue = [][]byte{[]byte("{\"kind\":\"hello\",\"board\":\"" + board + "\"}\n")}
				opened = append(opened, port)
				return port, nil
			}}
			defaultSender = NewSenderWithConfig(SenderConfig{Opener: opener, Sleep: func(time.Duration) {}, HelloWindow: time.Millisecond})
			scans := 0
			defaultDiscoverer = discoverFunc(func() ([]string, error) { scans++; return []string{"COM3", "COM7"}, nil })
			got, err := ResolvePort("")
			if ambiguous {
				if got != "" || !errors.Is(err, ErrAmbiguousPorts) || defaultSender.port != nil {
					t.Fatalf("ambiguity left a selected handle: %q, %v", got, err)
				}
				for _, port := range opened {
					if port.closeCalls != 1 {
						t.Fatal("ambiguous candidate not closed")
					}
				}
				return
			}
			if err != nil || got != "COM3" {
				t.Fatalf("resolve: %q, %v", got, err)
			}
			if len(opened) != 3 || opened[0].closeCalls != 1 || opened[1].closeCalls != 1 || opened[2].closeCalls != 0 {
				t.Fatal("selected handle was not restored")
			}
			if again, err := ResolvePort(""); err != nil || again != got || scans != 1 || len(opened) != 3 {
				t.Fatalf("cached resolve: %q, %v scans=%d", again, err, scans)
			}
			CloseDefaultSender()
			if _, err := ResolvePort(""); err != nil || scans != 2 {
				t.Fatalf("close did not invalidate cache: %v scans=%d", err, scans)
			}
		})
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
