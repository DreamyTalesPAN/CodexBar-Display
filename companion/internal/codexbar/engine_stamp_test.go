package codexbar

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A file that was read once and then made unreadable keeps its size and
// modification time, so only the readability check can end the reuse (Codex
// P2 on #700).
func TestEngineStampIsEmptyWhenAFileCannotBeRead(t *testing.T) {
	withEngineAnswerReuse(t)
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Minute)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	if engineStamp(path) == "" {
		t.Fatal("a readable, settled file gives no stamp")
	}
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
	// Windows only sets the read-only flag, and root reads anything: where the
	// file stays readable, the permission cannot be tested here.
	if probe, err := os.Open(path); err == nil {
		probe.Close()
		t.Skip("file permissions are not enforced on this system")
	}
	if got := engineStamp(path); got != "" {
		t.Fatalf("an unreadable file still gives a stamp: %q", got)
	}
}
