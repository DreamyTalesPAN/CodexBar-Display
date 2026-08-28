package usb

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

func TestResolvePortRequiresExplicitRecoveryTarget(t *testing.T) {
	_, err := ResolvePort("")
	if errcode.Of(err) != errcode.TransportSerialPortNotFound {
		t.Fatalf("expected explicit recovery-port error, got %v", err)
	}
}

func TestResolvePortAcceptsExistingExplicitRecoveryTarget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cu.usbserial-recovery")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("create recovery target: %v", err)
	}
	got, err := ResolvePort(path)
	if err != nil || got != path {
		t.Fatalf("resolve explicit recovery target: got=%q err=%v", got, err)
	}
}

func TestParseDeviceHelloLineJSON(t *testing.T) {
	line := `{"kind":"hello","protocolVersion":2,"supportedProtocolVersions":[2,1],"preferredProtocolVersion":2,"board":"esp8266-smalltv-st7789","features":["theme","theme-spec-v1"]}`
	hello, ok := parseDeviceHelloLine(line)
	if !ok {
		t.Fatalf("expected hello parse success")
	}
	if hello.ProtocolVersion != 2 {
		t.Fatalf("unexpected protocol version %d", hello.ProtocolVersion)
	}
	if len(hello.SupportedProtocolVersions) != 2 || hello.SupportedProtocolVersions[0] != 2 || hello.SupportedProtocolVersions[1] != 1 {
		t.Fatalf("unexpected supported protocols: %v", hello.SupportedProtocolVersions)
	}
	if hello.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected board %q", hello.Board)
	}
	if !hello.HasFeature(protocol.FeatureTheme) {
		t.Fatalf("expected theme feature in hello")
	}
	if !hello.HasFeature(protocol.FeatureThemeSpecV1) {
		t.Fatalf("expected theme spec v1 feature in hello")
	}
}

func TestParseDeviceHelloLineLegacyReady(t *testing.T) {
	hello, ok := parseDeviceHelloLine("codexbar_display_ready_display")
	if !ok {
		t.Fatalf("expected legacy ready to parse as hello")
	}
	if hello.ProtocolVersion != 0 {
		t.Fatalf("unexpected protocol version %d", hello.ProtocolVersion)
	}
}

func TestParseDeviceHelloLineRejectsNoise(t *testing.T) {
	if _, ok := parseDeviceHelloLine("frame_received"); ok {
		t.Fatalf("unexpected parse success for non-hello line")
	}
}

func TestReadHelloKeepsFullSupplierCapabilityLine(t *testing.T) {
	line := []byte(
		`{"kind":"hello","board":"esp8266-smalltv-st7789","deviceId":"16199051","capabilities":{"transport":{"active":"usb","mode":"cable"}},"padding":"` +
			strings.Repeat("x", 1024) + `"}` + "\n",
	)
	if len(line) <= 1024 {
		t.Fatalf("fixture must exceed the old reader limit, got %d bytes", len(line))
	}
	port := newMockSerialPort()
	for len(line) > 0 {
		n := 128
		if len(line) < n {
			n = len(line)
		}
		port.readQueue = append(port.readQueue, append([]byte(nil), line[:n]...))
		line = line[n:]
	}

	hello, ok := readHelloFromPort(port, 100*time.Millisecond)
	if !ok || hello.DeviceID != "16199051" {
		t.Fatalf("expected full supplier-sized hello, got ok=%t hello=%+v", ok, hello)
	}
}

func TestCurrentHelloReturnsCachedCopyWithoutSerialIO(t *testing.T) {
	path := "/dev/mock"
	port := newMockSerialPort()
	line := []byte(`{"kind":"hello","deviceId":"vibetv-cable","features":["theme"],"capabilities":{"theme":{"builtinThemes":["default"]},"transport":{"active":"usb","mode":"cable","supported":["usb","wifi"]}}}` + "\n")
	for len(line) > 0 {
		n := min(64, len(line))
		port.readQueue = append(port.readQueue, append([]byte(nil), line[:n]...))
		line = line[n:]
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:         &mockOpener{portsByPath: map[string]SerialPort{path: port}},
		Sleep:          func(time.Duration) {},
		SettleDuration: time.Nanosecond,
		HelloWindow:    100 * time.Millisecond,
	})
	if _, err := sender.DeviceHello(path); err != nil {
		t.Fatal(err)
	}
	writesBefore := port.writeCalls
	hello, ok := sender.CurrentHello()
	if !ok || hello.DeviceID != "vibetv-cable" {
		t.Fatalf("unexpected cached hello: ok=%t hello=%+v", ok, hello)
	}
	hello.Features[0] = "mutated"
	hello.Capabilities.Theme.BuiltinThemes[0] = "mutated"
	hello.Capabilities.Transport.Supported[0] = "mutated"
	again, ok := sender.CurrentHello()
	if !ok || again.Features[0] != "theme" || again.Capabilities.Theme.BuiltinThemes[0] != "default" || again.Capabilities.Transport.Supported[0] != "usb" {
		t.Fatalf("cached hello was aliased: %+v", again)
	}
	if port.writeCalls != writesBefore {
		t.Fatalf("cached hello performed serial IO: writes=%d want=%d", port.writeCalls, writesBefore)
	}
}

