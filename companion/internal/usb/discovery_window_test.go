package usb

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	serial "go.bug.st/serial"

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

// #886: a silent adapter must not hold the result until the shared deadline.
// waitForCableFirmwareVersion resolves the port and then reads the hello under
// the same ctx, so a resolve that returns at the deadline leaves no time to read.
func TestControlResolveReturnsAsSoonAsTheExpectedVibeTVAnswers(t *testing.T) {
	const silent = "/dev/cu.usbserial-silent"
	const vibetv = "/dev/cu.usbserial-vibetv"
	listSerialPorts(t, silent, vibetv)
	answering := newMockSerialPort()
	answering.readHook = func(int) {
		time.Sleep(time.Millisecond)
		answering.mu.Lock()
		defer answering.mu.Unlock()
		if len(answering.readQueue) == 0 {
			answering.readQueue = [][]byte{[]byte(unplugTestHello)}
		}
	}
	sender := NewSenderWithConfig(SenderConfig{
		Opener: &mockOpener{portsByPath: map[string]SerialPort{
			silent: &deadlineSerialPort{mockSerialPort: newMockSerialPort()}, vibetv: answering,
		}},
		Sleep: func(time.Duration) {}, HelloWindow: 5 * time.Second,
	})
	defer sender.Close()

	const budget = 3 * time.Second // stands in for cableCheckAfterWiFiTimeout (15 s)
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	start := time.Now()
	got, err := sender.ResolveControlPortContext(ctx, "", "5804558")
	elapsed := time.Since(start)
	t.Logf("resolve: port=%q err=%v after %s of a %s budget", got, err, elapsed, budget)
	if err != nil || got != vibetv {
		t.Fatalf("resolve itself should find the VibeTV: %q %v", got, err)
	}
	if _, readErr := sender.DeviceHelloContext(ctx, got); readErr != nil {
		t.Errorf("follow-up hello read under the same ctx failed: %v (resolve returned after %s of %s)", readErr, elapsed, budget)
	}
	if elapsed > 1500*time.Millisecond { // one 1 s read step at most
		t.Errorf("the VibeTV answered at once, but resolve returned only after %s of the %s budget", elapsed, budget)
	}
}

// exclusivePorts mimics go.bug.st/serial: a second Open of a held port fails
// (TIOCEXCL on unix, exclusive CreateFile on Windows).
type exclusivePorts struct {
	mu    sync.Mutex
	held  map[string]int
	opens int
	mk    func(path string) SerialPort
}

type exclusivePort struct {
	SerialPort
	owner *exclusivePorts
	path  string
	once  sync.Once
}

func (o *exclusivePorts) Open(path string, _ *serial.Mode) (SerialPort, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.held == nil {
		o.held = map[string]int{}
	}
	if o.held[path] > 0 {
		return nil, &serial.PortError{}
	}
	o.held[path]++
	o.opens++
	return &exclusivePort{SerialPort: o.mk(path), owner: o, path: path}, nil
}

func (p *exclusivePort) Close() error {
	p.once.Do(func() {
		p.owner.mu.Lock()
		p.owner.held[p.path]--
		p.owner.mu.Unlock()
	})
	return nil
}

func (o *exclusivePorts) holding(path string) int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.held[path]
}

func helloPort() *mockSerialPort {
	p := newMockSerialPort()
	p.readHook = func(int) {
		time.Sleep(time.Millisecond)
		p.mu.Lock()
		defer p.mu.Unlock()
		if len(p.readQueue) == 0 {
			p.readQueue = [][]byte{[]byte(unplugTestHello)}
		}
	}
	return p
}

// If the held port is closed between currentMatchingPort and the readHello
// closure's openPath check, the closure builds a probe sender that must still
// be closed or adopted.
func TestControlResolveReleasesProbeWhenHeldPortClosesDuringMatchingFastPath(t *testing.T) {
	const vibetv = "/dev/cu.usbserial-vibetv"
	listSerialPorts(t, vibetv)
	ex := &exclusivePorts{mk: func(string) SerialPort { return helloPort() }}
	sender := NewSenderWithConfig(SenderConfig{Opener: ex, Sleep: func(time.Duration) {}, HelloWindow: time.Second})
	defer sender.Close()
	ctx := context.Background()

	for i := 0; i < 8000; i++ {
		if _, err := sender.DeviceHelloContext(ctx, vibetv); err != nil {
			t.Fatalf("setup open: %v", err)
		}
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); <-start; _, _ = sender.ResolveControlPortContext(ctx, vibetv, "5804558") }()
		go func() { defer wg.Done(); <-start; sender.Close() }()
		close(start)
		wg.Wait()
		// Whatever happened, closing the sender must release every port it
		// knows about. A port still held afterwards belongs to a leaked probe.
		sender.Close()
		if n := ex.holding(vibetv); n != 0 {
			t.Fatalf("iteration %d: port %s still held by an unreferenced probe sender (%d)", i, vibetv, n)
		}
	}
}
