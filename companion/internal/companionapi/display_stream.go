package companionapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/service"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/setup"
)

var printDisplayStreamService = func(ctx context.Context, label string) ([]byte, error) {
	status, err := service.New(label, "", false).Status(ctx)
	return []byte(status.DiagnosticOutput()), err
}

type displayStreamInfo struct {
	DeviceID   string `json:"deviceId,omitempty"`
	Healthy    bool   `json:"healthy"`
	Running    bool   `json:"running"`
	LastSentAt string `json:"lastSentAt,omitempty"`
	// LastProviderID is the provider of the last frame sent. A Two at once pair
	// reports its top member.
	LastProviderID string `json:"lastProviderId,omitempty"`
	Target         string `json:"target,omitempty"`
	LastTarget     string `json:"lastTarget,omitempty"`
	Detail         string `json:"detail,omitempty"`
	ErrorCode      string `json:"errorCode,omitempty"`
	// ErrorAt is when the stream last reported ErrorCode. The page compares it
	// with the end of a firmware update, so an error from before the update is
	// never taken as the stream coming back (Codex on #829).
	ErrorAt string `json:"errorAt,omitempty"`
}

func (s *Server) startDisplayStream(ctx context.Context, target string) error {
	target = strings.TrimSpace(target)
	if target == "" {
		return errors.New("device target is empty")
	}
	if s.refreshStream != nil {
		return s.refreshStream(ctx, target)
	}
	opts := setup.Options{
		Transport: "wifi",
		Target:    target,
		AssumeYes: true,
		SkipFlash: true,
	}
	if samePublicTarget(target, cableDeviceTarget) {
		opts.Transport = "usb"
		opts.Target = ""
	}
	validateOpts := opts
	validateOpts.ValidateOnly = true
	if err := s.runSetup(ctx, validateOpts); err != nil {
		return err
	}
	return s.runSetup(ctx, opts)
}

func (s *Server) withDisplayStream(ctx context.Context, target string, device deviceInfo) deviceInfo {
	return withDisplayStreamInfo(device, s.streamStatus(ctx, target))
}

func withDisplayStreamInfo(device deviceInfo, stream displayStreamInfo) deviceInfo {
	if strings.TrimSpace(stream.Target) == "" {
		stream.Target = device.Target
	}
	// All Cable devices share a transport target. Only the identity captured by
	// the worker that sent this frame can make it proof for the selected device.
	if samePublicTarget(device.Target, cableDeviceTarget) && (stream.Healthy || stream.LastSentAt != "") &&
		(stream.DeviceID == "" || !strings.EqualFold(stream.DeviceID, device.DeviceID)) {
		stream.Healthy = false
		stream.ErrorCode = "device_frame_mismatch"
		stream.Detail = "Waiting for an image from the selected VibeTV."
	}
	device.Stream = streamPointer(stream)
	if stream.ErrorCode == "device_pairing_required" {
		device.Paired = false
	}
	if !stream.Healthy && stream.ErrorCode != "provider_setup_required" {
		device.Ready = false
	}
	return device
}

func streamPointer(stream displayStreamInfo) *displayStreamInfo {
	if !stream.Healthy && !stream.Running && stream.LastSentAt == "" && stream.Target == "" && stream.LastTarget == "" && stream.Detail == "" {
		return nil
	}
	return &stream
}

func inspectDisplayStreamAfterRunning(ctx context.Context, target string, notBefore time.Time, running func() bool) displayStreamInfo {
	target = publicTarget(target)
	stream := displayStreamInfo{Target: target}
	if target == "" {
		stream.Detail = "No VibeTV target configured."
		return stream
	}

	if running != nil {
		stream.Running = running()
	} else {
		output, err := printDisplayStreamService(ctx, displayStreamLaunchAgentLabel())
		state := parseDisplayStreamLaunchState(string(output))
		stream.Running = displayStreamLaunchStateRunning(state)
		if err != nil {
			stream.Running = false
			stream.Detail = "Display stream is not loaded."
			return stream
		}
	}
	if !stream.Running {
		stream.Detail = "Display stream is not running."
		return stream
	}

	streamLog := readDisplayStreamLog(displayStreamOutLogPath())
	boundary, boundaryOK := streamLog.boundary()
	if running != nil {
		// The in-process worker always writes a session marker, including with
		// the legacy label. Frames from a previous daemon are not liveness proof.
		boundary, boundaryOK = streamLog.startMarker(displayStreamLaunchAgentLabel())
	}
	if !boundaryOK {
		stream.Detail = "Display stream is starting."
		return stream
	}
	if !notBefore.IsZero() && notBefore.After(boundary) {
		boundary = notBefore
	}
	lastSentAt, lastTarget, frameLine, frameOK := streamLog.lastFrameAfter(boundary)
	errorAt, errorDetail, errorCode, errorOK := streamLog.lastErrorAfter(boundary)
	if !frameOK || lastSentAt.IsZero() {
		if errorOK && time.Since(errorAt) <= displayStreamReadyAge {
			stream.Detail = errorDetail
			stream.ErrorCode = errorCode
			stream.ErrorAt = errorAt.UTC().Format(time.RFC3339)
			return stream
		}
		stream.Detail = "Display stream has not sent usage yet."
		return stream
	}
	stream.LastSentAt = lastSentAt.UTC().Format(time.RFC3339)
	stream.LastTarget = publicTarget(lastTarget)
	stream.DeviceID = displayStreamLogValue(frameLine, "deviceId")
	// A pair frame logs its ids joined by "+" (daemon display_limits.go); the
	// first one is the top member.
	stream.LastProviderID, _, _ = strings.Cut(displayStreamLogValue(frameLine, "provider"), "+")

	if samePublicTarget(target, cableDeviceTarget) {
		if !strings.EqualFold(displayStreamLogValue(frameLine, "transport"), "usb") {
			stream.Detail = "Display stream is using another connection mode."
			return stream
		}
		// A serial path is only a current transport endpoint, never customer
		// identity. Report the stable Cable target after the log proves USB.
		stream.LastTarget = publicTarget(cableDeviceTarget)
	} else if stream.LastTarget != "" && !samePublicTarget(target, stream.LastTarget) {
		stream.Detail = "Display stream is sending to another VibeTV."
		return stream
	}
	// A cycle that fails sends its error frame first and logs the error after
	// it. Windows' clock often stamps both with the same instant, so an error
	// at the frame's time still belongs after it.
	if errorOK && !errorAt.Before(lastSentAt) && time.Since(errorAt) <= displayStreamReadyAge {
		stream.Detail = errorDetail
		stream.ErrorCode = errorCode
		stream.ErrorAt = errorAt.UTC().Format(time.RFC3339)
		return stream
	}
	if time.Since(lastSentAt) > displayStreamReadyAge {
		stream.Detail = "Last usage frame is too old."
		return stream
	}

	stream.Healthy = true
	stream.Detail = "Display stream is sending usage frames."
	return stream
}

