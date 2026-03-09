package usb

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
)

func readHelloFromPort(port SerialPort, window time.Duration) (protocol.DeviceHello, bool) {
	if port == nil {
		return protocol.DeviceHello{}, false
	}
	if window <= 0 {
		return protocol.DeviceHello{}, false
	}

	_ = port.SetReadTimeout(helloReadStepTimeout)

	deadline := time.Now().Add(window)
	chunk := make([]byte, 128)
	buffer := make([]byte, 0, helloReadBufferBytes)

	for time.Now().Before(deadline) {
		n, err := port.Read(chunk)
		if err != nil {
			continue
		}
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
			line := bytes.TrimSpace(buffer[:idx])
			buffer = buffer[idx+1:]

			if hello, ok := parseDeviceHelloLine(string(line)); ok {
				return hello, true
			}
		}
	}

	line := strings.TrimSpace(string(bytes.TrimSpace(buffer)))
	if hello, ok := parseDeviceHelloLine(line); ok {
		return hello, true
	}

	return protocol.DeviceHello{}, false
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
