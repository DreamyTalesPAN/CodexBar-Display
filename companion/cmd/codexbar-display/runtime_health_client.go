package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

func checkDoctorCompanionHealth(expectedOwner string) error {
	return checkDoctorCompanionHealthOrigins(doctorCompanionOrigins(), expectedOwner)
}

func readLocalCableCapabilities(expectedOwner string) (protocol.DeviceCapabilities, error) {
	return readLocalCableCapabilitiesOrigins(doctorCompanionOrigins(), expectedOwner)
}

func readLocalCableCapabilitiesOrigins(origins []string, expectedOwner string) (protocol.DeviceCapabilities, error) {
	client := &http.Client{Timeout: 3 * time.Second}
	var lastErr error
	for _, origin := range origins {
		response, err := client.Get(strings.TrimRight(origin, "/") + "/v1/status")
		if err != nil {
			lastErr = err
			continue
		}
		var result struct {
			OK        bool `json:"ok"`
			Companion struct {
				Runtime struct {
					ListenerOwner string `json:"listenerOwner"`
				} `json:"runtime"`
			} `json:"companion"`
			Device struct {
				DeviceID        string                    `json:"deviceId"`
				Connected       bool                      `json:"connected"`
				ConnectionState string                    `json:"connectionState"`
				NetworkMode     string                    `json:"networkMode"`
				Board           string                    `json:"board"`
				Firmware        string                    `json:"firmware"`
				Capabilities    *protocol.CapabilityBlock `json:"capabilities"`
			} `json:"device"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&result)
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d", response.StatusCode)
			continue
		}
		if decodeErr != nil {
			lastErr = decodeErr
			continue
		}
		if !result.OK {
			lastErr = errors.New("companion status reported not ok")
			continue
		}
		owner := strings.TrimSpace(result.Companion.Runtime.ListenerOwner)
		if owner == "" && expectedOwner != "" && expectedOwner != runtimepaths.LegacyDisplayStreamLaunchAgentLabel {
			lastErr = errors.New("companion status did not identify its listener owner")
			continue
		}
		if owner != "" && expectedOwner != "" && owner != expectedOwner {
			lastErr = fmt.Errorf("companion status belongs to %q, expected %q", owner, expectedOwner)
			continue
		}
		if !result.Device.Connected {
			lastErr = errors.New("companion status reported Cable disconnected")
			continue
		}
		// "reconnecting" is the Companion's anti-flap grace window: connected
		// and capabilities are cached, not live proof of an attached Cable.
		if result.Device.ConnectionState == "reconnecting" {
			lastErr = errors.New("companion status reported Cable reconnecting")
			continue
		}
		if result.Device.Capabilities == nil {
			lastErr = errors.New("companion status did not provide Cable capabilities")
			continue
		}
		caps := protocol.CapabilitiesFromHello(protocol.DeviceHello{
			Kind:         "hello",
			DeviceID:     result.Device.DeviceID,
			NetworkMode:  result.Device.NetworkMode,
			Board:        result.Device.Board,
			Firmware:     result.Device.Firmware,
			Capabilities: *result.Device.Capabilities,
		})
		if strings.TrimSpace(caps.DeviceID) == "" {
			lastErr = errors.New("companion status did not provide a Cable device identity")
			continue
		}
		if !caps.Known {
			lastErr = errors.New("companion status reported unknown Cable capabilities")
			continue
		}
		if !strings.EqualFold(caps.ActiveTransport, "usb") || !strings.EqualFold(caps.ConnectionMode, "cable") {
			lastErr = fmt.Errorf("companion status reported transport active=%q mode=%q", caps.ActiveTransport, caps.ConnectionMode)
			continue
		}
		return caps, nil
	}
	if lastErr == nil {
		lastErr = errors.New("companion status unavailable")
	}
	return protocol.DeviceCapabilities{}, lastErr
}

func checkDoctorCompanionHealthOrigins(origins []string, expectedOwner string) error {
	return forEachOwnedRuntimeOrigin(origins, expectedOwner, func(string) error { return nil })
}

// claimRuntimeUpdateHold asks the runtime owned by label for the update hold
// the shell's repair path claims (main.rs claim_update_hold). A runtime that
// does not answer is not running a job -- the job lives in that process -- so
// only a refusal (409) or a failed request to an identified runtime blocks.
func claimRuntimeUpdateHold(home, label string) error {
	return claimRuntimeUpdateHoldAt(runtimeHealthOrigins(home), label)
}

func claimRuntimeUpdateHoldAt(origins []string, label string) error {
	client := &http.Client{Timeout: 3 * time.Second}
	identified := false
	err := forEachOwnedRuntimeOrigin(origins, label, func(origin string) error {
		identified = true
		response, err := client.Post(strings.TrimRight(origin, "/")+"/v1/runtime-health/update-hold", "application/json", strings.NewReader("{}"))
		if err != nil {
			return fmt.Errorf("runtime update hold request failed: %w", err)
		}
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4<<10))
		_ = response.Body.Close()
		switch {
		case response.StatusCode == http.StatusConflict:
			return fmt.Errorf("a VibeTV update or theme install is still running; try again when it has finished (%s)", strings.TrimSpace(string(body)))
		case response.StatusCode < 200 || response.StatusCode >= 300:
			return fmt.Errorf("runtime update hold refused with HTTP %d", response.StatusCode)
		}
		return nil
	})
	if !identified {
		return nil
	}
	return err
}

// forEachOwnedRuntimeOrigin runs then against the first origin whose
// runtime-health identifies a healthy runtime owned by expectedOwner. The
// health probing is checkDoctorCompanionHealth's; when no origin answers, the
// last probe error is returned.
func forEachOwnedRuntimeOrigin(origins []string, expectedOwner string, then func(origin string) error) error {
	client := &http.Client{Timeout: 3 * time.Second}
	var lastErr error
	for _, origin := range origins {
		response, err := client.Get(strings.TrimRight(origin, "/") + "/v1/runtime-health")
		if err != nil {
			lastErr = err
			continue
		}
		var result struct {
			OK            bool  `json:"ok"`
			DisplayWriter *bool `json:"displayWriter"`
			Companion     struct {
				Runtime struct {
					ListenerOwner string `json:"listenerOwner"`
				} `json:"runtime"`
			} `json:"companion"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&result)
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d", response.StatusCode)
			continue
		}
		if decodeErr != nil {
			lastErr = decodeErr
			continue
		}
		if !result.OK {
			lastErr = errors.New("runtime health reported not ok")
			continue
		}
		if result.DisplayWriter != nil && !*result.DisplayWriter {
			lastErr = errors.New("runtime health reported no display writer")
			continue
		}
		owner := strings.TrimSpace(result.Companion.Runtime.ListenerOwner)
		if owner == "" && expectedOwner != "" && expectedOwner != runtimepaths.LegacyDisplayStreamLaunchAgentLabel {
			lastErr = errors.New("runtime health did not identify its listener owner")
			continue
		}
		if owner != "" && expectedOwner != "" && owner != expectedOwner {
			lastErr = fmt.Errorf("runtime health belongs to %q, expected %q", owner, expectedOwner)
			continue
		}
		return then(origin)
	}
	return lastErr
}
