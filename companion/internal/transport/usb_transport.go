package transport

import (
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/usb"
)

type USBTransport struct{}

func NewUSBTransport() DeviceTransport {
	return USBTransport{}
}

func (USBTransport) Name() string {
	return "usb"
}

func (USBTransport) ResolvePort(string) (string, error) {
	return usb.ResolveVibeTVPort("", "")
}

func (USBTransport) DeviceCapabilities(port string) (protocol.DeviceCapabilities, error) {
	return usb.GetDeviceCapabilities(port)
}

func (USBTransport) SendLine(port string, line []byte) error {
	return usb.SendLine(port, line)
}
