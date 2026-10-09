//go:build !windows

package usb

func listAttachedPorts() ([]string, error) {
	return ListPorts()
}

func listNonUSBPorts() map[string]bool {
	return nil
}
