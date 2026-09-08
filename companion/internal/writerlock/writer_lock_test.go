//go:build darwin || linux || windows

package writerlock

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/errcode"
)

func TestLockProcess(t *testing.T) {
	path := os.Getenv("VIBETV_TEST_LOCK_PATH")
	if path == "" {
		return
	}
	lock, err := AcquireAt(path)
	if os.Getenv("VIBETV_TEST_LOCK_EXPECT_BUSY") == "1" {
		if errcode.Of(err) != errcode.RuntimeWriterLocked {
			t.Fatalf("want locked error, got %v", err)
		}
	} else {
		if err != nil {
			t.Fatal(err)
		}
		if os.Getenv("VIBETV_TEST_LOCK_ABRUPT_EXIT") == "1" {
			os.Exit(0) // No deferred Release: the OS must release a dead writer.
		}
		defer lock.Release()
	}
}

func TestLockAcrossProcessesAndRelease(t *testing.T) {
	path := filepath.Join(t.TempDir(), "writer.lock")
	lock, err := AcquireAt(path)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	run := func(busy string) {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=^TestLockProcess$")
		cmd.Env = append(os.Environ(), "VIBETV_TEST_LOCK_PATH="+path, "VIBETV_TEST_LOCK_EXPECT_BUSY="+busy)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("child: %v\n%s", err, output)
		}
	}
	run("1")
	lock.Release()
	lock.Release()
	run("0")
	cmd := exec.Command(os.Args[0], "-test.run=^TestLockProcess$")
	cmd.Env = append(os.Environ(), "VIBETV_TEST_LOCK_PATH="+path, "VIBETV_TEST_LOCK_ABRUPT_EXIT=1")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("abrupt child: %v\n%s", err, output)
	}
	run("0")
}

func TestLockWaitCancellationAndAcquisition(t *testing.T) {
	path := filepath.Join(t.TempDir(), "writer.lock")
	lock, err := AcquireAt(path)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	if _, err := AcquireAtContext(ctx, path); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancellation: %v", err)
	}
	done := make(chan error, 1)
	go func() {
		second, err := AcquireAtWait(path)
		if err == nil {
			second.Release()
		}
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("wait returned before release: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	lock.Release()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("wait did not acquire released lock")
	}
}
