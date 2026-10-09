package usb

import (
	"strings"

	"go.bug.st/serial/enumerator"
)

// listAttachedPorts asks Plug and Play for COM ports whose device is attached
// now. It drops an unplugged CH340 at once, even while a handle to it is open.
func listAttachedPorts() ([]string, error) {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(ports))
	for _, port := range ports {
		names = append(names, port.Name)
	}
	return names, nil
}

// listNonUSBPorts names COM ports Plug and Play reports as not USB, such as a
// built-in COM1. A VibeTV is always USB.
func listNonUSBPorts() map[string]bool {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return nil
	}
	nonUSB := make(map[string]bool)
	for _, port := range ports {
		if !port.IsUSB {
			nonUSB[strings.ToUpper(strings.TrimSpace(port.Name))] = true
		}
	}
	return nonUSB
}
