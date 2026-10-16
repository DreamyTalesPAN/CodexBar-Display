package usb

import "github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/protocol"

// Short forms of production functions that only the tests call.

func resolveVibeTVCandidates(
	candidates []string,
	explicit,
	expectedDeviceID string,
	readHello func(string) (protocol.DeviceHello, error),
) (string, error) {
	return resolveVibeTVCandidatesForControl(
		candidates,
		explicit,
		expectedDeviceID,
		readHello,
		false,
	)
}

// Discovery uses the boot-tolerant window too: WiFi startup can delay hello.
func (s *Sender) DeviceHelloForDiscovery(path string) (protocol.DeviceHello, error) {
	return s.deviceHelloWithin(path, s.helloWindow)
}
