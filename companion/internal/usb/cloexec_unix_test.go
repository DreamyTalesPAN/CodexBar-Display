//go:build !windows

package usb

import (
	"path/filepath"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCloseOnExecForPathStopsChildrenInheritingThePort(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cu.usbserial-test")
	// Opened the way go.bug.st/serial opens a port: without O_CLOEXEC.
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_CREAT, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(fd)
	if flags, _ := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0); flags&unix.FD_CLOEXEC != 0 {
		t.Fatal("test setup: descriptor already close-on-exec")
	}

	closeOnExecForPath(path)

	if flags, err := unix.FcntlInt(uintptr(fd), unix.F_GETFD, 0); err != nil || flags&unix.FD_CLOEXEC == 0 {
		t.Fatalf("port descriptor still inherited by children: flags=%#x err=%v", flags, err)
	}
}
