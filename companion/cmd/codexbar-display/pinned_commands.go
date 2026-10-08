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
	check := func() (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if validate {
			return validatePinnedCLI(ctx, *app)
		}
		return preparePinnedCLI(ctx, *archive, *running)
	}
	bin, err := check()
	if err != nil {
		// The check leans on macOS services (Gatekeeper, the first start of a
		// new binary) that can stall on a busy Mac. The app then shows "Usage
		// service needs repair", and its button only runs this check again,
		// which passed within seconds when that was seen (#556). So it is run
		// again here before the app is told. A copy that really fails the
		// check fails twice.
		notePinnedFailure(err)
		time.Sleep(pinnedRetryPause)
		bin, err = check()
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
