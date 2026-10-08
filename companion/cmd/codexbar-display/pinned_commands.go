package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/codexbar"
	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/runtimepaths"
)

func runPinnedCodexBar(args []string, validate bool) error {
	flags := flag.NewFlagSet("pinned-codexbar", flag.ContinueOnError)
	archive := flags.String("archive", "", "bundled CodexBar archive")
	app := flags.String("app", "", "CodexBar app to validate")
	running := flags.Bool("reuse-running", false, "exact private target is already running")
	if err := flags.Parse(args); err != nil {
		return err
	}
	// Both runs share the two minutes this command always had: the app's start
	// and the Control Center's wait for a repair are sized for that.
	budget, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	check := func(limit time.Duration) (string, error) {
		ctx, cancel := context.WithTimeout(budget, limit)
		defer cancel()
		if validate {
			return validatePinnedCLI(ctx, *app)
		}
		return preparePinnedCLI(ctx, *archive, *running)
	}
	bin, err := check(pinnedFirstRunLimit)
	if err != nil {
		// The check leans on macOS services (Gatekeeper, the first start of a
		// new binary) that can stall on a busy Mac. The app then shows "Usage
		// service needs repair", and its button only runs this check again,
		// which passed within seconds when that was seen (#556). So it is run
		// again here before the app is told. A copy that really fails the
		// check fails twice.
		notePinnedFailure(err)
		time.Sleep(pinnedRetryPause)
		bin, err = check(2 * time.Minute)
	}
	if err != nil {
		notePinnedFailure(err)
		return err
	}
	fmt.Println(bin)
	return nil
}

var (
	preparePinnedCLI  = codexbar.PreparePinnedCLI
	validatePinnedCLI = codexbar.ValidatePinnedCLI
	pinnedRetryPause  = 3 * time.Second
)

// pinnedFirstRunLimit ends a first run that has stalled while the second can
// still finish: the check takes 2 to 10 seconds, also on a busy Mac.
const pinnedFirstRunLimit = 75 * time.Second

// notePinnedFailure keeps why the engine check failed. The app only learns
// that it failed, and the folder its "Open support log" button opens held no
// trace of the reason.
func notePinnedFailure(err error) {
	home, homeErr := os.UserHomeDir()
	if homeErr != nil {
		return
	}
	path := runtimepaths.Path(home, "logs", "engine-check.log")
	if path == "" || os.MkdirAll(filepath.Dir(path), 0o700) != nil {
		return
	}
	file, openErr := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if openErr != nil {
		return
	}
	defer file.Close()
	fmt.Fprintf(file, "%s engine check failed: %v\n", time.Now().UTC().Format(time.RFC3339), err)
}
