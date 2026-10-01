//go:build !windows

package usb

import (
	"os"
	"strconv"
	"syscall"

	"golang.org/x/sys/unix"
)

// closeOnExecForPath marks every open descriptor of path close-on-exec.
// go.bug.st/serial opens the port without O_CLOEXEC, so each CodexBar helper
// the runtime started inherited the VibeTV port and kept it open after the
// runtime closed it: the board was not reset into its boot hello, and the
// next open was refused. The caller holds syscall.ForkLock, so no child can
// start between the open and this call.
func closeOnExecForPath(path string) {
	var want unix.Stat_t
	if unix.Stat(path, &want) != nil {
		return
	}
	// Names only: os.ReadDir stats each entry, and on macOS that fails at the
	// directory's own descriptor and cuts the list short.
	dir, err := os.Open("/dev/fd")
	if err != nil {
		return
	}
	names, _ := dir.Readdirnames(-1)
	_ = dir.Close()
	for _, name := range names {
		fd, err := strconv.Atoi(name)
		if err != nil {
			continue
		}
		var got unix.Stat_t
		if unix.Fstat(fd, &got) == nil && got.Dev == want.Dev && got.Ino == want.Ino {
			syscall.CloseOnExec(fd)
		}
	}
}
