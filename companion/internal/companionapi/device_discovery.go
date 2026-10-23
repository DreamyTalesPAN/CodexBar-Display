package companionapi

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimeconfig"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

// The real ESP8266 answers /hello well below this limit, while one second still
// leaves enough margin for a busy device. Candidates nearest to the Mac are
// probed first so ordinary customer networks finish quickly even when their
// configured IPv4 subnet is larger than /24.
var subnetProbeTime = time.Second

var localNetworkPermissionGOOS = runtime.GOOS

var errLocalNetworkAccessDenied = errors.New("local network access denied")

// errNoLocalNetwork: the Mac holds no usable network address, so an automatic
// scan has nowhere to go. Saved private targets would be probed into a void
// for the whole search window and settle on "0 found" -- the honest answer is
// that WiFi is off, not that no VibeTV exists.
var errNoLocalNetwork = errors.New("no local network")

const (
	localNetworkDenialMinimumSamples  = 8
	localNetworkDenialProbeMaxElapsed = 250 * time.Millisecond
)

type multipleDevicesError struct {
	targets []string
}

func (e *multipleDevicesError) Error() string {
	if e == nil || len(e.targets) == 0 {
		return "multiple VibeTV devices found"
	}
	return fmt.Sprintf("multiple VibeTV devices found: %s", strings.Join(e.targets, ", "))
}

type invalidTargetError struct {
	target string
}

func (e *invalidTargetError) Error() string {
	return "invalid VibeTV target"
}

type deviceSearchEntry struct {
	Target      string `json:"target"`
	Transport   string `json:"transport"`
	DeviceID    string `json:"deviceId,omitempty"`
	Board       string `json:"board,omitempty"`
	Firmware    string `json:"firmware,omitempty"`
	NetworkMode string `json:"networkMode,omitempty"`
	Known       bool   `json:"known"`
	Active      bool   `json:"active"`
	// Rescue marks the VibeTV on the Cable whose firmware predates USB-C:
	// only the Cable rescue update can bring it to current.
	Rescue bool `json:"rescue,omitempty"`
}

func (s *Server) handleDeviceDiscover(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	s.repairMu.Lock()
	defer s.repairMu.Unlock()
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if strings.TrimSpace(req.Target) == "" &&
		strings.TrimSpace(cfg.DeviceID) == "" &&
		s.ambiguousDeviceSelectionPending() {
		writeDiscoveryError(w, &multipleDevicesError{})
		return
	}
	discoveryCfg := cfg
	discoveryCfg.DeviceToken = ""
	target, hello, err := s.discover(r.Context(), discoveryCfg, req.Target)
	if err != nil {
		var multiple *multipleDevicesError
		if errors.As(err, &multiple) {
			s.markAmbiguousDeviceSelection()
		}
		writeDiscoveryError(w, err)
		return
	}
	cfg, err = s.updateConfig(func(current *runtimeconfig.Config) {
		current.DeviceTarget = target
	})
	if err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK     bool       `json:"ok"`
		Device deviceInfo `json:"device"`
	}{OK: true, Device: s.withDisplayStream(r.Context(), target, deviceFromHello(target, cfg.DeviceToken, hello))})
}