func TestSenderReopensWhenPathChanges(t *testing.T) {
	portA := newMockSerialPort()
	portB := newMockSerialPort()
	opener := &mockOpener{
		portsByPath: map[string]SerialPort{
			"/dev/mockA": portA,
			"/dev/mockB": portB,
		},
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:         opener,
		Sleep:          func(time.Duration) {},
		SettleDuration: time.Millisecond,
		HelloWindow:    10 * time.Millisecond,
	})
	defer sender.Close()

	if err := sender.Send("/dev/mockA", []byte("{\"v\":1}\n")); err != nil {
		t.Fatalf("send on portA: %v", err)
	}
	if err := sender.Send("/dev/mockB", []byte("{\"v\":1}\n")); err != nil {
		t.Fatalf("send on portB: %v", err)
	}

	if got := opener.openCount("/dev/mockA"); got != 1 {
		t.Fatalf("expected one open for portA, got %d", got)
	}
	if got := opener.openCount("/dev/mockB"); got != 1 {
		t.Fatalf("expected one open for portB, got %d", got)
	}
	if portA.closeCalls == 0 {
		t.Fatalf("expected stale portA handle to be closed on path change")
	}
}

func TestSenderReconnectsAfterWriteFailure(t *testing.T) {
	first := newMockSerialPort()
	first.writeErr = errors.New("i/o error")
	second := newMockSerialPort()

	openSeq := []SerialPort{first, second}
	opener := &mockOpener{
		openFn: func(path string, _ *serial.Mode) (SerialPort, error) {
			if len(openSeq) == 0 {
				return nil, errors.New("unexpected open")
			}
			next := openSeq[0]
			openSeq = openSeq[1:]
			return next, nil
		},
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:         opener,
		Sleep:          func(time.Duration) {},
		SettleDuration: time.Millisecond,
		HelloWindow:    10 * time.Millisecond,
	})
	defer sender.Close()

	err := sender.Send("/dev/mock", []byte("{\"v\":1}\n"))
	if err == nil {
		t.Fatalf("expected first send error")
	}
	if got := errcode.Of(err); got != errcode.TransportSerialWrite {
		t.Fatalf("expected serial write code, got %s", got)
	}
	if first.closeCalls == 0 {
		t.Fatalf("expected first port to be closed after write error")
	}

	if err := sender.Send("/dev/mock", []byte("{\"v\":1}\n")); err != nil {
		t.Fatalf("expected reconnect send success, got %v", err)
	}
	if got := opener.openCount("/dev/mock"); got != 2 {
		t.Fatalf("expected reopen after failure, got %d opens", got)
	}
}

func TestSenderReconnectsAfterWriteTimeout(t *testing.T) {
	first := newMockSerialPort()
	first.writeDelay = 40 * time.Millisecond
	second := newMockSerialPort()

	openSeq := []SerialPort{first, second}
	opener := &mockOpener{
		openFn: func(path string, _ *serial.Mode) (SerialPort, error) {
			if len(openSeq) == 0 {
				return nil, errors.New("unexpected open")
			}
			next := openSeq[0]
			openSeq = openSeq[1:]
			return next, nil
		},
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:         opener,
		Sleep:          func(time.Duration) {},
		SettleDuration: time.Millisecond,
		HelloWindow:    10 * time.Millisecond,
		WriteTimeout:   5 * time.Millisecond,
	})
	defer sender.Close()

	started := time.Now()
	err := sender.Send("/dev/mock", []byte("{\"v\":1}\n"))
	if err == nil {
		t.Fatalf("expected first send timeout error")
	}
	if elapsed := time.Since(started); elapsed >= 30*time.Millisecond {
		t.Fatalf("expected write timeout before delay elapsed, got %s", elapsed)
	}
	if got := errcode.Of(err); got != errcode.TransportSerialWrite {
		t.Fatalf("expected serial write code, got %s", got)
	}
	if first.closeCalls == 0 {
		t.Fatalf("expected first port to be closed after write timeout")
	}

	if err := sender.Send("/dev/mock", []byte("{\"v\":1}\n")); err != nil {
		t.Fatalf("expected reconnect send success, got %v", err)
	}
	if got := opener.openCount("/dev/mock"); got != 2 {
		t.Fatalf("expected reopen after timeout, got %d opens", got)
	}
}

