package codexbar

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// CI opts in with an extracted, hash-verified release. Ordinary unit tests do
// not invoke a customer's installed CLI or inspect their provider accounts.
func TestReleasedCLIContract(t *testing.T) {
	bin := os.Getenv("CODEXBAR_CONTRACT_BIN")
	if bin == "" {
		t.Skip("release contract runs in its dedicated CI job")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	run := func(args ...string) ([]byte, error) { return exec.CommandContext(ctx, bin, args...).Output() }
	raw, err := run("--version")
	if err != nil {
		t.Fatal(err)
	}
	got, ok := extractLooseVersion(string(raw))
	want, err := parseLooseVersion(os.Getenv("CODEXBAR_CONTRACT_VERSION"))
	if !ok || err != nil || got.Compare(want) != 0 {
		t.Fatalf("unexpected release version: %q", raw)
	}
	t.Run("inventory", func(t *testing.T) {
		raw, err := run("config", "providers")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(raw), "codex:") || !strings.Contains(string(raw), "claude:") {
			t.Fatalf("unexpected text inventory: %s", raw)
		}
		raw, err = run("config", "providers", "--json")
		if os.Getenv("CODEXBAR_CONTRACT_KNOWN_GAPS") == "1" {
			if err == nil {
				t.Fatal("inventory JSON now supported: remove #415's release blocker and tighten this contract")
			}
		} else {
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parseProviderSettings(raw); err != nil {
				t.Fatal(err)
			}
		}
	})
	t.Run("usage", func(t *testing.T) {
		raw, commandErr := run("usage", "--json", "--provider", "codex", "--web-timeout", "8")
		// Provider errors are a valid unauthenticated contract, not success data.
		frames, err := parseAllProviders(raw)
		if err != nil {
			t.Fatalf("usage contract: %v (command: %v, output: %s)", err, commandErr, raw)
		}
		if len(frames) != 1 || frames[0].Provider != "codex" {
			t.Fatalf("unexpected providers: %+v", frames)
		}
		if len(frames[0].Meta.Windows) == 0 && !frames[0].Frame.UsageUnavailable {
			t.Fatal("missing usage became available")
		}
	})
	t.Run("serve-options", func(t *testing.T) {
		raw, err := run("serve", "--help")
		if err != nil {
			t.Fatal(err)
		}
		hasTimeout := strings.Contains(string(raw), "--request-timeout")
		if os.Getenv("CODEXBAR_CONTRACT_KNOWN_GAPS") == "1" {
			if hasTimeout {
				t.Fatal("request-timeout now supported: re-evaluate #415's release blocker")
			}
		} else if !hasTimeout {
			t.Fatal("pinned Mac CLI lost request-timeout")
		}
	})
}
