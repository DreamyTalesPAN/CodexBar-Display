package usb

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func readHelloFromPort(port SerialPort, window time.Duration) (protocol.DeviceHello, bool) {
	var hello protocol.DeviceHello
	seen := readPortLines(port, window, func(line string) bool {
		var ok bool
		hello, ok = parseDeviceHelloLine(line)
		return ok
	})
	return hello, seen
}

func readConnectionModeConfirmationFromPort(port SerialPort, window time.Duration, deviceID string) error {
	var responseErr error
	seen := readPortLines(port, window, func(line string) bool {
		if !strings.HasPrefix(strings.TrimSpace(line), "{") {
			return false
		}
		var reply struct {
			Kind     string `json:"kind"`
			Status   string `json:"status"`
			DeviceID string `json:"deviceId"`
			Mode     string `json:"mode"`
			Code     string `json:"code"`
			Message  string `json:"message"`
		}
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			return false
		}
		switch strings.TrimSpace(reply.Kind) {
		case "error":
			responseErr = fmt.Errorf("device rejected confirmation: %s: %s", strings.TrimSpace(reply.Code), strings.TrimSpace(reply.Message))
			return true
		case "connection-mode":
			if !strings.EqualFold(strings.TrimSpace(reply.DeviceID), strings.TrimSpace(deviceID)) ||
				!strings.EqualFold(strings.TrimSpace(reply.Mode), "cable") {
				responseErr = fmt.Errorf("device acknowledged a different identity or mode")
				return true
			}
			status := strings.ToLower(strings.TrimSpace(reply.Status))
			if status != "confirmed" && status != "stable" {
				responseErr = fmt.Errorf("device returned unexpected confirmation status %q", reply.Status)
			}
			return true
		default:
			return false
		}
	})
	if responseErr != nil {
		return responseErr
	}
	if !seen {
		return fmt.Errorf("device did not acknowledge Cable mode confirmation")
	}
	return nil
}

func readConnectionModeSwitchFromPort(port SerialPort, window time.Duration, deviceID, mode string) error {
	var responseErr error
	seen := readPortLines(port, window, func(line string) bool {
		if !strings.HasPrefix(strings.TrimSpace(line), "{") {
			return false
		}
		var reply struct {
			Kind     string `json:"kind"`
			Status   string `json:"status"`
			DeviceID string `json:"deviceId"`
			Mode     string `json:"mode"`
			Code     string `json:"code"`
			Message  string `json:"message"`
		}
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			return false
		}
		switch strings.TrimSpace(reply.Kind) {
		case "error":
			responseErr = fmt.Errorf("device rejected connection mode switch: %s: %s", strings.TrimSpace(reply.Code), strings.TrimSpace(reply.Message))
			return true
		case "connection-mode":
			if !strings.EqualFold(strings.TrimSpace(reply.DeviceID), strings.TrimSpace(deviceID)) ||
				!strings.EqualFold(strings.TrimSpace(reply.Mode), strings.TrimSpace(mode)) ||
				!strings.EqualFold(strings.TrimSpace(reply.Status), "switching") {
				responseErr = errors.New("device acknowledged a different identity, mode, or status")
			}
			return true
		default:
			return false
		}
	})
	if responseErr != nil {
		return responseErr
	}
	if !seen {
		return fmt.Errorf("device did not acknowledge %s mode switch", mode)
	}
	return nil
}

func readPairingFromPort(port SerialPort, window time.Duration, deviceID string) (string, error) {
	var token string
	var responseErr error
	seen := readPortLines(port, window, func(line string) bool {
		if !strings.HasPrefix(strings.TrimSpace(line), "{") {
			return false
		}
		var reply struct {
			Kind     string `json:"kind"`
			Status   string `json:"status"`
			DeviceID string `json:"deviceId"`
			Token    string `json:"token"`
			Code     string `json:"code"`
			Message  string `json:"message"`
		}
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			return false
		}
		switch strings.TrimSpace(reply.Kind) {
		case "error":
			responseErr = errors.New("device rejected Cable pairing")
			return true
		case "pairing":
			if !strings.EqualFold(strings.TrimSpace(reply.DeviceID), strings.TrimSpace(deviceID)) ||
				!strings.EqualFold(strings.TrimSpace(reply.Status), "paired") {
				responseErr = errors.New("device acknowledged Cable pairing for a different identity or status")
				return true
			}
			token = strings.TrimSpace(reply.Token)
			if !validCablePairingToken(token) {
				responseErr = errors.New("cable pairing response included an invalid token")
			}
			return true
		default:
			return false
		}
	})
	if responseErr != nil {
		return "", responseErr
	}
	if !seen {
		return "", errors.New("device did not acknowledge Cable pairing")
	}
	return token, nil
}