// handleDeviceSearch performs a read-only scan. Unlike the legacy discover
// action it intentionally does not select a target, pair, or persist config.
func (s *Server) handleDeviceSearch(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		Target string `json:"target"`
	}
	if !decodeOptionalJSON(w, r, &req) {
		return
	}
	cfg, err := s.config()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	explicitTarget := strings.TrimSpace(req.Target)
	var cableDevices []usb.CableDevice
	var cableErr error
	searchCtx, cancelSearch := context.WithTimeout(r.Context(), deviceSearchWindow)
	defer cancelSearch()
	var devices []deviceSearchEntry
	if explicitTarget == "" && !cfg.WiFiTransitionPending() && s.discoverCableDevices != nil {
		s.firmwareUpdateStartMu.Lock()
		if _, running := s.activeFirmwareUpdateJob(); running {
			s.firmwareUpdateStartMu.Unlock()
			writeError(w, http.StatusConflict, "firmware_update_in_progress", "VibeTV update is still running.", "Wait for the update to finish, then search again.")
			return
		}
		// LAN and serial discovery share one deadline. Otherwise a silent
		// adapter consumes the budget before WiFi devices are even probed.
		lanDone := make(chan struct{})
		cableFound := make(chan struct{})
		go func() {
			defer close(lanDone)
			devices, err = s.searchDevicesUntilCable(searchCtx, cfg, explicitTarget, cableFound)
		}()
		cableDevices, cableErr = s.discoverCableDevices(searchCtx)
		s.firmwareUpdateStartMu.Unlock()
		if len(cableDevices) > 0 {
			close(cableFound)
		}
		<-lanDone
	} else {
		devices, err = s.searchDevices(searchCtx, cfg, explicitTarget)
	}
	// Issue #818: a rescue write that failed after the erase leaves a VibeTV
	// that boot-loops and says no hello, so no search finds it. The rescue
	// marker keeps it selectable for the next rescue, also when the LAN search
	// failed: the rescue runs over the Cable only.
	var rescueEntry *deviceSearchEntry
	if explicitTarget == "" {
		if entry, ok := s.halfWrittenRescueEntry(cableDevices); ok {
			rescueEntry = &entry
		}
	}
	// A pre-Cable VibeTV that answered for its first rescue is reached over the
	// Cable only, like the marked one: the LAN error must not hide it (Codex
	// review on #819).
	var legacyAnswered *usb.LegacyCableFirmwareError
	legacyOnCable := explicitTarget == "" && errors.As(cableErr, &legacyAnswered)
	if err != nil && len(cableDevices) == 0 && rescueEntry == nil && !legacyOnCable {
		var invalidTarget *invalidTargetError
		if errors.As(err, &invalidTarget) {
			writeInvalidDeviceTarget(w)
			return
		}
		if errors.Is(err, errLocalNetworkAccessDenied) {
			writeError(
				w,
				http.StatusForbidden,
				"local_network_access_denied",
				"Local Network access is off for VibeTV Control Center.",
				"Open System Settings > Privacy & Security > Local Network, allow VibeTV Control Center, then try again.",
			)
			return
		}
		if errors.Is(err, errNoLocalNetwork) {
			writeError(
				w,
				http.StatusServiceUnavailable,
				"network_unavailable",
				"This Mac isn't connected to a WiFi network.",
				"Turn on WiFi and connect this Mac to the WiFi your VibeTV uses, then search again.",
			)
			return
		}
		writeInternalError(w, err)
		return
	}
	if explicitTarget == "" {
		if cableErr != nil && len(devices) == 0 {
			switch errcode.Of(cableErr) {
			case errcode.TransportForeignDevice, errcode.TransportCableFirmwareTooOld:
				writeCableResolutionError(w, cableErr)
				return
			}
		}
		// Firmware from before USB-C sends no deviceId over the Cable. One
		// VibeTV reports the same board and firmware on both transports, so a
		// WiFi VibeTV that differs in either is another VibeTV. One that matches
		// both may be this one: WiFi wins as before instead of a duplicate, and
		// updating it lets the next search tell the two apart.
		// A pending rescue marker wins over another pre-Cable VibeTV, exactly as
		// install-update does, so the entry shown is the hardware the rescue
		// writes to (Codex review on #819).
		var legacy *usb.LegacyCableFirmwareError
		if rescueEntry != nil {
			devices = append(devices, *rescueEntry)
		} else if errors.As(cableErr, &legacy) && !slices.ContainsFunc(devices, func(device deviceSearchEntry) bool {
			return device.Board == legacy.Board && device.Firmware == legacy.Firmware
		}) {
			devices = append(devices, legacyCableSearchEntry(legacy))
		}
		for _, cable := range cableDevices {
			hello := cable.Hello.Normalize()
			devices = append(devices, deviceSearchEntry{
				Target:      cableDeviceTarget,
				Transport:   "cable",
				NetworkMode: hello.NetworkMode,
				DeviceID:    hello.DeviceID,
				Board:       hello.Board,
				Firmware:    hello.Firmware,
				Known:       deviceIdentityIsKnown(cfg, hello),
				Active: runtimeconfig.NormalizeConnectionMode(cfg.ConnectionMode) == "cable" &&
					deviceIdentityMatches(cfg, hello),
			})
		}
		devices = sortedDeviceSearchEntriesFromSlice(devices)
	}
	if strings.TrimSpace(req.Target) == "" && distinctDeviceSearchCount(devices) > 1 {
		s.markAmbiguousDeviceSelection()
	}
	if count := distinctDeviceSearchCount(devices); count == 0 {
		s.recordSetupEvent(setupEvent{Stage: "device_search", Status: "failed", Message: "No VibeTV found.", Code: "vibetv_not_found", NextAction: "Keep VibeTV powered on and on the same WiFi as this computer, then search again."})
	} else if count == 1 {
		s.recordSetupEvent(setupEvent{Stage: "device_search", Status: "succeeded", Message: "Found 1 VibeTV."})
	} else {
		s.recordSetupEvent(setupEvent{Stage: "device_search", Status: "succeeded", Message: fmt.Sprintf("Found %d VibeTVs.", count)})
	}
	writeJSON(w, http.StatusOK, struct {
		OK      bool                `json:"ok"`
		Devices []deviceSearchEntry `json:"devices"`
	}{OK: true, Devices: devices})
}

