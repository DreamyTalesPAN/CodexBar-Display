//go:build !windows

package usb

func listAttachedPorts() ([]string, error) {
	return ListPorts()
}
