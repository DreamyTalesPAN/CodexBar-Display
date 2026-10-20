//go:build windows

package firmwareupdate

import "golang.org/x/sys/windows"

// durableRename replaces the target with MOVEFILE_WRITE_THROUGH, so the call
// returns only once the rename is flushed to disk (os.Rename does not ask for
// that on Windows).
func durableRename(from, to string) error {
	src, err := windows.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	dst, err := windows.UTF16PtrFromString(to)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(src, dst, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