func (s *Server) discover(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) (string, protocol.DeviceHello, error) {
	explicitTarget = strings.TrimSpace(explicitTarget)
	var lastErr error
	expectedDeviceID := ""
	if explicitTarget == "" {
		expectedDeviceID = strings.TrimSpace(cfg.DeviceID)
	}
	if explicitTarget != "" {
		target, targetErr := normalizeExplicitDeviceTarget(explicitTarget)
		if targetErr != nil {
			return "", protocol.DeviceHello{}, targetErr
		}
		hello, err := s.getHelloProbe(ctx, target, cfg.DeviceToken, discoveryProbeTime)
		if err != nil {
			return "", protocol.DeviceHello{}, err
		} else if !deviceIDMatchesExpected(hello, expectedDeviceID) {
			return "", protocol.DeviceHello{}, errDeviceIdentityChanged
		} else {
			if err := s.confirmPendingWiFiTransition(
				ctx, target, cfg.DeviceToken, cfg.DeviceID, hello,
			); err != nil {
				return "", protocol.DeviceHello{}, err
			}
			return target, hello, nil
		}
	} else {
		candidates := uniqueStrings(cfg.DeviceTarget, s.configuredDefaultWiFiTarget())
		for _, candidate := range candidates {
			hello, err := s.getHelloProbe(ctx, candidate, cfg.DeviceToken, discoveryProbeTime)
			if err == nil {
				if !deviceIDMatchesExpected(hello, expectedDeviceID) {
					lastErr = errDeviceIdentityChanged
					continue
				}
				if err := s.confirmPendingWiFiTransition(
					ctx, candidate, cfg.DeviceToken, cfg.DeviceID, hello,
				); err != nil {
					lastErr = err
					continue
				}
				return normalizeTarget(candidate), hello, nil
			}
			lastErr = err
		}
	}
	if target, hello, err := s.discoverSubnet(ctx, cfg); err == nil {
		if err := s.confirmPendingWiFiTransition(
			ctx, target, cfg.DeviceToken, cfg.DeviceID, hello,
		); err != nil {
			return "", protocol.DeviceHello{}, err
		}
		return target, hello, nil
	} else if err != nil {
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no device candidates")
	}
	return "", protocol.DeviceHello{}, lastErr
}

