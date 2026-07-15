package transport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

const (
	defaultWiFiDiscoveryTimeout      = 5 * time.Second
	defaultWiFiDiscoveryProbeTimeout = 700 * time.Millisecond
	wifiDiscoveryWorkers             = 48
	maxWiFiDiscoveryTargets          = 1024
)

type WiFiDiscoveryOptions struct {
	Candidates         []string
	IncludeNetworkScan bool
	Timeout            time.Duration
	Client             *http.Client
	ExpectedDeviceID   string
}

type WiFiDiscoveryResult struct {
	Target string
	Hello  protocol.DeviceHello
	Source string
}

func DiscoverWiFiDevice(ctx context.Context, opts WiFiDiscoveryOptions) (WiFiDiscoveryResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultWiFiDiscoveryTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client := opts.Client
	if client == nil {
		client = &http.Client{Timeout: defaultWiFiDiscoveryProbeTimeout}
	}

	candidates := uniqueDiscoveryTargets(opts.Candidates)
	var lastErr error
	for _, candidate := range candidates {
		hello, err := probeWiFiHello(ctx, client, candidate)
		if err == nil {
			if !matchesExpectedDeviceID(hello, opts.ExpectedDeviceID) {
				lastErr = fmt.Errorf("VibeTV device id mismatch: expected=%q got=%q", strings.TrimSpace(opts.ExpectedDeviceID), hello.DeviceID)
				continue
			}
			return WiFiDiscoveryResult{Target: publicDiscoveryTarget(candidate), Hello: hello, Source: "candidate"}, nil
		}
		lastErr = err
	}

	if !opts.IncludeNetworkScan {
		if lastErr == nil {
			lastErr = errors.New("no discovery candidates")
		}
		return WiFiDiscoveryResult{}, lastErr
	}

	scanTargets := localIPv4DiscoveryTargets()
	if len(scanTargets) == 0 {
		if lastErr == nil {
			lastErr = errors.New("no local IPv4 networks available for discovery")
		}
		return WiFiDiscoveryResult{}, lastErr
	}
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		seen[publicDiscoveryTarget(candidate)] = struct{}{}
	}
	filtered := scanTargets[:0]
	for _, target := range scanTargets {
		if _, ok := seen[target]; ok {
			continue
		}
		filtered = append(filtered, target)
	}

	result, err := scanWiFiTargets(ctx, client, filtered, opts.ExpectedDeviceID)
	if err == nil {
		return result, nil
	}
	if lastErr != nil {
		return WiFiDiscoveryResult{}, fmt.Errorf("%v; network scan: %w", lastErr, err)
	}
	return WiFiDiscoveryResult{}, err
}

func scanWiFiTargets(ctx context.Context, client *http.Client, targets []string, expectedDeviceID string) (WiFiDiscoveryResult, error) {
	if len(targets) == 0 {
		return WiFiDiscoveryResult{}, errors.New("no scan targets")
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	workerCount := wifiDiscoveryWorkers
	if len(targets) < workerCount {
		workerCount = len(targets)
	}
	jobs := make(chan string)
	results := make(chan WiFiDiscoveryResult, 1)
	var wg sync.WaitGroup

	for i := 0; i < workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for target := range jobs {
				if ctx.Err() != nil {
					return
				}
				hello, err := probeWiFiHello(ctx, client, target)
				if err != nil {
					continue
				}
				if !matchesExpectedDeviceID(hello, expectedDeviceID) {
					continue
				}
				select {
				case results <- WiFiDiscoveryResult{Target: publicDiscoveryTarget(target), Hello: hello, Source: "network-scan"}:
					cancel()
				default:
				}
				return
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, target := range targets {
			select {
			case <-ctx.Done():
				return
			case jobs <- target:
			}
		}
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case result := <-results:
		return result, nil
	case <-done:
		return WiFiDiscoveryResult{}, errors.New("no VibeTV device found on local network")
	case <-ctx.Done():
		return WiFiDiscoveryResult{}, ctx.Err()
	}
}

func matchesExpectedDeviceID(hello protocol.DeviceHello, expected string) bool {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return true
	}
	return strings.EqualFold(expected, strings.TrimSpace(hello.DeviceID))
}

