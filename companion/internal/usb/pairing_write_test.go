package usb

import (
	"errors"
	"io"
	"testing"
	"time"
)

// The serial library forwards the OS byte count on both Unix and Windows;
// a write can return fewer bytes than requested without an OS error.
type shortPairingWritePort struct{ *mockSerialPort }

func (p shortPairingWritePort) Write(data []byte) (int, error) {
	return len(data) / 2, nil
}

func TestPairingShortWriteClosesPortWithoutReadingAcknowledgement(t *testing.T) {
	port := newMockSerialPort()
	sender := NewSenderWithConfig(SenderConfig{
		Opener: &mockOpener{portsByPath: map[string]SerialPort{
			"/dev/mock": shortPairingWritePort{port},
		}},
		HelloWindow: time.Millisecond,
	})
	t.Cleanup(sender.Close)
	token, err := sender.PairDevice("/dev/mock", "14799300")
	if token != "" || !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("incomplete pairing request: token present=%t, err=%v", token != "", err)
	}
	if port.readCalls != 0 || port.closeCalls != 1 {
		t.Fatalf("short write must close the port before reading: reads=%d closes=%d", port.readCalls, port.closeCalls)
	}
}

func TestWriteWithTimeoutRejectsShortWrites(t *testing.T) {
	for _, timeout := range []time.Duration{0, time.Second} {
		port := shortPairingWritePort{newMockSerialPort()}
		if err := writeWithTimeout(port, []byte("pairing request\n"), timeout); !errors.Is(err, io.ErrShortWrite) {
			t.Fatalf("timeout=%s: got %v, want short write", timeout, err)
		}
	}
}