func (s *Server) waitForDisplayStreamMode(
	ctx context.Context,
	target string,
	notBefore time.Time,
	stopOnPairingError bool,
	waitTime time.Duration,
) displayStreamInfo {
	return waitForDisplayStreamAfterProbe(
		ctx, target, notBefore, stopOnPairingError, waitTime,
		func(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
			return inspectDisplayStreamAfterRunning(ctx, target, notBefore, s.displayStreamRunning)
		},
		func(stream displayStreamInfo) bool {
			return providerSetupStreamForTarget(&stream, target) &&
				providerSetupNeedsCustomerAction(s.providerSetupForStatus())
		},
	)
}

// providerSetupNeedsCustomerAction reports a provider state that only the
// customer can move. "checking" is not one: a provider still warming up does
// deliver usage, and the runtime sends the same no-providers error frame while
// it waits. Neither is a transient probe result -- a timeout or a momentary
// engine error also arrives as the global setup_required, but the provider
// could still deliver inside the wait window. Only the failures the reconciler
// already protects as customer-owned settle the wait, plus an engine that is
// too old: no retry inside the window can make it deliver.
func providerSetupNeedsCustomerAction(setup codexbar.ProviderSetup) bool {
	switch strings.TrimSpace(strings.ToLower(setup.Status)) {
	case "", codexbar.ProviderReady, "checking":
		return false
	}
	settles := func(status string) bool {
		status = strings.TrimSpace(strings.ToLower(status))
		return providerSetupFailureMustWin(status) || status == codexbar.ProviderEngineIncompatible
	}
	if settles(setup.Engine.Status) {
		return true
	}
	for _, provider := range setup.Providers {
		if settles(provider.Status) {
			return true
		}
	}
	return false
}

func waitForDisplayStreamAfterProbe(
	ctx context.Context,
	target string,
	notBefore time.Time,
	stopOnPairingError bool,
	waitTime time.Duration,
	inspect func(context.Context, string, time.Time) displayStreamInfo,
	settled func(displayStreamInfo) bool,
) displayStreamInfo {
	deadline := time.Now().Add(waitTime)
	var last displayStreamInfo
	for {
		last = inspect(ctx, target, notBefore)
		// A settled stream has nothing left to prove: waiting out the rest of
		// the window leaves the customer on "Installing" long after their
		// VibeTV finished, and answers with the same stream either way.
		if last.Healthy || (stopOnPairingError && last.ErrorCode == "device_pairing_required") ||
			(settled != nil && settled(last)) || time.Now().After(deadline) {
			return last
		}
		select {
		case <-ctx.Done():
			return last
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *Server) waitForFreshDisplayStream(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	return s.waitForFreshDisplayStreamUpTo(ctx, target, notBefore, displayStreamWaitTime)
}

// waitForFirmwareUpdateStream waits for the first frames after a firmware
// update. A pause during the update is not a stream failure: only a stream that
// stays missing for the whole grace period is reported as needing attention.
func (s *Server) waitForFirmwareUpdateStream(ctx context.Context, target string, notBefore time.Time) displayStreamInfo {
	return s.waitForFreshDisplayStreamUpTo(ctx, target, notBefore, firmwareStreamVerifyTime)
}

func (s *Server) waitForFreshDisplayStreamUpTo(ctx context.Context, target string, notBefore time.Time, waitTime time.Duration) displayStreamInfo {
	if s.waitStreamAfter != nil {
		return s.waitStreamAfter(ctx, target, notBefore)
	}
	if s.waitStream != nil {
		return s.waitStream(ctx, target)
	}
	return s.waitForDisplayStreamMode(ctx, target, notBefore, true, waitTime)
}

func (s *Server) waitForFreshDisplayStreamAfterPair(ctx context.Context, target string, notBefore time.Time, waitTime time.Duration) displayStreamInfo {
	if s.waitStreamAfterPair != nil {
		return s.waitStreamAfterPair(ctx, target, notBefore)
	}
	return s.waitForDisplayStreamMode(ctx, target, notBefore, false, waitTime)
}

func parseDisplayStreamLaunchState(output string) string {
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "state = ") {
			continue
		}
		return strings.TrimSpace(strings.TrimPrefix(line, "state = "))
	}
	return ""
}

func displayStreamLaunchStateRunning(state string) bool {
	switch strings.TrimSpace(state) {
	case "running", "waiting", "spawn scheduled":
		return true
	default:
		return false
	}
}

func displayStreamLaunchAgentLabel() string {
	return runtimepaths.DisplayStreamLaunchAgentLabel()
}
