//go:build windows

package usb

// Windows handles are not inherited unless created inheritable.
func closeOnExecForPath(string) {}
