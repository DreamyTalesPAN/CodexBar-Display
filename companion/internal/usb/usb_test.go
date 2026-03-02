package usb

import (
	"errors"
	"io"
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
	line := `{"kind":"hello","protocolVersion":1,"board":"esp8266-smalltv-st7789","features":["theme"]}`
	hello, ok := parseDeviceHelloLine(line)
	if !ok {
		t.Fatalf("expected hello parse success")
	}
	if hello.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected board %q", hello.Board)
	}
	if !hello.HasFeature(protocol.FeatureTheme) {
		t.Fatalf("expected theme feature in hello")
	}
}

func TestParseDeviceHelloLineLegacyReady(t *testing.T) {
	hello, ok := parseDeviceHelloLine("vibeblock_ready_display")
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

	readQueue  [][]byte
	writeCalls int
	writeErr   error
	closeCalls int
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
	defer m.mu.Unlock()
	m.writeCalls++
	if m.writeErr != nil {
		return 0, m.writeErr
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
