package writerlock

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
	"golang.org/x/sys/windows"
)

type Lock struct {
	file    *os.File
	overlap windows.Overlapped
}

type lockedError struct{ path string }

func (e *lockedError) Error() string {
	return fmt.Sprintf("another VibeTV Companion already owns the display writer lock %s", e.path)
}
func (e *lockedError) ErrorCode() errcode.Code { return errcode.RuntimeWriterLocked }
func (e *lockedError) RecoveryAction() string {
	return errcode.DefaultRecovery(errcode.RuntimeWriterLocked)
}

func Acquire() (*Lock, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve home directory for display writer lock: %w", err)
	}
	return AcquireAt(runtimepaths.DisplayWriterLock(home))
}
func AcquireAt(path string) (*Lock, error) {
	return acquireAt(path, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY)
}
func AcquireAtWait(path string) (*Lock, error) {
	return acquireAt(path, windows.LOCKFILE_EXCLUSIVE_LOCK)
}
func acquireAt(path string, flags uint32) (*Lock, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("display writer lock path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, fmt.Errorf("create display writer lock directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open display writer lock: %w", err)
	}
	lock := &Lock{file: file}
	if err := windows.LockFileEx(windows.Handle(file.Fd()), flags, 0, 1, 0, &lock.overlap); err != nil {
		_ = file.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
			return nil, &lockedError{path: path}
		}
		return nil, fmt.Errorf("acquire display writer lock: %w", err)
	}
	return lock, nil
}
func (l *Lock) Release() {
	if l == nil || l.file == nil {
		return
	}
	_ = windows.UnlockFileEx(windows.Handle(l.file.Fd()), 0, 1, 0, &l.overlap)
	_ = l.file.Close()
	l.file = nil
}