func (s *Server) discoverSubnet(ctx context.Context, cfg runtimeconfig.Config) (string, protocol.DeviceHello, error) {
	if s.subnetTargets == nil {
		return "", protocol.DeviceHello{}, errors.New("subnet discovery unavailable")
	}
	candidates := uniqueStrings(s.subnetTargets()...)
	if len(candidates) == 0 {
		return "", protocol.DeviceHello{}, errors.New("no subnet candidates")
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := s.probeCandidates(ctx, candidates, cfg.DeviceToken)

	var lastErr error
	var matches []candidateProbeResult
	for res := range results {
		if res.err == nil {
			res.target = normalizeTarget(res.target)
			if !deviceIDMatchesExpected(res.hello, cfg.DeviceID) {
				lastErr = errDeviceIdentityChanged
				continue
			}
			matches = append(matches, res)
			if len(matches) > 1 {
				cancel()
				targets := make([]string, 0, len(matches))
				for _, match := range matches {
					targets = append(targets, match.target)
				}
				sort.Strings(targets)
				return "", protocol.DeviceHello{}, &multipleDevicesError{targets: targets}
			}
			continue
		}
		lastErr = res.err
	}
	if len(matches) == 1 {
		return matches[0].target, matches[0].hello, nil
	}
	if lastErr == nil {
		lastErr = errors.New("subnet discovery found no device")
	}
	return "", protocol.DeviceHello{}, lastErr
}

type candidateProbeResult struct {
	target  string
	hello   protocol.DeviceHello
	err     error
	elapsed time.Duration
}

// probeCandidates probes every candidate through GET /hello with at most
// subnetProbeLimit probes in flight. The channel closes once all probes are
// done or ctx is cancelled; the caller owns ctx and cancels it to stop early.
func (s *Server) probeCandidates(ctx context.Context, candidates []string, token string) <-chan candidateProbeResult {
	workers := subnetProbeLimit
	if len(candidates) < workers {
		workers = len(candidates)
	}
	jobs := make(chan string)
	results := make(chan candidateProbeResult, len(candidates))
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for candidate := range jobs {
				started := time.Now()
				hello, err := s.getHelloProbe(ctx, candidate, token, subnetProbeTime)
				select {
				case results <- candidateProbeResult{target: candidate, hello: hello, err: err, elapsed: time.Since(started)}:
				case <-ctx.Done():
					return
				}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, candidate := range candidates {
			select {
			case jobs <- candidate:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()
	return results
}

func (s *Server) searchDevices(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) ([]deviceSearchEntry, error) {
	return s.searchDevicesUntilCable(ctx, cfg, explicitTarget, nil)
}

func (s *Server) searchDevicesUntilCable(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string, cableFound <-chan struct{}) ([]deviceSearchEntry, error) {
	explicitTarget = strings.TrimSpace(explicitTarget)
	if explicitTarget != "" {
		normalized, err := normalizeExplicitDeviceTarget(explicitTarget)
		if err != nil {
			return nil, err
		}
		// Manual entry is a deterministic fallback, not another LAN scan. Probe
		// exactly the customer-provided address once through GET /hello.
		return s.searchDevicesOnce(ctx, cfg, normalized)
	}

	searchCtx, cancel := context.WithTimeout(ctx, deviceSearchWindow)
	defer cancel()

	byIdentity := make(map[string]deviceSearchEntry)
	hasSavedIdentity := strings.TrimSpace(cfg.DeviceID) != ""
	freshResultSeen := false
	for {
		foundKnown := false
		entries, err := s.searchDevicesOnce(searchCtx, cfg, explicitTarget)
		if err != nil {
			return sortedDeviceSearchEntries(byIdentity), err
		}
		for _, entry := range entries {
			key := deviceSearchIdentityKey(entry)
			if prior, ok := byIdentity[key]; !ok || (!prior.Known && entry.Known) {
				byIdentity[key] = entry
			}
			if entry.Known {
				foundKnown = true
			}
		}
		// A Cable answer settles discovery after at least one complete LAN
		// sweep; do not cancel that sweep and lose selectable WiFi devices.
		select {
		case <-cableFound:
			return sortedDeviceSearchEntries(byIdentity), nil
		default:
		}
		// A clean customer install has no saved identity to prefer, so settle one
		// additional full scan after the first result and merge both snapshots.
		// Recovery with a saved identity keeps returning as soon as that known
		// device answers.
		if foundKnown || (!hasSavedIdentity && freshResultSeen) {
			return sortedDeviceSearchEntries(byIdentity), nil
		}
		if !hasSavedIdentity && len(byIdentity) > 0 {
			freshResultSeen = true
		}
		if searchCtx.Err() != nil {
			break
		}
		select {
		case <-searchCtx.Done():
			return sortedDeviceSearchEntries(byIdentity), nil
		case <-cableFound:
			return sortedDeviceSearchEntries(byIdentity), nil
		case <-time.After(repairDiscoveryRetryGap):
		}
	}
	return sortedDeviceSearchEntries(byIdentity), nil
}

func (s *Server) markAmbiguousDeviceSelection() {
	s.deviceSelectionMu.Lock()
	defer s.deviceSelectionMu.Unlock()
	s.ambiguousDeviceSeen = true
}

func (s *Server) clearAmbiguousDeviceSelection() {
	s.deviceSelectionMu.Lock()
	defer s.deviceSelectionMu.Unlock()
	s.ambiguousDeviceSeen = false
}

func (s *Server) ambiguousDeviceSelectionPending() bool {
	s.deviceSelectionMu.Lock()
	defer s.deviceSelectionMu.Unlock()
	return s.ambiguousDeviceSeen
}

func distinctDeviceSearchCount(devices []deviceSearchEntry) int {
	seen := make(map[string]struct{}, len(devices))
	for _, device := range devices {
		key := deviceSearchIdentityKey(device)
		if key == "" {
			continue
		}
		seen[key] = struct{}{}
	}
	return len(seen)
}

func (s *Server) searchDevicesOnce(ctx context.Context, cfg runtimeconfig.Config, explicitTarget string) ([]deviceSearchEntry, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	candidates := []string{}
	if explicitTarget != "" {
		target, err := normalizeExplicitDeviceTarget(explicitTarget)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, target)
	} else {
		// Probe every remembered VibeTV before the subnet fan-out. This keeps known
		// devices fast, including the case where more than one saved VibeTV is online.
		candidates = append(candidates, cfg.DeviceTarget)
		for _, known := range cfg.KnownDevices {
			candidates = append(candidates, known.Target)
		}
		candidates = append(candidates, s.configuredDefaultWiFiTarget())
		if s.subnetTargets != nil {
			candidates = append(candidates, s.subnetTargets()...)
		}
	}
	candidates = uniqueStrings(candidates...)
	// A loopback target (the Virtual VibeTV) needs no WiFi, so it keeps the
	// scan alive; everything else is unreachable without a network.
	if explicitTarget == "" &&
		s.localNetworkAvailable != nil && !s.localNetworkAvailable() &&
		!anyLoopbackTarget(candidates) {
		return nil, errNoLocalNetwork
	}
	if len(candidates) == 0 {
		return []deviceSearchEntry{}, nil
	}

	results := s.probeCandidates(ctx, candidates, "")

	byIdentity := make(map[string]deviceSearchEntry)
	probeResults := 0
	possibleDeniedResults := 0
	for found := range results {
		probeResults++
		if found.err != nil {
			if localNetworkPermissionError(found.err) {
				return nil, errLocalNetworkAccessDenied
			}
			if possibleLocalNetworkPermissionError(
				found.err,
				localNetworkPermissionGOOS,
				found.elapsed,
			) {
				possibleDeniedResults++
			}
			continue
		}
		hello := found.hello.Normalize()
		if hello.NetworkMode == "setup" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(hello.DeviceID))
		if key == "" {
			key = strings.ToLower(publicTarget(normalizeTarget(found.target)))
		}
		entry := deviceSearchEntry{
			Target:      publicTarget(normalizeTarget(found.target)),
			Transport:   "wifi",
			DeviceID:    hello.DeviceID,
			Board:       hello.Board,
			Firmware:    hello.Firmware,
			NetworkMode: hello.NetworkMode,
			Known:       deviceIdentityIsKnown(cfg, hello),
			Active:      deviceIdentityMatches(cfg, hello),
		}
		// A transport switch already has an explicit device choice. Do not wait
		// for unrelated addresses once that exact device answers over WiFi.
		if cfg.WiFiTransitionPending() && deviceIDMatchesExpected(hello, cfg.DeviceID) {
			return []deviceSearchEntry{entry}, nil
		}
		if prior, ok := byIdentity[key]; !ok || (!prior.Known && entry.Known) {
			byIdentity[key] = entry
		}
	}
	if localNetworkPermissionDeniedByProbeErrors(
		probeResults,
		possibleDeniedResults,
	) {
		return nil, errLocalNetworkAccessDenied
	}
	devices := make([]deviceSearchEntry, 0, len(byIdentity))
	for _, entry := range byIdentity {
		devices = append(devices, entry)
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Active != devices[j].Active {
			return devices[i].Active
		}
		if devices[i].Known != devices[j].Known {
			return devices[i].Known
		}
		return devices[i].Target < devices[j].Target
	})
	return devices, nil
}

func localNetworkPermissionError(err error) bool {
	if errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) {
		return true
	}
	detail := strings.ToLower(err.Error())
	return strings.Contains(detail, "local network prohibited") ||
		strings.Contains(detail, "local network denied")
}

