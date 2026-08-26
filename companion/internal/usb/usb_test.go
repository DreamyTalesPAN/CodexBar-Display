package usb

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	serial "go.bug.st/serial"
)

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
	port.readQueue = [][]byte{helloLine[:100], helloLine[100:]}
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
	defer m.mu.Unlock()
	if len(m.readQueue) == 0 {
		return 0, io.EOF
	}
	next := m.readQueue[0]
	m.readQueue = m.readQueue[1:]
	n := copy(p, next)
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
