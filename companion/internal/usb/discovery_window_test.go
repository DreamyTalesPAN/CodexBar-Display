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

func TestDeviceHelloExpiredDeadlineBeforeCancellation(t *testing.T) {
	opener := &mockOpener{portsByPath: map[string]SerialPort{"/dev/mock": newMockSerialPort()}}
	sender := NewSenderWithConfig(SenderConfig{Opener: opener})
	defer sender.Close()
	ctx := pendingDeadlineContext{Context: context.Background(), deadline: time.Now().Add(-time.Second)}
	_, err := sender.DeviceHelloContext(ctx, "/dev/mock")
	if !errors.Is(err, context.DeadlineExceeded) || opener.openCount("/dev/mock") != 0 {
		t.Fatalf("expired deadline opened a port before cancellation arrived: err=%v", err)
	}
}

// Model a deadline whose asynchronous cancellation has not been delivered yet.
type pendingDeadlineContext struct {
	context.Context
	deadline time.Time
}

func (c pendingDeadlineContext) Deadline() (time.Time, bool) { return c.deadline, true }

func TestFirmwareCableProbesHonorSharedDeadline(t *testing.T) {
	for _, resolve := range []bool{false, true} {
		t.Run(map[bool]string{false: "hello", true: "all candidates"}[resolve], func(t *testing.T) {
			const first = "/dev/cu.usbserial-deadline-a"
			const second = "/dev/cu.usbserial-deadline-b"
			listSerialPorts(t, first, second)
			port := &deadlineSerialPort{mockSerialPort: newMockSerialPort()}
			otherPort := &deadlineSerialPort{mockSerialPort: newMockSerialPort()}
			opener := &mockOpener{portsByPath: map[string]SerialPort{first: port, second: otherPort}}
			sender := NewSenderWithConfig(SenderConfig{
				Opener: opener, Sleep: func(time.Duration) {}, HelloWindow: 250 * time.Millisecond,
			})
			defer sender.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()
			started := time.Now()
			var err error
			if resolve {
				_, err = sender.ResolveControlPortContext(ctx, "", "device-a")
			} else {
				_, err = sender.DeviceHelloContext(ctx, first)
			}
			if err == nil {
				t.Fatal("silent ports cannot prove a VibeTV")
			}
			if elapsed := time.Since(started); elapsed > 150*time.Millisecond {
				t.Fatalf("serial probes exceeded the shared 30ms budget: %s", elapsed)
			}
			if port.maxTimeout > 30*time.Millisecond {
				t.Fatalf("serial read received a fresh timeout beyond the shared budget: %s", port.maxTimeout)
			}
			if otherPort.maxTimeout > 30*time.Millisecond {
				t.Fatalf("the other port's read exceeded the shared budget: %s", otherPort.maxTimeout)
			}
		})
	}
}

// Model a silent serial driver that blocks for the timeout it was given.
type deadlineSerialPort struct {
	*mockSerialPort
	timeout    time.Duration
	maxTimeout time.Duration
}

func (p *deadlineSerialPort) SetReadTimeout(timeout time.Duration) error {
	p.timeout = timeout
	p.maxTimeout = max(p.maxTimeout, timeout)
	return nil
}

func (p *deadlineSerialPort) Read([]byte) (int, error) {
	time.Sleep(p.timeout)
	return 0, nil
}

// #886: a silent adapter listed before the VibeTV used the whole shared
// budget, so the VibeTV behind it was never asked. Every port gets the full
// remaining window, so a VibeTV that is still booting keeps its chance too.
func TestControlResolveProbesPortsConcurrentlyWithinSharedBudget(t *testing.T) {
	const silent = "/dev/cu.usbserial-silent"
	const vibetv = "/dev/cu.usbserial-vibetv"
	for name, bootDelay := range map[string]time.Duration{"answers at once": 0, "answers late": 250 * time.Millisecond} {
		t.Run(name, func(t *testing.T) {
			listSerialPorts(t, silent, vibetv)
			booted := newMockSerialPort()
			started := time.Now()
			booted.readHook = func(int) {
				time.Sleep(time.Millisecond)
				if time.Since(started) < bootDelay {
					return
				}
				booted.mu.Lock()
				defer booted.mu.Unlock()
				if len(booted.readQueue) == 0 {
					booted.readQueue = [][]byte{[]byte(unplugTestHello)}
				}
			}
			sender := NewSenderWithConfig(SenderConfig{
				Opener: &mockOpener{portsByPath: map[string]SerialPort{
					silent: &deadlineSerialPort{mockSerialPort: newMockSerialPort()}, vibetv: booted,
				}},
				Sleep: func(time.Duration) {}, HelloWindow: 5 * time.Second,
			})
			defer sender.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()

			got, err := sender.ResolveControlPortContext(ctx, "", "5804558")
			if err != nil || got != vibetv {
				t.Fatalf("a silent first adapter hid the VibeTV: port=%q err=%v", got, err)
			}
			if open, ok := sender.OpenVibeTVPort(); !ok || open != vibetv {
				t.Fatalf("the answering VibeTV's port must stay open for the caller: %q %v", open, ok)
			}
		})
	}
}