func possibleLocalNetworkPermissionError(err error, goos string, elapsed time.Duration) bool {
	return goos == "darwin" &&
		errors.Is(err, syscall.EHOSTUNREACH) &&
		elapsed <= localNetworkDenialProbeMaxElapsed
}

func localNetworkPermissionDeniedByProbeErrors(total, possibleDenied int) bool {
	return total >= localNetworkDenialMinimumSamples &&
		possibleDenied == total
}

func deviceSearchIdentityKey(entry deviceSearchEntry) string {
	key := strings.ToLower(strings.TrimSpace(entry.DeviceID))
	if key == "" {
		key = strings.ToLower(publicTarget(entry.Target))
	}
	return key
}

func (s *Server) configuredDefaultWiFiTarget() string {
	if s.defaultWiFiTarget != nil {
		return s.defaultWiFiTarget()
	}
	return setup.DefaultWiFiTarget()
}

func sortedDeviceSearchEntries(byIdentity map[string]deviceSearchEntry) []deviceSearchEntry {
	devices := make([]deviceSearchEntry, 0, len(byIdentity))
	for _, entry := range byIdentity {
		devices = append(devices, entry)
	}
	return sortedDeviceSearchEntriesFromSlice(devices)
}

func sortedDeviceSearchEntriesFromSlice(devices []deviceSearchEntry) []deviceSearchEntry {
	sort.SliceStable(devices, func(i, j int) bool {
		if devices[i].Transport != devices[j].Transport {
			return devices[i].Transport == "cable"
		}
		if devices[i].Active != devices[j].Active {
			return devices[i].Active
		}
		if devices[i].Known != devices[j].Known {
			return devices[i].Known
		}
		return devices[i].Target < devices[j].Target
	})
	return devices
}

