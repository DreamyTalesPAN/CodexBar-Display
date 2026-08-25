package codexbar

import (
	"os"
	"testing"
)

// TestMain neutralizes the first-run detection hook: EnsureConfig tests create
// fresh config files and must not run the real provider probe against their
// command stubs. Detection tests call autoEnableFirstRunProviders directly or
// install their own hook.
func TestMain(m *testing.M) {
	autoEnableFirstRunProvidersFn = func(string, string) error { return nil }
	os.Exit(m.Run())
}