func probeWiFiHello(ctx context.Context, client *http.Client, target string) (protocol.DeviceHello, error) {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return protocol.DeviceHello{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/hello", nil)
	if err != nil {
		return protocol.DeviceHello{}, fmt.Errorf("build device hello request: %w", err)
	}
	req.Close = true
	resp, err := client.Do(req)
	if err != nil {
		return protocol.DeviceHello{}, fmt.Errorf("get device hello: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return protocol.DeviceHello{}, fmt.Errorf("get device hello: status=%d body=%q", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var hello protocol.DeviceHello
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&hello); err != nil {
		return protocol.DeviceHello{}, fmt.Errorf("decode device hello: %w", err)
	}
	hello = hello.Normalize()
	if !isVibeTVHello(hello) {
		return protocol.DeviceHello{}, fmt.Errorf("device hello does not look like VibeTV: board=%q", hello.Board)
	}
	return hello, nil
}

func isVibeTVHello(hello protocol.DeviceHello) bool {
	hello = hello.Normalize()
	caps := protocol.CapabilitiesFromHello(hello)
	if !caps.Known {
		return false
	}
	board := strings.ToLower(strings.TrimSpace(hello.Board))
	if strings.Contains(board, "vibetv") ||
		strings.Contains(board, "smalltv") ||
		strings.Contains(board, "codexbar") {
		return true
	}
	if caps.SupportsThemeSpecV1 &&
		(caps.ActiveTransport == "wifi" || containsString(caps.SupportedTransportChannels, "wifi")) {
		return true
	}
	return false
}

func localIPv4DiscoveryTargets() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	return localIPv4DiscoveryTargetsFromAddrs(addrs)
}

func localIPv4DiscoveryTargetsFromAddrs(addrs []net.Addr) []string {
	seen := map[string]struct{}{}
	targets := make([]string, 0, 256)
	for _, addr := range addrs {
		ip, ok := ipv4FromAddr(addr)
		if !ok || !isPrivateIPv4(ip) || ip.IsLoopback() {
			continue
		}
		for host := 1; host <= 254; host++ {
			if byte(host) == ip[3] {
				continue
			}
			target := fmt.Sprintf("http://%d.%d.%d.%d", ip[0], ip[1], ip[2], host)
			if _, ok := seen[target]; ok {
				continue
			}
			seen[target] = struct{}{}
			targets = append(targets, target)
			if len(targets) >= maxWiFiDiscoveryTargets {
				return targets
			}
		}
	}
	sort.Strings(targets)
	return targets
}

func ipv4FromAddr(addr net.Addr) (net.IP, bool) {
	var ip net.IP
	switch value := addr.(type) {
	case *net.IPNet:
		ip = value.IP
	case *net.IPAddr:
		ip = value.IP
	default:
		return nil, false
	}
	ip = ip.To4()
	return ip, ip != nil
}

func isPrivateIPv4(ip net.IP) bool {
	ip = ip.To4()
	if ip == nil {
		return false
	}
	return ip[0] == 10 ||
		(ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) ||
		(ip[0] == 192 && ip[1] == 168)
}

func uniqueDiscoveryTargets(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = publicDiscoveryTarget(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func publicDiscoveryTarget(target string) string {
	base, err := normalizeWiFiTarget(target)
	if err != nil {
		return strings.TrimRight(strings.TrimSpace(target), "/")
	}
	return base
}

func containsString(values []string, needle string) bool {
	needle = strings.TrimSpace(strings.ToLower(needle))
	for _, value := range values {
		if strings.TrimSpace(strings.ToLower(value)) == needle {
			return true
		}
	}
	return false
}
