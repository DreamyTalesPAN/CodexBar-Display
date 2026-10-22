//go:build !windows

package firmwareupdate

import (
	"os"
	"path/filepath"
)

// durableRename renames and then syncs the directory, so the new entry
// survives a power loss.
func durableRename(from, to string) error {
	if err := os.Rename(from, to); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(to))
	if err != nil {
		return err
	}
	defer func() { _ = d.Close() }()
	return d.Sync()
}
