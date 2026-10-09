package usb

import "go.bug.st/serial/enumerator"

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