func TestDeviceHelloUnavailableReturnsProtocolCode(t *testing.T) {
	port := newMockSerialPort()
	opener := &mockOpener{
		portsByPath: map[string]SerialPort{
			"/dev/mock": port,
		},
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:         opener,
		Sleep:          func(time.Duration) {},
		SettleDuration: time.Millisecond,
		HelloWindow:    10 * time.Millisecond,
	})
	defer sender.Close()

	_, err := sender.ReadHello("/dev/mock")
	if err == nil {
		t.Fatalf("expected missing hello error")
	}
	if got := errcode.Of(err); got != errcode.ProtocolDeviceHelloUnavailable {
		t.Fatalf("expected protocol hello unavailable code, got %s", got)
	}
}

func TestDeviceHelloUsesRequestWithoutResetProbe(t *testing.T) {
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(
		`{"kind":"hello","deviceId":"14799300"}` + "\n",
	)}
	sender := NewSenderWithConfig(SenderConfig{
		Opener: &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:  func(time.Duration) {},
	})
	defer sender.Close()

	hello, err := sender.DeviceHello("/dev/mock")
	if err != nil {
		t.Fatalf("read requested hello: %v", err)
	}
	if hello.DeviceID != "14799300" {
		t.Fatalf("unexpected device id %q", hello.DeviceID)
	}
	if len(port.writePayloads) != 1 || string(port.writePayloads[0]) != string(helloRequestLine) {
		t.Fatalf("expected one hello request, got %#v", port.writePayloads)
	}
}

func TestResolverConfirmsPendingCableTransitionAfterIdentityMatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cu.usbserial-vibetv")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("create serial candidate: %v", err)
	}
	port := newMockSerialPort()
	helloLine := []byte(
		`{"kind":"hello","board":"esp8266-smalltv-st7789","deviceId":"14799300","capabilities":{"transport":{"active":"usb","mode":"cable","transitionPending":true,"transitionFrom":"wifi","transitionTo":"cable"}}}` + "\n",
	)
	confirmationLine := []byte(`{"kind":"connection-mode","status":"confirmed","deviceId":"14799300","mode":"cable"}` + "\n")
	port.readQueue = [][]byte{helloLine[:100], helloLine[100:], confirmationLine}
	sender := NewSenderWithConfig(SenderConfig{
		Opener: &mockOpener{portsByPath: map[string]SerialPort{path: port}},
		Sleep:  func(time.Duration) {},
	})
	defer sender.Close()

	resolved, err := sender.ResolvePort(path, "14799300")
	if err != nil {
		t.Fatalf("resolve pending Cable device: %v", err)
	}
	if resolved != path {
		t.Fatalf("resolved %q, expected %q", resolved, path)
	}
	if len(port.writePayloads) != 2 {
		t.Fatalf("expected hello plus confirmation requests, got %#v", port.writePayloads)
	}
	want := "{\"kind\":\"request\",\"op\":\"confirm-connection-mode\",\"deviceId\":\"14799300\"}\n"
	if got := string(port.writePayloads[1]); got != want {
		t.Fatalf("unexpected confirmation request %q", got)
	}
}

func TestResolverKeepsPendingCableTransitionWhenConfirmationIsRejected(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cu.usbserial-vibetv")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatalf("create serial candidate: %v", err)
	}
	port := newMockSerialPort()
	helloLine := []byte(`{"kind":"hello","board":"esp8266-smalltv-st7789","deviceId":"14799300","capabilities":{"transport":{"active":"usb","mode":"cable","transitionPending":true,"transitionFrom":"wifi","transitionTo":"cable"}}}` + "\n")
	port.readQueue = [][]byte{
		helloLine[:100],
		helloLine[100:],
		[]byte(`{"kind":"error","code":"connection-mode-confirmation-rejected","message":"failed to persist connection mode confirmation"}` + "\n"),
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{path: port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})
	defer sender.Close()

	if _, err := sender.ResolvePort(path, "14799300"); err == nil || !strings.Contains(err.Error(), "rejected confirmation") {
		t.Fatalf("expected rejected confirmation error, got %v", err)
	}
	if !sender.hello.Capabilities.Transport.TransitionPending {
		t.Fatalf("rejected confirmation must not clear cached pending state")
	}
}

