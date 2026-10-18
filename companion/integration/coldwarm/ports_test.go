package coldwarm

import (
	"math/rand/v2"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// Ephemeral (outbound/client) source ports are drawn from these OS ranges:
// Linux 32768-60999 by default (ip_local_port_range), macOS and Windows
// 49152-65535. A test port inside such a range can be taken by any outbound
// socket of the daemon or the test while the virtual device is powered off, so
// the power-on bind fails with "address already in use". 20000-32767 lies
// outside all of those ranges.
const (
	safePortMin = 20000
	safePortMax = 32767
)

// reservedPorts holds every port handed out in this process, from reservation
// until the owning test's cleanup. Parallel subtests (signed_in, signed_out)
// otherwise could pick the port that the other one released while its device
// is powered off.
var (
	reservedMu    sync.Mutex
	reservedPorts = map[int]bool{}
)

// reserveNonEphemeralPort returns a listener on a free loopback port outside
// the OS ephemeral ranges. The caller may close it before the real owner binds
// the port; the port stays reserved in this process until the test ends.
func reserveNonEphemeralPort(t *testing.T) net.Listener {
	t.Helper()
	for range 200 {
		port := safePortMin + rand.IntN(safePortMax-safePortMin+1)
		reservedMu.Lock()
		if reservedPorts[port] {
			reservedMu.Unlock()
			continue
		}
		l, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			reservedMu.Unlock()
			continue
		}
		reservedPorts[port] = true
		reservedMu.Unlock()
		t.Cleanup(func() {
			_ = l.Close()
			reservedMu.Lock()
			delete(reservedPorts, port)
			reservedMu.Unlock()
		})
		return l
	}
	t.Fatalf("no free loopback port in %d-%d", safePortMin, safePortMax)
	return nil
}

// Regression for the parallel-subtest collision: a port released by one
// reservation must not be handed out again while the test runs.
func TestReservedPortsAreNotHandedOutTwice(t *testing.T) {
	seen := map[int]bool{}
	for range 300 {
		l := reserveNonEphemeralPort(t)
		port := l.Addr().(*net.TCPAddr).Port
		_ = l.Close()
		if seen[port] {
			t.Fatalf("port %d handed out twice after its reservation was released", port)
		}
		seen[port] = true
	}
}

func TestReservedPortsAvoidEphemeralRanges(t *testing.T) {
	for range 20 {
		l := reserveNonEphemeralPort(t)
		port := l.Addr().(*net.TCPAddr).Port
		if port < safePortMin || port > safePortMax {
			t.Fatalf("port %d outside %d-%d", port, safePortMin, safePortMax)
		}
		for _, eph := range [][2]int{{32768, 60999}, {49152, 65535}} {
			if port >= eph[0] && port <= eph[1] {
				t.Fatalf("port %d inside ephemeral range %d-%d", port, eph[0], eph[1])
			}
		}
	}
}

// On Linux the real range can be configured per runner, so also compare the
// safe range with the kernel's current setting.
func TestSafePortRangeDoesNotOverlapKernelEphemeralRange(t *testing.T) {
	data, err := os.ReadFile("/proc/sys/net/ipv4/ip_local_port_range")
	if err != nil {
		t.Skipf("kernel ephemeral range not readable: %v", err)
	}
	fields := strings.Fields(string(data))
	if len(fields) != 2 {
		t.Fatalf("unexpected ip_local_port_range: %q", data)
	}
	lo, errLo := strconv.Atoi(fields[0])
	hi, errHi := strconv.Atoi(fields[1])
	if errLo != nil || errHi != nil {
		t.Fatalf("unexpected ip_local_port_range: %q", data)
	}
	if safePortMin <= hi && lo <= safePortMax {
		t.Fatalf("safe range %d-%d overlaps kernel ephemeral range %d-%d", safePortMin, safePortMax, lo, hi)
	}
}
