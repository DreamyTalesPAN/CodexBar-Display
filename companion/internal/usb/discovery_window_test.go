package usb

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func TestDiscoveryProbesSilentPortsInParallel(t *testing.T) {
	started := make(chan struct{}, 3)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() {
		for range 3 {
			select {
			case <-started:
			case <-ctx.Done():
				return
			}
		}
		cancel()
	}()
	start := time.Now()
	devices, _ := discoverVibeTVs([]string{"COM1", "COM2", "COM3"}, func(port string) (protocol.DeviceHello, error) {
		started <- struct{}{}
		<-ctx.Done()
		if port == "COM3" {
			return cableHello("slow-boot"), nil
		}
		return protocol.DeviceHello{}, errors.New("silent adapter")
	}, "windows")
	if time.Since(start) > 500*time.Millisecond || len(devices) != 1 {
		t.Fatalf("silent ports must not serialize boot windows: devices=%v elapsed=%s", devices, time.Since(start))
	}
}

func TestDeviceHelloForDiscoveryWaitsForWiFiBootWithoutReopening(t *testing.T) {
	port := newMockSerialPort()
	started := time.Now()
	port.readHook = func(int) {
		time.Sleep(time.Millisecond)
		if time.Since(started) > 3500*time.Millisecond {
			port.mu.Lock()
			port.readQueue = append(port.readQueue, []byte("{\"kind\":\"hello\",\"deviceId\":\"booted\"}\n"))
			port.mu.Unlock()
		}
	}
	opener := &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:       opener,
		Sleep:        func(time.Duration) {},
		HelloWindow:  5 * time.Second,
		WriteTimeout: 50 * time.Millisecond,
	})
	defer sender.Close()

	hello, err := sender.DeviceHelloForDiscovery("/dev/mock")
	if err != nil || hello.DeviceID != "booted" || opener.openCount("/dev/mock") != 1 {
		t.Fatalf("slow boot must answer on one open port: hello=%+v err=%v", hello, err)
	}
}

func TestDiscoveryHelloHonorsSharedDeadline(t *testing.T) {
	port := newMockSerialPort()
	sender := NewSenderWithConfig(SenderConfig{
		Opener: &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}},
		Sleep:  func(time.Duration) {},
	})
	defer sender.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := sender.deviceHelloLocked(ctx, "/dev/mock", 30*time.Second); err == nil {
		t.Fatal("silent port must not answer")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("probe exceeded shared deadline: %s", elapsed)
	}
}

func TestDiscoveryCancellationDoesNotOpenPort(t *testing.T) {
	opener := &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": newMockSerialPort()}}
	sender := NewSenderWithConfig(SenderConfig{Opener: opener})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := sender.deviceHelloLocked(ctx, "/dev/mock", 30*time.Second)
	if !errors.Is(err, context.Canceled) || opener.openCount("/dev/mock") != 0 {
		t.Fatalf("cancelled discovery opened a port: err=%v", err)
	}
}

// Control paths still tolerate a device that reboots when the port opens, so
// shortening discovery must not shorten them.
func TestDeviceHelloKeepsControlWindow(t *testing.T) {
	port := newMockSerialPort()
	opener := &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": port}}
	sender := NewSenderWithConfig(SenderConfig{
		Opener:       opener,
		Sleep:        func(time.Duration) {},
		HelloWindow:  600 * time.Millisecond,
		WriteTimeout: 50 * time.Millisecond,
	})
	defer sender.Close()

	start := time.Now()
	if _, err := sender.DeviceHello("/dev/mock"); err == nil {
		t.Fatal("silent device must not report a hello")
	}
	if elapsed := time.Since(start); elapsed < 600*time.Millisecond {
		t.Fatalf("control hello returned after %s; it must use the full configured window", elapsed)
	}
}
