//go:build unix

package usb

import (
	"bufio"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/creack/pty"
	serial "go.bug.st/serial"
)

func TestSenderPseudoTTYReadHelloAndSend(t *testing.T) {
	master, slave := openPseudoTTY(t)
	defer master.Close()
	defer slave.Close()
	slavePath := slave.Name()

	opened := make(chan struct{}, 1)
	lines := streamLines(master)

	go func() {
		<-opened
		_, _ = master.Write([]byte("booting...\n"))
		time.Sleep(40 * time.Millisecond)
		_, _ = master.Write([]byte("{\"kind\":\"hello\",\"protocolVersion\":1,\"board\":\"esp8266-smalltv-st7789\",\"features\":[\"theme\"],\"maxFrameBytes\":512}\n"))
	}()

	sender := NewSenderWithConfig(SenderConfig{
		Opener: pseudoTTYOpener{
			onOpen: func(string) { opened <- struct{}{} },
		},
		SettleDuration: 20 * time.Millisecond,
		HelloWindow:    700 * time.Millisecond,
	})
	defer sender.Close()

	hello, err := sender.ReadHello(slavePath)
	if err != nil {
		t.Fatalf("read hello over pseudo-tty: %v", err)
	}
	if hello.Kind != "hello" || hello.Board != "esp8266-smalltv-st7789" {
		t.Fatalf("unexpected hello payload: %+v", hello)
	}

	if err := sender.Send(slavePath, []byte("{\"v\":1,\"provider\":\"codex\"}\n")); err != nil {
		t.Fatalf("send frame over pseudo-tty: %v", err)
	}

	line := waitForLineContaining(t, lines, "\"provider\":\"codex\"", "provider frame")
	if !strings.Contains(line, "\"provider\":\"codex\"") {
		t.Fatalf("expected provider frame in pseudo-device line, got %q", line)
	}
}

func TestSenderPseudoTTYReconnectAfterDeviceSwap(t *testing.T) {
	sender := NewSenderWithConfig(SenderConfig{
		Opener:         pseudoTTYOpener{},
		SettleDuration: 10 * time.Millisecond,
		HelloWindow:    300 * time.Millisecond,
	})
	defer sender.Close()

	master1, slave1 := openPseudoTTY(t)
	path1 := slave1.Name()
	lines1 := streamLines(master1)
	defer master1.Close()
	defer slave1.Close()

	if err := sender.Send(path1, []byte("{\"v\":1,\"provider\":\"codex\"}\n")); err != nil {
		t.Fatalf("send to first pseudo-device: %v", err)
	}
	if got := waitForLineContaining(t, lines1, "\"provider\":\"codex\"", "first provider frame"); !strings.Contains(got, "\"provider\":\"codex\"") {
		t.Fatalf("unexpected first frame line: %q", got)
	}

	_ = master1.Close()

	master2, slave2 := openPseudoTTY(t)
	path2 := slave2.Name()
	lines2 := streamLines(master2)
	defer master2.Close()
	defer slave2.Close()

	if err := sender.Send(path2, []byte("{\"v\":1,\"provider\":\"claude\"}\n")); err != nil {
		t.Fatalf("send to second pseudo-device: %v", err)
	}
	if got := waitForLineContaining(t, lines2, "\"provider\":\"claude\"", "second provider frame"); !strings.Contains(got, "\"provider\":\"claude\"") {
		t.Fatalf("unexpected second frame line: %q", got)
	}
}

func TestSenderPseudoTTYReadHelloAfterWakeDelay(t *testing.T) {
	master, slave := openPseudoTTY(t)
	defer master.Close()
	defer slave.Close()
	slavePath := slave.Name()

	opened := make(chan struct{}, 1)
	go func() {
		<-opened
		_, _ = master.Write([]byte("wakeup-noise\n"))
		time.Sleep(150 * time.Millisecond)
		_, _ = master.Write([]byte("{\"kind\":\"hello\",\"protocolVersion\":1,\"board\":\"esp32-lilygo-t-display-s3\"}\n"))
	}()

	sender := NewSenderWithConfig(SenderConfig{
		Opener: pseudoTTYOpener{
			onOpen: func(string) { opened <- struct{}{} },
		},
		SettleDuration: 10 * time.Millisecond,
		HelloWindow:    700 * time.Millisecond,
	})
	defer sender.Close()

	hello, err := sender.ReadHello(slavePath)
	if err != nil {
		t.Fatalf("read delayed hello after wake: %v", err)
	}
	if hello.Board != "esp32-lilygo-t-display-s3" {
		t.Fatalf("unexpected hello board after delayed wake payload: %+v", hello)
	}
}

func openPseudoTTY(t *testing.T) (*os.File, *os.File) {
	t.Helper()
	master, slave, err := pty.Open()
	if err != nil {
		t.Fatalf("open pseudo tty: %v", err)
	}
	return master, slave
}

func streamLines(master *os.File) <-chan string {
	out := make(chan string, 16)
	go func() {
		defer close(out)
		scanner := bufio.NewScanner(master)
		for scanner.Scan() {
			out <- strings.TrimSpace(scanner.Text())
		}
	}()
	return out
}

func waitForLineContaining(t *testing.T, lines <-chan string, substring, name string) string {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				t.Fatalf("line stream closed before %s", name)
			}
			if strings.Contains(line, substring) {
				return line
			}
		case <-timeout:
			t.Fatalf("timeout waiting for %s containing %q", name, substring)
		}
	}
}

type pseudoTTYOpener struct {
	onOpen func(path string)
}

func (o pseudoTTYOpener) Open(path string, _ *serial.Mode) (SerialPort, error) {
	if o.onOpen != nil {
		o.onOpen(path)
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return nil, err
	}
	return &pseudoTTYPort{File: f}, nil
}

type pseudoTTYPort struct {
	*os.File
	mu          sync.Mutex
	readTimeout time.Duration
}

func (p *pseudoTTYPort) Read(b []byte) (int, error) {
	p.mu.Lock()
	timeout := p.readTimeout
	p.mu.Unlock()
	if timeout > 0 {
		_ = p.SetReadDeadline(time.Now().Add(timeout))
	} else {
		_ = p.SetReadDeadline(time.Time{})
	}
	return p.File.Read(b)
}

func (p *pseudoTTYPort) SetReadTimeout(timeout time.Duration) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.readTimeout = timeout
	return nil
}

func (p *pseudoTTYPort) ResetInputBuffer() error {
	return nil
}

func (p *pseudoTTYPort) SetDTR(bool) error { return nil }
func (p *pseudoTTYPort) SetRTS(bool) error { return nil }
