package transport

import (
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type USBTransport struct{}

func NewUSBTransport() DeviceTransport {
	return USBTransport{}
}

func (USBTransport) ResolvePort(requested string) (string, error) {
	return usb.ResolvePort(requested)
}

func (USBTransport) DeviceCapabilities(port string) (protocol.DeviceCapabilities, error) {
	return usb.GetDeviceCapabilities(port)
}

func (USBTransport) SendLine(port string, line []byte) error {
	return usb.SendLine(port, line)
}
