//go:build darwin || linux

package writerlock

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

type Lock struct {
	file *os.File
}

type lockedError struct {
	path string
}

func (e *lockedError) Error() string {
	return fmt.Sprintf("another VibeTV Companion already owns the display writer lock %s", e.path)
}

func (e *lockedError) ErrorCode() errcode.Code {
	return errcode.RuntimeWriterLocked
}

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
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, errors.New("display writer lock path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create display writer lock directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open display writer lock: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, &lockedError{path: path}
		}
		return nil, fmt.Errorf("acquire display writer lock: %w", err)
	}
	return &Lock{file: file}, nil
}

func (l *Lock) Release() {
	if l == nil || l.file == nil {
		return
	}
	_ = syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	_ = l.file.Close()
	l.file = nil
}