func TestSenderStartsWiFiConnectionModeTransition(t *testing.T) {
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(`{"kind":"connection-mode","status":"switching","deviceId":"14799300","mode":"wifi"}` + "\n")}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	if err := sender.SetConnectionMode("/dev/mock", "14799300", "wifi"); err != nil {
		t.Fatalf("start WiFi transition: %v", err)
	}
	want := "{\"kind\":\"request\",\"op\":\"set-connection-mode\",\"deviceId\":\"14799300\",\"mode\":\"wifi\"}\n"
	if len(port.writePayloads) != 1 || string(port.writePayloads[0]) != want {
		t.Fatalf("unexpected connection mode request %#v", port.writePayloads)
	}
	if port.closeCalls != 1 {
		t.Fatal("acknowledged mode switch must release the rebooting device port")
	}
}

func TestSenderReadsAndWritesConfirmedCableSettings(t *testing.T) {
	path := "/dev/mock"
	port := newMockSerialPort()
	readReply := []byte(`{"kind":"settings","deviceId":"14799300","settings":{"display":{"brightnessPercent":35},"standby":{"enabled":true,"timeoutMinutes":15,"brightnessPercent":10,"screensaverPath":"/themes/s/night-clock.json"}}}` + "\n")
	writeReply := []byte(`{"kind":"settings","deviceId":"14799300","settings":{"display":{"brightnessPercent":60},"standby":{"enabled":true,"timeoutMinutes":15,"brightnessPercent":10,"screensaverPath":"/themes/s/night-clock.json"}}}` + "\n")
	port.readQueue = [][]byte{
		readReply[:100], readReply[100:],
		writeReply[:100], writeReply[100:],
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{path: port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})
	defer sender.Close()

	settings, err := sender.ReadSettings(path, "14799300")
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if settings.Display.BrightnessPercent != 35 || settings.Standby == nil || settings.Standby.TimeoutMinutes != 15 {
		t.Fatalf("unexpected settings: %+v", settings)
	}
	brightness := 60
	settings, err = sender.WriteSettings(path, "14799300", protocol.DeviceSettingsPatch{BrightnessPercent: &brightness})
	if err != nil {
		t.Fatalf("write settings: %v", err)
	}
	if settings.Display.BrightnessPercent != 60 {
		t.Fatalf("write did not return confirmed brightness: %+v", settings)
	}
	if len(port.writePayloads) != 2 {
		t.Fatalf("expected two settings requests, got %#v", port.writePayloads)
	}
	if got := string(port.writePayloads[0]); got != `{"kind":"request","op":"settings","deviceId":"14799300"}`+"\n" {
		t.Fatalf("unexpected read request %q", got)
	}
	if got := string(port.writePayloads[1]); got != `{"kind":"request","op":"settings","deviceId":"14799300","settings":{"brightnessPercent":60}}`+"\n" {
		t.Fatalf("unexpected write request %q", got)
	}
}

func TestSenderConfiguresWiFiWithoutLoggingOrReusingTheSecret(t *testing.T) {
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(`{"kind":"connection-mode","status":"switching","deviceId":"14799300","mode":"wifi"}` + "\n")}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	if err := sender.ConfigureWiFi("/dev/mock", "14799300", "Home WiFi", "secret pass"); err != nil {
		t.Fatalf("configure WiFi: %v", err)
	}
	want := `{"kind":"request","op":"configure-wifi","deviceId":"14799300","ssid":"Home WiFi","password":"secret pass"}` + "\n"
	if len(port.writePayloads) != 1 || string(port.writePayloads[0]) != want {
		t.Fatalf("unexpected WiFi configuration request %#v", port.writePayloads)
	}
	if port.closeCalls != 1 {
		t.Fatal("acknowledged WiFi switch must release the rebooting device port")
	}
}