func validCablePairingToken(token string) bool {
	if len(token) < 16 || len(token) > 64 {
		return false
	}
	for index := 0; index < len(token); index++ {
		character := token[index]
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '-' || character == '_' {
			continue
		}
		return false
	}
	return true
}

func readSettingsFromPort(port SerialPort, window time.Duration, deviceID string) (protocol.DeviceSettings, error) {
	var settings protocol.DeviceSettings
	var responseErr error
	seen := readPortLines(port, window, func(line string) bool {
		if !strings.HasPrefix(strings.TrimSpace(line), "{") {
			return false
		}
		var reply struct {
			Kind     string                  `json:"kind"`
			DeviceID string                  `json:"deviceId"`
			Settings protocol.DeviceSettings `json:"settings"`
			Code     string                  `json:"code"`
			Message  string                  `json:"message"`
		}
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			return false
		}
		switch strings.TrimSpace(reply.Kind) {
		case "error":
			responseErr = fmt.Errorf("device rejected settings request: %s: %s", strings.TrimSpace(reply.Code), strings.TrimSpace(reply.Message))
			return true
		case "settings":
			if !strings.EqualFold(strings.TrimSpace(reply.DeviceID), strings.TrimSpace(deviceID)) {
				responseErr = errors.New("device returned settings for a different identity")
				return true
			}
			settings = reply.Settings
			return true
		default:
			return false
		}
	})
	if responseErr != nil {
		return protocol.DeviceSettings{}, responseErr
	}
	if !seen {
		return protocol.DeviceSettings{}, errors.New("device did not acknowledge settings request")
	}
	return settings, nil
}

func readPortLines(port SerialPort, window time.Duration, accept func(string) bool) bool {
	if port == nil || window <= 0 || accept == nil {
		return false
	}
	_ = port.SetReadTimeout(helloReadStepTimeout)
	deadline := time.Now().Add(window)
	chunk := make([]byte, 128)
	buffer := make([]byte, 0, helloReadBufferBytes)
	for time.Now().Before(deadline) {
		n, _ := port.Read(chunk)
		if n <= 0 {
			continue
		}
		buffer = append(buffer, chunk[:n]...)
		if len(buffer) > helloReadBufferBytes {
			buffer = buffer[len(buffer)-helloReadBufferBytes:]
		}
		for {
			idx := bytes.IndexByte(buffer, '\n')
			if idx < 0 {
				break
			}
			line := strings.TrimSpace(string(bytes.TrimSpace(buffer[:idx])))
			buffer = buffer[idx+1:]
			if accept(line) {
				return true
			}
		}
	}
	return accept(strings.TrimSpace(string(bytes.TrimSpace(buffer))))
}

func parseDeviceHelloLine(line string) (protocol.DeviceHello, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return protocol.DeviceHello{}, false
	}

	if hello, ok := parseLegacyReadyLine(line); ok {
		return hello, true
	}

	if !strings.HasPrefix(line, "{") || !strings.HasSuffix(line, "}") {
		return protocol.DeviceHello{}, false
	}

	var hello protocol.DeviceHello
	if err := json.Unmarshal([]byte(line), &hello); err != nil {
		return protocol.DeviceHello{}, false
	}
	hello = hello.Normalize()
	if hello.Kind != "hello" {
		return protocol.DeviceHello{}, false
	}
	return hello, true
}

func parseLegacyReadyLine(line string) (protocol.DeviceHello, bool) {
	switch strings.TrimSpace(line) {
	case "codexbar_display_ready_display", "codexbar_display_ready_probe", "codexbar_display_ready":
		return protocol.DeviceHello{
			Kind: "hello",
		}, true
	default:
		return protocol.DeviceHello{}, false
	}
}