func deviceIdentityMatches(cfg runtimeconfig.Config, hello protocol.DeviceHello) bool {
	wantID := strings.TrimSpace(cfg.DeviceID)
	gotID := strings.TrimSpace(hello.DeviceID)
	return wantID != "" && gotID != "" && strings.EqualFold(wantID, gotID)
}

func deviceIDMatchesExpected(hello protocol.DeviceHello, expectedDeviceID string) bool {
	expectedDeviceID = strings.TrimSpace(expectedDeviceID)
	if expectedDeviceID == "" {
		return true
	}
	gotID := strings.TrimSpace(hello.DeviceID)
	return gotID != "" && strings.EqualFold(expectedDeviceID, gotID)
}

func deviceIdentityIsKnown(cfg runtimeconfig.Config, hello protocol.DeviceHello) bool {
	deviceID := strings.TrimSpace(hello.DeviceID)
	if deviceID == "" {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(cfg.DeviceID), deviceID) {
		return true
	}
	_, ok := cfg.KnownDevice(deviceID)
	return ok
}

func writeDiscoveryError(w http.ResponseWriter, err error) {
	var invalidTarget *invalidTargetError
	if errors.As(err, &invalidTarget) {
		writeInvalidDeviceTarget(w)
		return
	}
	var multiple *multipleDevicesError
	if errors.As(err, &multiple) {
		writeError(
			w,
			http.StatusConflict,
			"multiple_devices_found",
			"Multiple VibeTV devices were found.",
			"Enter the IP address shown on the VibeTV screen, then search again.",
		)
		return
	}
	writeDeviceNotFound(w)
}