func TestSenderPairsExactCableDevice(t *testing.T) {
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(`{"kind":"pairing","status":"paired","deviceId":"14799300","token":"0123456789abcdef0123456789abcdef"}` + "\n")}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	token, err := sender.PairDevice("/dev/mock", "14799300")
	if err != nil {
		t.Fatalf("pair Cable device: %v", err)
	}
	if token != "0123456789abcdef0123456789abcdef" {
		t.Fatalf("unexpected Cable pairing token %q", token)
	}
	want := `{"kind":"request","op":"pair","deviceId":"14799300"}` + "\n"
	if len(port.writePayloads) != 1 || string(port.writePayloads[0]) != want {
		t.Fatalf("unexpected Cable pairing request %#v", port.writePayloads)
	}
}

func TestSenderRejectsCablePairingForDifferentIdentity(t *testing.T) {
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(`{"kind":"pairing","status":"paired","deviceId":"different-device","token":"0123456789abcdef0123456789abcdef"}` + "\n")}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	if _, err := sender.PairDevice("/dev/mock", "14799300"); err == nil || !strings.Contains(err.Error(), "different identity") {
		t.Fatalf("expected Cable pairing identity rejection, got %v", err)
	}
}

func TestSenderRejectsInvalidCablePairingTokenWithoutLeakingIt(t *testing.T) {
	secret := "invalid token that must stay secret"
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(`{"kind":"pairing","status":"paired","deviceId":"14799300","token":"` + secret + `"}` + "\n")}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	_, err := sender.PairDevice("/dev/mock", "14799300")
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("expected secret-free invalid-token rejection, got %v", err)
	}
}

func TestSenderReportsCablePairingRejectionWithoutLeakingDeviceMessage(t *testing.T) {
	secret := "device-message-secret"
	port := newMockSerialPort()
	port.readQueue = [][]byte{[]byte(`{"kind":"error","code":"pairing-rejected","message":"` + secret + `"}` + "\n")}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:      &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:       func(time.Duration) {},
		HelloWindow: 10 * time.Millisecond,
	})

	_, err := sender.PairDevice("/dev/mock", "14799300")
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("expected secret-free device rejection, got %v", err)
	}
}

type mockOpener struct {
	mu          sync.Mutex
	portsByPath map[string]SerialPort
	openCounts  map[string]int
	openFn      func(path string, mode *serial.Mode) (SerialPort, error)
}

func (m *mockOpener) Open(path string, mode *serial.Mode) (SerialPort, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.openCounts == nil {
		m.openCounts = make(map[string]int)
	}
	m.openCounts[path]++
	if m.openFn != nil {
		return m.openFn(path, mode)
	}
	p, ok := m.portsByPath[path]
	if !ok {
		return nil, errors.New("unknown mock path: " + path)
	}
	return p, nil
}

func (m *mockOpener) openCount(path string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.openCounts[path]
}

type mockSerialPort struct {
	mu sync.Mutex

	readQueue     [][]byte
	readCalls     int
	readHook      func(int)
	writeCalls    int
	writePayloads [][]byte
	writeErr      error
	writeDelay    time.Duration
	closeCalls    int
}

func newMockSerialPort() *mockSerialPort {
	return &mockSerialPort{}
}

func (m *mockSerialPort) Read(p []byte) (int, error) {
	m.mu.Lock()
	m.readCalls++
	readCall := m.readCalls
	hook := m.readHook
	if len(m.readQueue) == 0 {
		m.mu.Unlock()
		if hook != nil {
			hook(readCall)
		}
		return 0, io.EOF
	}
	next := m.readQueue[0]
	n := copy(p, next)
	if n == len(next) {
		m.readQueue = m.readQueue[1:]
	} else {
		m.readQueue[0] = next[n:]
	}
	m.mu.Unlock()
	if hook != nil {
		hook(readCall)
	}
	return n, nil
}

func (m *mockSerialPort) Write(p []byte) (int, error) {
	m.mu.Lock()
	m.writeCalls++
	m.writePayloads = append(m.writePayloads, append([]byte(nil), p...))
	writeDelay := m.writeDelay
	writeErr := m.writeErr
	m.mu.Unlock()
	if writeDelay > 0 {
		time.Sleep(writeDelay)
	}
	if writeErr != nil {
		return 0, writeErr
	}
	return len(p), nil
}

func (m *mockSerialPort) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closeCalls++
	return nil
}

func (m *mockSerialPort) SetReadTimeout(time.Duration) error { return nil }
func (m *mockSerialPort) ResetInputBuffer() error            { return nil }
func (m *mockSerialPort) SetDTR(bool) error                  { return nil }
func (m *mockSerialPort) SetRTS(bool) error                  { return nil }
