package transport

import "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"

// DeviceTransport is transport-channel agnostic (USB now, future WiFi/Cloud channels).
type DeviceTransport interface {
	ResolvePort(requested string) (string, error)
	DeviceCapabilities(port string) (protocol.DeviceCapabilities, error)
	SendLine(port string, line []byte) error
}