// hostHasUsableNetwork reports whether this Mac holds any address a network
// conversation could use. WiFi off (and nothing else connected) leaves only
// loopback and link-local self-assignments. Broader than the subnet fan-out's
// question on purpose: an unusual but connected network must not claim WiFi
// is off, it just searches like today.
func hostHasUsableNetwork() bool {
	interfaces, err := net.Interfaces()
	if err != nil {
		// Not knowing is not "offline": let the search try.
		return true
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch value := addr.(type) {
			case *net.IPNet:
				ip = value.IP
			case *net.IPAddr:
				ip = value.IP
			}
			if ip != nil && ip.IsGlobalUnicast() {
				return true
			}
		}
	}
	return false
}

func anyLoopbackTarget(targets []string) bool {
	for _, target := range targets {
		parsed, err := url.Parse(strings.TrimSpace(target))
		if err != nil {
			continue
		}
		host := parsed.Hostname()
		if strings.EqualFold(host, "localhost") {
			return true
		}
		if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
			return true
		}
	}
	return false
}

func localSubnetTargets() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var addrs []net.Addr
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		interfaceAddrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		addrs = append(addrs, interfaceAddrs...)
	}
	return localSubnetTargetsFromAddrs(addrs)
}

func localSubnetTargetsFromAddrs(addrs []net.Addr) []string {
	var targets []string
	seen := make(map[string]struct{})
	for _, addr := range addrs {
		ip, network, ok := addrToIPv4(addr)
		if !ok {
			continue
		}
		mask := net.CIDRMask(24, 32)
		if network != nil {
			if ones, bits := network.Mask.Size(); bits == 32 && ones >= 8 {
				// A full /16 contains more hosts than the bounded customer search
				// can truthfully probe. Scan at most the Mac's surrounding /23:
				// this still covers an adjacent /24 and every generated target fits
				// comfortably inside the 30-second search window.
				if ones < maxSubnetDiscoveryPrefix {
					mask = net.CIDRMask(maxSubnetDiscoveryPrefix, 32)
				} else {
					mask = network.Mask
				}
			}
		}
		networkIP := ip.Mask(mask).To4()
		if networkIP == nil {
			continue
		}
		networkValue := ipv4Uint32(networkIP)
		hostValue := ipv4Uint32(ip)
		maskValue := ipv4Uint32(net.IP(mask).To4())
		broadcastValue := networkValue | ^maskValue
		if hostValue <= networkValue || hostValue >= broadcastValue {
			continue
		}
		lowerHosts := hostValue - networkValue - 1
		upperHosts := broadcastValue - hostValue - 1
		for offset := uint32(1); (offset <= lowerHosts || offset <= upperHosts) && len(targets) < maxSubnetDiscoveryTargets; offset++ {
			if offset <= lowerHosts {
				candidate := hostValue - offset
				target := "http://" + uint32IPv4(candidate).String()
				if _, exists := seen[target]; !exists {
					seen[target] = struct{}{}
					targets = append(targets, target)
				}
			}
			if offset <= upperHosts && len(targets) < maxSubnetDiscoveryTargets {
				candidate := hostValue + offset
				target := "http://" + uint32IPv4(candidate).String()
				if _, exists := seen[target]; !exists {
					seen[target] = struct{}{}
					targets = append(targets, target)
				}
			}
		}
		if len(targets) >= maxSubnetDiscoveryTargets {
			break
		}
	}
	return targets
}

func ipv4Uint32(ip net.IP) uint32 {
	ip = ip.To4()
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
}

func uint32IPv4(value uint32) net.IP {
	return net.IPv4(byte(value>>24), byte(value>>16), byte(value>>8), byte(value))
}

func addrToIPv4(addr net.Addr) (net.IP, *net.IPNet, bool) {
	var ip net.IP
	var network *net.IPNet
	switch value := addr.(type) {
	case *net.IPNet:
		ip = value.IP
		network = value
	case *net.IPAddr:
		ip = value.IP
	default:
		return nil, nil, false
	}
	ip = ip.To4()
	if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || !ip.IsPrivate() {
		return nil, nil, false
	}
	return ip, network, true
}
